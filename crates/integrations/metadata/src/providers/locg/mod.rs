//! League of Comic Geeks (LOCG) metadata provider — **unofficial**.
//!
//! # Why this provider is shaped differently from the others
//!
//! LOCG publishes no usable API. A private one exists at `/api/*` — it is what their
//! iOS app talks to — but it answers every request without a client key with
//! `403 {"status":false,"error":"Invalid API Key."}`, and there is no route for a
//! self-hoster to obtain one (the `Himon` wrapper that had credentials was archived in
//! March 2026). So this provider does what the maintained third-party clients do: it
//! logs into the site with the operator's own account and reads the site's own
//! endpoints.
//!
//! **LOCG's Terms of Use prohibit automated access.** That is why the provider is
//! hidden from the add-provider list entirely until the server owner acknowledges it
//! (`server_config.unofficial_providers_acknowledged_at`, surfaced in Settings →
//! Server → Metadata Integrations). Longbox does not scrape LOCG; an operator who
//! configures this is acting as themselves, with their own credentials, and the
//! session this provider drives is theirs.
//!
//! # Shape of the data
//!
//! Two endpoint families, both of which return markup rather than data:
//!
//! - `/comic/get_comics` — JSON whose values are **rendered HTML fragments**. Used for
//!   series search (`list=search&list_option=series`), a series' issue list
//!   (`list=series&series_id=`) and weekly release lists (`list=releases`). Its
//!   `series` key is the one genuinely structured payload on the site.
//! - `/search/ajax_issues` and `/comic/{id}/{slug}` — plain HTML.
//!
//! Parsing lives in [`parse`], every CSS selector in [`selectors`], and the
//! role-string mapping in [`roles`]. A site redesign should be a one- or two-file fix.
//!
//! # Notes for whoever maintains this
//!
//! - Reads work **anonymously** — the session changes nothing about the metadata
//!   returned (verified: identical `series_count`, identical detail sections; only
//!   `my_user_id` differs). The login exists so the traffic is attributable to the
//!   operator's own account rather than being anonymous and unattributable, which is
//!   the accountability model the acknowledgement gate assumes.
//! - The `ci_session` cookie is **reissued on every response** with a ~12.5 day
//!   lifetime, so the cookie jar is the source of truth and credentials are stored as
//!   `username:password` (the same single-`api_token` packing Metron uses).
//! - There are **no rate-limit headers**, so pacing is blind and deliberately
//!   conservative; [`LOCG_RATE_LIMIT_PER_MINUTE`] is the default and callers may lower
//!   it via the provider config.
//! - `format[]` codes: `1` Regular Issues, `2` Variants & Reprints, `3` Trade
//!   Paperbacks, `4` Hardcovers, `5` Digital Chapters, `6` Annuals. Omitting the
//!   filter lets variants multiply results — a 26-issue series returns 149 rows.
//! - Expect LOCG candidates to score *below* ComicVine/Metron in [`MatchScorer`]:
//!   there are fewer structured fields to match on. That is correct, not a bug.

mod parse;
mod roles;
mod selectors;

use std::sync::{
	atomic::{AtomicBool, Ordering},
	Arc,
};

use chrono::{Duration, NaiveDate};
use reqwest::cookie::Jar;
use reqwest_middleware::ClientWithMiddleware;
use url::Url;

use crate::{
	client::{
		build_client_with_retry, metadata_client_builder,
		metadata_client_with_cookie_jar, RetryClientConfig,
	},
	error::MetadataProviderError,
	runtime::{cached_get_json, cached_get_text, noop_runtime, RuntimeHandle},
	types::{
		ExternalMediaMetadata, ExternalSeriesMetadata, MatchCandidate, MediaType,
		ProviderValidationResult, ProviderValidationStatus, PublicationStatus,
		SearchQuery, UpcomingRelease,
	},
	ExternalMetadata, MetadataProvider, RateLimiter,
};

use parse::{IssueCard, SeriesCard};

const LOCG_BASE_URL: &str = "https://leagueofcomicgeeks.com";

/// Conservative default pacing. LOCG sends no rate-limit headers whatsoever, so
/// there is nothing to adapt to — this is a guess made deliberately low, and the
/// provider config can lower it further.
pub const LOCG_RATE_LIMIT_PER_MINUTE: u32 = 15;

/// Everything a reader can own as a distinct book: regular issues (`1`), annuals
/// (`6`), trade paperbacks (`3`) and hardcovers (`4`). LOCG has no "omnibus" format —
/// omnibuses, deluxe editions and compendiums are all filed as hardcovers or trades.
///
/// Deliberately *not* just `1,6`. Measured against a real 241-series library that is
/// 87% omnibuses, `1,6` matched 5 of 16 sampled titles while adding the
/// collected-edition formats matched 10 — an issues-only filter hides most of a
/// trade-heavy library. Widening *further* was measured and buys nothing: adding `5`
/// (digital chapters), `2` (variants) or the reprint/facsimile facets left the hit rate
/// at 10/16 while returning ~16% more rows per query, so they stay out. Variants also
/// duplicate their parent issue, which is what `data-parent` filtering removes.
const OWNABLE_FORMATS: &[&str] = &["1", "3", "4", "6"];

/// Regular issues and annuals only — what "how many issues does this series have"
/// means. On Absolute Batman this yields 26 (the real count) where an unfiltered
/// request reports 149 and [`OWNABLE_FORMATS`] reports 38 (issues plus the nine
/// collected editions filed under the same series).
const ISSUE_ONLY_FORMATS: &[&str] = &["1", "6"];

/// Upper bound on the per-issue lookups [`LocgClient::fetch_upcoming_releases`] will
/// spend resolving series ids.
///
/// The release list is issue-only: no card in any view carries a series id, and
/// [`UpcomingRelease::series_external_id`] is matched against stored series ids, so
/// each distinct series in the window costs one extra page fetch. Releases are swept
/// in `order=pulls` (most-followed first) so that if this bound truncates the window,
/// what survives is the popular series most likely to be in a library. Truncation is
/// always logged — never silent.
const MAX_SERIES_RESOLUTIONS_PER_SWEEP: usize = 40;

/// How many same-titled series a single `search_media` call will pull issues from.
///
/// Each one costs a request, and LOCG's alphabetical ordering means the first hit is
/// often not the intended series. Two is enough to cover the common "DC's series plus
/// a same-titled oddity" case without turning one search into a page-fetch fan-out.
const MAX_SERIES_PER_MEDIA_SEARCH: usize = 2;

/// League of Comic Geeks provider client.
///
/// See the module docs for why this provider scrapes and why it is gated.
pub struct LocgClient {
	/// Data-fetch client: retry/backoff middleware, cookie jar attached.
	client: ClientWithMiddleware,
	/// Non-retrying client sharing the same jar, used by
	/// [`validate_credentials`](LocgClient::validate_credentials) so a rejection or a
	/// 429 surfaces immediately instead of blocking on backoff.
	probe_client: reqwest::Client,
	/// The live session. `ci_session` is rotated by the server on every response, so
	/// this jar — not any stored string — is the session's source of truth.
	jar: Arc<Jar>,
	/// Session-less, non-redirecting client used only by
	/// [`resolve_issue_path`](LocgClient::resolve_issue_path): a logged-in request for a
	/// wrong issue slug 404s, while a logged-out one answers `301` with the canonical
	/// URL. It shares no cookie jar, so it cannot pick up the session.
	slug_client: reqwest::Client,
	username: String,
	password: String,
	base_url: String,
	rate_limiter: RateLimiter,
	runtime: RuntimeHandle,
	/// Whether a login has succeeded on this client. Only an optimisation: a lost race
	/// costs one redundant login POST, never correctness, which is why this is a plain
	/// atomic rather than an async lock.
	session_established: AtomicBool,
}

impl LocgClient {
	/// Build a client from a `username:password` token.
	///
	/// The config store has a single `api_token` column, so credentials are packed
	/// into it exactly as Metron's are. LOCG has no token to store: the site
	/// authenticates a form POST and hands back a rotating session cookie, so an
	/// unattended server needs the username and password to re-establish a session
	/// when the ~12.5 day cookie lapses.
	pub fn new(
		token: String,
		rate_limit: Option<u32>,
	) -> Result<Self, MetadataProviderError> {
		Self::with_base_url(token, rate_limit, LOCG_BASE_URL.to_string())
	}

	/// Attach a host runtime (response cache + budget ledger).
	pub fn with_runtime(mut self, runtime: RuntimeHandle) -> Self {
		self.runtime = runtime;
		self
	}

	/// Construct against an explicit base URL — [`new`](Self::new) with the live site,
	/// tests with a mock server.
	fn with_base_url(
		token: String,
		rate_limit: Option<u32>,
		base_url: String,
	) -> Result<Self, MetadataProviderError> {
		let (username, password) = token.split_once(':').ok_or_else(|| {
			MetadataProviderError::Other(
				"League of Comic Geeks credentials must be 'username:password'"
					.to_string(),
			)
		})?;
		if username.trim().is_empty() || password.is_empty() {
			return Err(MetadataProviderError::Other(
				"League of Comic Geeks credentials must be 'username:password'"
					.to_string(),
			));
		}

		let jar = Arc::new(Jar::default());
		// One underlying client (carrying the mandatory User-Agent and the shared jar)
		// backs both the retrying fetch client and the non-retrying probe client;
		// `Client` is Arc-backed, so the clone shares the connection pool and cookies.
		let base = metadata_client_with_cookie_jar(jar.clone());

		Ok(Self {
			client: build_client_with_retry(base.clone(), RetryClientConfig::default()),
			probe_client: base,
			jar,
			slug_client: metadata_client_builder()
				.redirect(reqwest::redirect::Policy::none())
				.build()
				.expect("failed to build LOCG slug-resolution client"),
			username: username.to_string(),
			password: password.to_string(),
			base_url,
			rate_limiter: RateLimiter::per_minute(
				rate_limit.unwrap_or(LOCG_RATE_LIMIT_PER_MINUTE),
			),
			runtime: noop_runtime(),
			session_established: AtomicBool::new(false),
		})
	}

	fn base(&self) -> Result<Url, MetadataProviderError> {
		Url::parse(&self.base_url).map_err(|e| {
			MetadataProviderError::Other(format!("invalid LOCG base url: {e}"))
		})
	}

	/// Whether the jar currently holds a session cookie for the site.
	fn has_session_cookie(&self) -> bool {
		let Ok(url) = self.base() else {
			return false;
		};
		<Jar as reqwest::cookie::CookieStore>::cookies(&self.jar, &url)
			.and_then(|value| value.to_str().ok().map(str::to_string))
			.is_some_and(|cookies| cookies.contains("ci_session"))
	}

	/// Log in, establishing the session cookie in the jar.
	///
	/// Success and failure are told apart by *where the response lands*, not by status
	/// code: a good login answers `303` to `/dashboard`, a bad one re-renders the form
	/// at `/login` with `200`. Redirects are followed, so the landing path is the
	/// signal. The site's `ci_csrf_token` field is present but empty — CSRF is
	/// disabled — so no token round-trip is needed.
	#[tracing::instrument(skip(self), fields(user = %self.username))]
	async fn login(&self) -> Result<LoginOutcome, MetadataProviderError> {
		self.rate_limiter.until_ready().await;

		let response = self
			.probe_client
			.post(format!("{}/login", self.base_url))
			.form(&[
				("ci_csrf_token", ""),
				("username", self.username.as_str()),
				("password", self.password.as_str()),
				("submit", "Continue »"),
			])
			.send()
			.await;

		let response = match response {
			Ok(response) => response,
			Err(e) => {
				tracing::warn!(error = ?e, "LOCG login could not reach the host");
				return Ok(LoginOutcome::Unreachable);
			},
		};

		let status = response.status();
		let landed = response.url().path().to_string();
		let outcome = match status.as_u16() {
			429 => LoginOutcome::RateLimited,
			500..=599 => LoginOutcome::ServerError(status.as_u16()),
			// A challenge/deny page rather than the app.
			403 => LoginOutcome::Blocked,
			_ if landed.contains("dashboard") => LoginOutcome::Success,
			// Still on the form: the site rejected the credentials.
			_ if landed.contains("login") => LoginOutcome::Rejected,
			_ => {
				// Landed somewhere unexpected; a session cookie is the tiebreaker.
				if self.has_session_cookie() {
					LoginOutcome::Success
				} else {
					LoginOutcome::Unexpected(status.as_u16(), landed.clone())
				}
			},
		};

		if matches!(outcome, LoginOutcome::Success) {
			self.session_established.store(true, Ordering::Relaxed);
			tracing::debug!("LOCG session established");
		} else {
			self.session_established.store(false, Ordering::Relaxed);
			tracing::warn!(?outcome, landed = %landed, status = %status, "LOCG login did not succeed");
		}

		Ok(outcome)
	}

	/// Ensure a session exists before a data request.
	///
	/// Reads happen to work anonymously, so a failed login is logged and the request
	/// proceeds rather than failing the whole fetch — the operator gets metadata and a
	/// warning instead of nothing. `validate_credentials` is the place that reports
	/// credential problems as errors.
	async fn ensure_session(&self) {
		if self.session_established.load(Ordering::Relaxed) && self.has_session_cookie() {
			return;
		}
		match self.login().await {
			Ok(LoginOutcome::Success) => {},
			Ok(other) => tracing::warn!(
				outcome = ?other,
				"Proceeding against LOCG without a session; check the provider credentials"
			),
			Err(e) => tracing::warn!(error = ?e, "LOCG login failed"),
		}
	}

	/// GET `/comic/get_comics`, which answers JSON containing HTML fragments.
	async fn get_comics(
		&self,
		params: &[(&str, String)],
	) -> Result<parse::GetComicsResponse, MetadataProviderError> {
		self.ensure_session().await;

		let request = self
			.client
			.get(format!("{}/comic/get_comics", self.base_url))
			// The site's own JS sends this on these calls.
			.header("X-Requested-With", "XMLHttpRequest")
			.query(params)
			.build()?;

		let body = cached_get_json(
			&self.client,
			self.runtime.as_ref(),
			&self.rate_limiter,
			self.id(),
			request,
			// LOCG signals problems with status codes, not error envelopes.
			crate::runtime::always_cacheable,
		)
		.await?;

		serde_json::from_value(body).map_err(MetadataProviderError::from)
	}

	/// GET a plain-HTML page (an issue page, or the quick-search widget).
	async fn get_html(
		&self,
		path: &str,
		query: &[(&str, String)],
	) -> Result<String, MetadataProviderError> {
		self.ensure_session().await;

		let request = self
			.client
			.get(format!("{}{path}", self.base_url))
			.header("X-Requested-With", "XMLHttpRequest")
			.query(query)
			.build()?;

		cached_get_text(
			&self.client,
			self.runtime.as_ref(),
			&self.rate_limiter,
			self.id(),
			request,
		)
		.await
	}

	/// Search series, returning the raw cards.
	async fn search_series_cards(
		&self,
		title: &str,
		limit: usize,
	) -> Result<Vec<SeriesCard>, MetadataProviderError> {
		let mut params = vec![
			("list", "search".to_string()),
			("list_option", "series".to_string()),
			("view", "thumbs".to_string()),
			("title", title.to_string()),
			("order", "alpha-asc".to_string()),
			// Without an explicit cap the site answers with `per_page: 50000`, which
			// is how a common search becomes a 376KB response.
			("limit", limit.max(1).to_string()),
		];
		params.extend(OWNABLE_FORMATS.iter().map(|f| ("format[]", f.to_string())));

		let response = self.get_comics(&params).await?;
		Ok(parse::parse_series_cards(&response.list))
	}

	/// List a series' issues, dropping cover variants.
	async fn series_issue_cards(
		&self,
		series_id: &str,
		formats: &[&str],
	) -> Result<(Vec<IssueCard>, Option<i32>), MetadataProviderError> {
		let mut params = vec![
			("list", "series".to_string()),
			("series_id", series_id.to_string()),
			("view", "issues".to_string()),
			("order", "date-asc".to_string()),
		];
		params.extend(formats.iter().map(|f| ("format[]", f.to_string())));

		let response = self.get_comics(&params).await?;
		let cards = parse::parse_issue_cards(&response.list)
			.into_iter()
			.filter(|card| !card.is_variant())
			.collect();
		Ok((cards, response.count))
	}

	/// Resolve an issue id to its canonical `/comic/{id}/{slug}` path.
	///
	/// LOCG's issue pages cannot be addressed by id alone, and how a wrong URL behaves
	/// depends on whether a session is present:
	///
	/// | request | result |
	/// |---|---|
	/// | `/comic/{id}` | HTTP 200 with a "Page Not Found" body — a soft 404 |
	/// | `/comic/{id}/wrong-slug`, logged out | `301` to the canonical URL |
	/// | `/comic/{id}/wrong-slug`, logged in | hard `404` |
	///
	/// So the slug is discovered with one deliberately **session-less** redirect probe
	/// (a 301 with no body, using a jar-free client), and the page itself is then
	/// fetched as the operator. The resolved path is cached, so re-fetching the same
	/// issue costs nothing.
	///
	/// This is the single nastiest piece of LOCG's shape, and it is invisible to mocked
	/// tests — a mock happily serves any path. `issue_paths_carry_a_slug` and the
	/// `#[ignore]`d live tests are what guard it.
	async fn resolve_issue_path(
		&self,
		external_id: &str,
	) -> Result<String, MetadataProviderError> {
		let cache_key = format!("{}/__issue_path__/{external_id}", self.base_url);
		if let Some(serde_json::Value::String(hit)) =
			self.runtime.cache_get(self.id(), &cache_key).await
		{
			return Ok(hit);
		}

		self.rate_limiter.until_ready().await;
		let response = self
			.slug_client
			.get(format!(
				"{}{}",
				self.base_url,
				issue_probe_path(external_id)
			))
			.send()
			.await?;
		self.runtime.record_call(self.id(), &cache_key).await;

		let location = response
			.headers()
			.get(reqwest::header::LOCATION)
			.and_then(|value| value.to_str().ok())
			.map(str::to_string);

		let path = match location {
			// The redirect target is absolute; keep only the path so the base URL
			// (which tests override) stays authoritative.
			Some(location) => Url::parse(&location)
				.map(|url| url.path().to_string())
				.unwrap_or(location),
			// No redirect: either this build is talking to a mock that serves the probe
			// path directly, or the id does not exist. Fall through with the probe path
			// and let the page parse decide — a missing heading becomes NotFound.
			None => issue_probe_path(external_id),
		};

		self.runtime
			.cache_put(
				self.id(),
				&cache_key,
				&serde_json::Value::String(path.clone()),
			)
			.await;
		Ok(path)
	}

	/// The parent series id for an issue, read off its detail page. Used by the release
	/// sweep, where cards carry no series id of their own.
	async fn issue_page_series_id(
		&self,
		external_id: &str,
	) -> Result<Option<String>, MetadataProviderError> {
		let path = self.resolve_issue_path(external_id).await?;
		let html = self.get_html(&path, &[]).await?;
		Ok(parse::parse_issue_page(&html).series_id)
	}

	fn series_candidate(&self, card: &SeriesCard) -> MatchCandidate {
		MatchCandidate {
			provider: self.id().to_string(),
			external_id: card.id.clone(),
			metadata: ExternalMetadata::Series(self.series_metadata_from_card(card)),
			confidence: 0.0,
			confidence_factors: Vec::new(),
		}
	}

	/// Build series metadata from a search card. Cards already carry title, publisher,
	/// years, cover and issue count, so — unlike the Metron provider, whose search
	/// results are id-only — no per-result detail fetch is needed. That matters here:
	/// each extra fetch is a scraped page against a blind rate limit.
	fn series_metadata_from_card(&self, card: &SeriesCard) -> ExternalSeriesMetadata {
		ExternalSeriesMetadata {
			provider: self.id().to_string(),
			external_id: card.id.clone(),
			title: card.title.clone(),
			alternative_titles: Vec::new(),
			summary: None,
			status: Some(status_for(card.ongoing, card.end_year)),
			year: card.start_year,
			end_year: card.end_year,
			genres: None,
			tags: None,
			age_rating: None,
			authors: None,
			artists: None,
			publisher: card.publisher.clone(),
			cover_url: card.cover_url.clone(),
			// An issue tally, not a volume tally — LOCG has no notion of volumes, so
			// this is the closest available approximation.
			volume_count: card.issue_count,
		}
	}

	fn media_candidate(&self, card: &IssueCard) -> MatchCandidate {
		MatchCandidate {
			provider: self.id().to_string(),
			external_id: card.id.clone(),
			metadata: ExternalMetadata::Media(self.media_metadata_from_card(card, None)),
			confidence: 0.0,
			confidence_factors: Vec::new(),
		}
	}

	/// Build issue metadata from a list/widget card — enough for a search candidate.
	/// Credits, characters, summary and page count only exist on the detail page and
	/// are filled in by [`fetch_media_metadata`](MetadataProvider::fetch_media_metadata).
	fn media_metadata_from_card(
		&self,
		card: &IssueCard,
		series_id: Option<&str>,
	) -> ExternalMediaMetadata {
		let (series_name, number_raw) = parse::split_title_number(&card.title);
		let (day, month, year) = match card.store_date {
			Some(date) => {
				let (d, m, y) = parse::date_parts(date);
				(Some(d), Some(m), Some(y))
			},
			None => (None, None, None),
		};

		ExternalMediaMetadata {
			provider: self.id().to_string(),
			external_id: card.id.clone(),
			title: Some(card.title.clone()),
			summary: None,
			page_count: None,
			series_name: Some(series_name),
			series_external_id: series_id.map(str::to_string),
			number: number_raw.as_deref().and_then(|n| n.parse::<f32>().ok()),
			number_raw,
			day,
			month,
			year,
			genres: None,
			tags: None,
			isbn: None,
			isbn_13: None,
			writers: None,
			artists: None,
			colorists: None,
			letterers: None,
			cover_artists: None,
			pencillers: None,
			inkers: None,
			editors: None,
			characters: None,
			teams: None,
			story_arc: None,
			imprint: None,
			publisher: card.publisher.clone(),
			cover_url: card.cover_url.clone(),
			provider_url: card.url.as_ref().map(|u| absolute_url(&self.base_url, u)),
		}
	}
}

/// Where a login attempt landed. Kept separate from
/// [`ProviderValidationStatus`] so `ensure_session` can log a precise reason without
/// constructing a user-facing validation result.
#[derive(Debug, Clone, PartialEq, Eq)]
enum LoginOutcome {
	Success,
	/// Credentials rejected — the form was re-rendered.
	Rejected,
	/// A deny/challenge page rather than the application.
	Blocked,
	RateLimited,
	ServerError(u16),
	Unreachable,
	Unexpected(u16, String),
}

/// LOCG marks an ongoing series as "… - Present" and a finished one with a closing
/// year, so the presence of an end year is what distinguishes them.
fn status_for(ongoing: bool, end_year: Option<i32>) -> PublicationStatus {
	if ongoing || end_year.is_none() {
		PublicationStatus::Ongoing
	} else {
		PublicationStatus::Completed
	}
}

/// The probe path used to discover an issue's canonical URL. Any non-matching slug
/// works; see [`LocgClient::resolve_issue_path`] for why this exists at all.
fn issue_probe_path(external_id: &str) -> String {
	format!("/comic/{external_id}/x")
}

/// Pick which series to pull issues from, best first.
///
/// Narrows to publisher matches when the query names a publisher — the cheapest way
/// to tell same-titled series apart without spending a request on each — then caps the
/// list so a search costs a bounded number of scraped pages.
fn shortlist_series<'a>(
	cards: &'a [SeriesCard],
	publisher: Option<&str>,
) -> Vec<&'a SeriesCard> {
	let by_publisher: Vec<&SeriesCard> =
		match publisher.map(str::trim).filter(|p| !p.is_empty()) {
			Some(wanted) => {
				let wanted = wanted.to_lowercase();
				cards
					.iter()
					.filter(|c| {
						c.publisher
							.as_deref()
							.is_some_and(|p| p.to_lowercase().contains(&wanted))
					})
					.collect()
			},
			None => Vec::new(),
		};

	let ordered = if by_publisher.is_empty() {
		cards.iter().collect::<Vec<_>>()
	} else {
		by_publisher
	};

	ordered
		.into_iter()
		.take(MAX_SERIES_PER_MEDIA_SEARCH)
		.collect()
}

/// Resolve a site-relative href against the base URL.
fn absolute_url(base: &str, href: &str) -> String {
	if href.starts_with("http") {
		href.to_string()
	} else {
		format!("{}{href}", base.trim_end_matches('/'))
	}
}

#[async_trait::async_trait]
impl MetadataProvider for LocgClient {
	fn id(&self) -> &'static str {
		"locg"
	}

	fn name(&self) -> &'static str {
		"League of Comic Geeks"
	}

	fn supported_media_types(&self) -> Vec<MediaType> {
		vec![MediaType::Comic]
	}

	async fn search_series(
		&self,
		query: &SearchQuery,
	) -> Result<Vec<MatchCandidate>, MetadataProviderError> {
		let limit = query.limit.unwrap_or(10) as usize;
		let title = query
			.series_name
			.as_deref()
			.filter(|s| !s.trim().is_empty())
			.unwrap_or(&query.title);

		let cards = self.search_series_cards(title, limit.max(10)).await?;
		let candidates = cards
			.iter()
			.take(limit)
			.map(|card| self.series_candidate(card))
			.collect();

		Ok(self.score_search(query, candidates))
	}

	/// Search for an issue.
	///
	/// Two routes, chosen by whether the query carries an issue number, because the
	/// two cases live in different places on LOCG:
	///
	/// - **The series route** — resolve the series, then list everything filed under it:
	///   issues, annuals, trades and hardcovers. Precise for a numbered issue, and the
	///   only way to see the collected editions LOCG files inside a series.
	/// - **The quick-search route** — one request against the typeahead, which indexes
	///   collected editions by their own title. Measured on a trade-heavy library it
	///   found 15/16 titles where a series search found 5/16, but it returns at most
	///   five rows.
	///
	/// Both run for an unnumbered book (a trade or omnibus, the common case in a
	/// trade-heavy library); a numbered issue takes the series route and only falls back
	/// to the quick search if that found nothing, so the extra request is not spent when
	/// it is not needed. Results are merged, de-duplicated by LOCG id, and ranked by the
	/// shared scorer.
	async fn search_media(
		&self,
		query: &SearchQuery,
	) -> Result<Vec<MatchCandidate>, MetadataProviderError> {
		let limit = query.limit.unwrap_or(10) as usize;
		let wanted_number = query
			.number
			.as_deref()
			.map(str::trim)
			.filter(|n| !n.is_empty());

		let mut candidates: Vec<MatchCandidate> = Vec::new();

		// The series route: resolve the series, then list everything filed under it —
		// issues, annuals *and* collected editions ([`OWNABLE_FORMATS`]). Worth running
		// for a numbered issue (precise) and for an unnumbered one, because a trade or
		// omnibus is usually filed inside its series: Absolute Batman lists nine of them
		// ("Vol. 1: The Zoo HC/TP", "Deluxe Edition HC", …) that an issues-only filter
		// hides entirely, and the quick search below caps out at five rows.
		let series_title = query
			.series_name
			.as_deref()
			.filter(|s| !s.trim().is_empty())
			.unwrap_or(&query.title);

		if !series_title.trim().is_empty() {
			let series_cards = self.search_series_cards(series_title, 10).await?;

			// Don't just take the first card. LOCG orders search results
			// alphabetically, which says nothing about relevance, and distinct series
			// share titles: a live search for "Absolute Batman" returns DC's series
			// *and* an unrelated one from another publisher, alphabetically first. So
			// narrow by publisher when the query knows it, then try the best couple of
			// candidates and let the scorer rank the issues they yield.
			let shortlist = shortlist_series(&series_cards, query.publisher.as_deref());

			for series in shortlist {
				let (cards, _) =
					self.series_issue_cards(&series.id, OWNABLE_FORMATS).await?;
				// With a number in hand, prefer exact matches; if the number isn't
				// there, hand the scorer everything rather than nothing. Without one,
				// every edition in the series is a legitimate candidate.
				let chosen: Vec<&IssueCard> = match wanted_number {
					Some(number) => {
						let exact: Vec<&IssueCard> = cards
							.iter()
							.filter(|c| {
								parse::split_title_number(&c.title)
									.1
									.is_some_and(|n| n.eq_ignore_ascii_case(number))
							})
							.collect();
						if exact.is_empty() {
							cards.iter().collect()
						} else {
							exact
						}
					},
					None => cards.iter().collect(),
				};
				for card in chosen.into_iter().take(limit) {
					// De-duplicate across everything: two shortlisted series can list the
					// same edition, and the quick-search route below can surface it a
					// third time. The same LOCG id offered twice just crowds the ranking.
					if candidates.iter().any(|c| c.external_id == card.id) {
						continue;
					}
					candidates.push(MatchCandidate {
						provider: self.id().to_string(),
						external_id: card.id.clone(),
						metadata: ExternalMetadata::Media(
							self.media_metadata_from_card(card, Some(&series.id)),
						),
						confidence: 0.0,
						confidence_factors: Vec::new(),
					});
				}
			}
		}

		// The quick-search route. One request, and the only place that finds a collected
		// edition whose title does not match its series ("Venomnibus by Cates & Stegman
		// HC"): 15/16 on a trade-heavy library where a series search managed 5/16. Run
		// for unnumbered queries, and as a fallback whenever the series route came up
		// empty — a numbered issue that the series route already answered does not need
		// the extra request.
		if wanted_number.is_none() || candidates.is_empty() {
			let title = if query.title.trim().is_empty() {
				query.series_name.clone().unwrap_or_default()
			} else {
				query.title.clone()
			};
			let html = self
				.get_html("/search/ajax_issues", &[("query", title)])
				.await?;
			for card in parse::parse_issue_widget(&html).iter().take(limit) {
				if candidates.iter().any(|c| c.external_id == card.id) {
					continue;
				}
				candidates.push(self.media_candidate(card));
			}
		}

		// Score first, *then* truncate: two routes can contribute more than `limit`
		// candidates between them, and cutting before ranking would throw away the best
		// match to keep whichever route happened to run first.
		let mut scored = self.score_search(query, candidates);
		scored.truncate(limit);
		Ok(scored)
	}

	/// Fetch series metadata in one request.
	///
	/// `list=series` returns a structured `series` object (title, publisher, and the
	/// *full* description) alongside the rendered header that carries the year range —
	/// which is why this reads the AJAX endpoint rather than the series page, whose
	/// only description is a truncated `<meta>` tag.
	async fn fetch_series_metadata(
		&self,
		external_id: &str,
	) -> Result<ExternalSeriesMetadata, MetadataProviderError> {
		let mut params = vec![
			("list", "series".to_string()),
			("series_id", external_id.to_string()),
			("view", "issues".to_string()),
			("order", "date-asc".to_string()),
		];
		params.extend(
			ISSUE_ONLY_FORMATS
				.iter()
				.map(|f| ("format[]", f.to_string())),
		);

		let response = self.get_comics(&params).await?;
		let series = response.series.ok_or_else(|| {
			MetadataProviderError::NotFound(format!(
				"League of Comic Geeks has no series {external_id}"
			))
		})?;

		let (header_publisher, start_year, end_year, ongoing) =
			parse::parse_series_header(&response.header);

		let title = series
			.title
			.clone()
			.filter(|t| !t.trim().is_empty())
			.ok_or_else(|| {
				MetadataProviderError::NotFound(format!(
					"League of Comic Geeks series {external_id} has no title"
				))
			})?;

		Ok(ExternalSeriesMetadata {
			provider: self.id().to_string(),
			external_id: external_id.to_string(),
			title,
			alternative_titles: Vec::new(),
			summary: series.description.as_deref().and_then(parse::html_to_text),
			status: Some(status_for(ongoing, end_year)),
			year: start_year,
			end_year,
			genres: None,
			tags: None,
			age_rating: None,
			authors: None,
			artists: None,
			publisher: series.publisher_name.or(header_publisher),
			cover_url: None,
			// Issues, not volumes — LOCG has no volume concept. Counted with the
			// issues+annuals filter so cover variants don't inflate it.
			volume_count: response.count,
		})
	}

	/// Fetch issue metadata from the detail page.
	///
	/// The page is the only place credits, characters, summary and page count exist.
	async fn fetch_media_metadata(
		&self,
		external_id: &str,
	) -> Result<ExternalMediaMetadata, MetadataProviderError> {
		let path = self.resolve_issue_path(external_id).await?;
		let html = self.get_html(&path, &[]).await?;
		let page = parse::parse_issue_page(&html);

		let heading = page.heading.clone().ok_or_else(|| {
			MetadataProviderError::NotFound(format!(
				"League of Comic Geeks has no issue {external_id}"
			))
		})?;
		let (series_name, number_raw) = parse::split_title_number(&heading);

		let buckets = roles::bucket_credits(
			page.credits
				.iter()
				.map(|(role, name)| (role.as_str(), name.as_str())),
		);
		if !buckets.unmapped.is_empty() {
			// Surfaced rather than dropped: an unmapped role is a gap in the table in
			// `roles.rs`, and these are free-text values that change over time.
			tracing::debug!(
				provider = self.id(),
				issue = external_id,
				roles = ?buckets.unmapped,
				"LOCG credit roles with no Longbox field were skipped"
			);
		}

		let (day, month, year) = match page.released {
			Some(date) => {
				let (d, m, y) = parse::date_parts(date);
				(Some(d), Some(m), Some(y))
			},
			None => (None, None, None),
		};

		let title =
			crate::title::compose_comic_title(&series_name, number_raw.as_deref())
				.unwrap_or_else(|| heading.clone());

		Ok(ExternalMediaMetadata {
			provider: self.id().to_string(),
			external_id: external_id.to_string(),
			title: Some(title),
			summary: page.summary.clone(),
			page_count: page.page_count,
			series_name: Some(series_name),
			series_external_id: page.series_id.clone(),
			number: number_raw.as_deref().and_then(|n| n.parse::<f32>().ok()),
			number_raw,
			day,
			month,
			year,
			// LOCG carries none of these. It does expose price, UPC, SKU, format and
			// variant covers, which Longbox has nowhere to put — see the module docs.
			genres: None,
			tags: None,
			isbn: None,
			isbn_13: None,
			writers: opt_vec(buckets.writers),
			artists: opt_vec(buckets.artists),
			colorists: opt_vec(buckets.colorists),
			letterers: opt_vec(buckets.letterers),
			cover_artists: opt_vec(buckets.cover_artists),
			pencillers: opt_vec(buckets.pencillers),
			inkers: opt_vec(buckets.inkers),
			editors: opt_vec(buckets.editors),
			characters: opt_vec(page.characters.clone()),
			teams: None,
			story_arc: None,
			imprint: None,
			publisher: page.publisher.clone(),
			cover_url: page.cover_url.clone(),
			provider_url: Some(format!("{}/comic/{external_id}", self.base_url)),
		})
	}

	/// Sweep LOCG's weekly release lists across `[start, end]`.
	///
	/// One request per ISO week covers the window. The catch is that release cards
	/// carry no series id in any view, while [`UpcomingRelease`] needs one to join
	/// against stored series — so each *distinct* series in the window costs an extra
	/// page fetch, bounded by [`MAX_SERIES_RESOLUTIONS_PER_SWEEP`] and biased toward
	/// most-followed series by requesting `order=pulls`. Any truncation is logged.
	async fn fetch_upcoming_releases(
		&self,
		start: NaiveDate,
		end: NaiveDate,
		cap: usize,
	) -> Result<Vec<UpcomingRelease>, MetadataProviderError> {
		if end < start {
			return Ok(Vec::new());
		}

		// Collect the window's cards first, de-duplicated by issue id.
		let mut cards: Vec<IssueCard> = Vec::new();
		let mut seen_ids: Vec<String> = Vec::new();
		let mut week = start;
		while week <= end {
			// Two passes per week, and *not* one wider one. Unlike a series listing —
			// where widening the format filter is a strict superset — the weekly release
			// lists returned by these two filters are not nested. Measured on one week:
			// `1,6` gave 236 primaries and zero collected editions, while `1,3,4,6` gave
			// 157 including 41 collected editions but *dropped* 120 digital-first
			// serials (mostly manga/webtoon chapters filed as regular issues). Asking
			// for no filter at all is worse still: 21 primaries and 145 variants. So the
			// only way to see both halves is to ask twice and union the results.
			for formats in [ISSUE_ONLY_FORMATS, OWNABLE_FORMATS] {
				let mut params = vec![
					("list", "releases".to_string()),
					("view", "thumbs".to_string()),
					("date_type", "week".to_string()),
					("date", week.to_string()),
					("order", "pulls".to_string()),
				];
				params.extend(formats.iter().map(|f| ("format[]", f.to_string())));

				match self.get_comics(&params).await {
					Ok(response) => {
						for card in parse::parse_issue_cards(&response.list) {
							if card.is_variant() || seen_ids.contains(&card.id) {
								continue;
							}
							// The weekly list is anchored on a week, so its edges can
							// fall outside the requested window.
							if let Some(date) = card.store_date {
								if date < start || date > end {
									continue;
								}
							}
							seen_ids.push(card.id.clone());
							cards.push(card);
						}
					},
					Err(e) => {
						tracing::warn!(week = %week, error = ?e, "LOCG release week failed; continuing");
					},
				}
			}

			week += Duration::weeks(1);
		}

		// Resolve series ids, one lookup per distinct series name.
		let mut releases: Vec<UpcomingRelease> = Vec::new();
		let mut resolved: Vec<(String, Option<String>)> = Vec::new();
		let mut lookups = 0usize;
		let mut skipped_for_budget = 0usize;

		for card in &cards {
			if releases.len() >= cap {
				break;
			}
			let (series_name, number_raw) = parse::split_title_number(&card.title);

			let series_id = match resolved.iter().find(|(name, _)| name == &series_name) {
				Some((_, id)) => id.clone(),
				None => {
					if lookups >= MAX_SERIES_RESOLUTIONS_PER_SWEEP {
						skipped_for_budget += 1;
						continue;
					}
					lookups += 1;
					let id = match self.issue_page_series_id(&card.id).await {
						Ok(id) => id,
						Err(e) => {
							tracing::warn!(issue = %card.id, error = ?e, "LOCG series resolution failed");
							None
						},
					};
					resolved.push((series_name.clone(), id.clone()));
					id
				},
			};

			let Some(series_id) = series_id else {
				continue;
			};

			releases.push(UpcomingRelease {
				series_external_id: series_id,
				external_id: card.id.clone(),
				number: number_raw,
				title: Some(card.title.clone()),
				cover_url: card.cover_url.clone(),
				release_date: card.store_date.map(|d| d.to_string()),
			});
		}

		if skipped_for_budget > 0 {
			tracing::warn!(
				provider = self.id(),
				skipped = skipped_for_budget,
				resolved_series = lookups,
				limit = MAX_SERIES_RESOLUTIONS_PER_SWEEP,
				"LOCG release sweep truncated: release cards carry no series id, so \
				 each new series costs a page fetch. Most-followed series were kept."
			);
		}

		Ok(releases)
	}

	/// Verify the credentials with a single login POST.
	///
	/// Uses the non-retrying probe client, and reads the landing path rather than the
	/// status code: LOCG answers a good login with `303 → /dashboard` and a bad one
	/// with `200` on `/login`.
	#[tracing::instrument(skip(self))]
	async fn validate_credentials(
		&self,
	) -> Result<ProviderValidationResult, MetadataProviderError> {
		let result = match self.login().await? {
			LoginOutcome::Success => ProviderValidationResult::new(
				ProviderValidationStatus::Valid,
				"Signed in to League of Comic Geeks.",
			),
			LoginOutcome::Rejected => ProviderValidationResult::new(
				ProviderValidationStatus::InvalidCredentials,
				"League of Comic Geeks rejected that username or password.",
			),
			LoginOutcome::Blocked => ProviderValidationResult::new(
				ProviderValidationStatus::Forbidden,
				"League of Comic Geeks refused the request — the account may be \
				 blocked, or the site is challenging this server.",
			),
			LoginOutcome::RateLimited => ProviderValidationResult::new(
				ProviderValidationStatus::RateLimited,
				"League of Comic Geeks is rate-limiting this server; try again later.",
			),
			LoginOutcome::ServerError(status) => ProviderValidationResult::new(
				ProviderValidationStatus::ProviderError,
				format!("League of Comic Geeks returned HTTP {status}."),
			),
			LoginOutcome::Unreachable => ProviderValidationResult::new(
				ProviderValidationStatus::NetworkError,
				"Couldn't reach leagueofcomicgeeks.com.",
			),
			LoginOutcome::Unexpected(status, path) => ProviderValidationResult::new(
				ProviderValidationStatus::ProviderError,
				format!("Unexpected response from League of Comic Geeks: HTTP {status} at {path}."),
			),
		};

		Ok(result)
	}
}

fn opt_vec(items: Vec<String>) -> Option<Vec<String>> {
	(!items.is_empty()).then_some(items)
}

#[cfg(test)]
mod tests;
