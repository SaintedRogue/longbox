use std::time::Duration;

use chrono::{Datelike, NaiveDate};
use reqwest_middleware::ClientWithMiddleware;
use serde::{de::DeserializeOwned, Deserialize};

use crate::{
	client::{build_client_with_retry, default_metadata_client, RetryClientConfig},
	error::MetadataProviderError,
	runtime::{cached_get_json, noop_runtime, RuntimeHandle},
	scoring::issue_numbers_match,
	types::{
		ConfidenceFactor, ExternalMediaMetadata, ExternalSeriesMetadata, MatchCandidate,
		MediaType, ProviderValidationResult, ProviderValidationStatus, SearchQuery,
		UpcomingRelease,
	},
	ExternalMetadata, MetadataProvider, RateLimiter,
};

const COMIC_VINE_API_URL: &str = "https://comicvine.gamespot.com/api";

/// ComicVine's published allowance: 200 requests per resource, per hour, on a rolling
/// window.
///
/// There is no header to read this from. Unlike providers that send
/// `X-RateLimit-Remaining`/`-Reset`, ComicVine reports a breach only after the fact —
/// `status_code` 107 ("Rate limit exceeded. Slow down cowboy.") inside an HTTP 200
/// body — so remaining budget cannot be observed, only modelled. It is tracked locally
/// in the host's `metadata_api_usage` ledger; see `budget_policy` in core, which counts
/// per resource as the real limit does and can answer both "how much is left" and "when
/// does it come back".
///
/// This limiter deliberately applies the figure **provider-wide** rather than per
/// resource, which is the conservative reading: a run spanning volumes, issues and
/// issue details actually has ~3× this to spend, and the ledger is what allows it to
/// keep going. Splitting the limiter per resource (a keyed governor) is the next step
/// if provider-wide pacing turns out to be the binding constraint — but the velocity
/// detection below is per API user, not per resource, so some provider-wide floor has
/// to stay regardless.
const COMIC_VINE_REQUESTS_PER_HOUR: u32 = 200;

/// How much of the hourly allowance may be spent back-to-back. Sized to cover a
/// realistic interactive burst — opening a book and matching it costs a volume search,
/// a handful of issue-number lookups and their detail fetches — without putting the
/// whole hour at risk in one go. The remainder refills at the sustained rate
/// (one permit per 18s at 200/hour).
const COMIC_VINE_BURST: u32 = 30;

/// ComicVine asks that requests arrive no faster than one per second per API user, and
/// enforces it with undocumented velocity detection that temporarily blocks a client
/// well before the hourly budget is spent. This is the floor the burst drains at.
const COMIC_VINE_MIN_REQUEST_INTERVAL: Duration = Duration::from_millis(1_100);

/// `status_code` in a ComicVine response envelope meaning "OK". Every other value is
/// an API-level error delivered under an HTTP 200 — see [`comic_vine_body_cacheable`].
const CV_STATUS_OK: i32 = 1;

/// Page size for the volume issue index. ComicVine's list cap is 100 rows.
const VOLUME_INDEX_PAGE_SIZE: usize = 100;

/// Largest volume worth indexing whole, in issues.
///
/// The index costs `ceil(count / 100)` calls where the per-number filter costs 1, so it
/// only pays for itself once several books from the same volume are matched. At 200 the
/// worst case is 2 pages per volume (6 for the three volumes a search may consider)
/// against 1 (3) — a bounded, one-time premium on the *first* book that every later book
/// in the series then rides for free. Long-running titles above this (Detective Comics
/// and friends) fall back to the targeted query, where the index would never amortize.
const VOLUME_INDEX_MAX_ISSUES: usize = 200;

/// ComicVine resource-type-id prefixes used by the singular detail endpoints,
/// e.g. `GET /issue/4000-{id}/`, `GET /volume/4050-{id}/`.
const ISSUE_RESOURCE_PREFIX: &str = "4000";
const VOLUME_RESOURCE_PREFIX: &str = "4050";

/// Comic Vine (https://comicvine.gamespot.com) metadata provider client.
///
/// Auth is a single `api_key` query parameter (unlike Metron, there is no
/// username — the config token is the key verbatim). ComicVine reports API-level
/// errors in the response *body* via `status_code` (1 = OK) rather than the HTTP
/// status, so [`request`](ComicVineClient::request) inspects the envelope.
///
/// Data is free for **non-commercial** use only.
pub struct ComicVineClient {
	client: ClientWithMiddleware,
	api_key: String,
	/// API base URL. Real usage is [`COMIC_VINE_API_URL`]; tests override it to
	/// point at a mock server (see [`ComicVineClient::with_base_url`]).
	base_url: String,
	rate_limiter: RateLimiter,
	/// Host-supplied response cache + budget ledger; [`noop_runtime`] outside core.
	runtime: RuntimeHandle,
}

impl ComicVineClient {
	/// `rate_limit` is the sustained allowance in **requests per hour**, defaulting to
	/// [`COMIC_VINE_REQUESTS_PER_HOUR`]. It used to be read as requests per *minute*,
	/// which is what made the default a flat 3/min: the hourly figure smeared out with
	/// its burst discarded. Nothing in the app passes a value today (see
	/// `metadata_provider` construction in `lib.rs`), so there is no stored config to
	/// reinterpret.
	pub fn new(
		api_key: String,
		rate_limit: Option<u32>,
	) -> Result<Self, MetadataProviderError> {
		Self::with_base_url(api_key, rate_limit, COMIC_VINE_API_URL.to_string())
	}

	/// Attach a host runtime (response cache + budget ledger). Defaults to
	/// [`noop_runtime`] so standalone construction behaves exactly as before.
	pub fn with_runtime(mut self, runtime: RuntimeHandle) -> Self {
		self.runtime = runtime;
		self
	}

	fn with_base_url(
		api_key: String,
		rate_limit: Option<u32>,
		base_url: String,
	) -> Result<Self, MetadataProviderError> {
		Self::build(
			api_key,
			rate_limit,
			base_url,
			COMIC_VINE_MIN_REQUEST_INTERVAL,
		)
	}

	/// `min_interval` is split out so tests can build an unpaced client: the
	/// production velocity floor would otherwise make every multi-request test sleep
	/// through it for no coverage.
	fn build(
		api_key: String,
		rate_limit: Option<u32>,
		base_url: String,
		min_interval: Duration,
	) -> Result<Self, MetadataProviderError> {
		if api_key.trim().is_empty() {
			return Err(MetadataProviderError::MissingToken);
		}
		Ok(Self {
			client: build_client_with_retry(
				default_metadata_client(),
				RetryClientConfig::default(),
			),
			api_key,
			base_url,
			// `rate_limit` is the configured *hourly* allowance. It used to be read as a
			// per-minute figure, which smeared the hour flat and made every match run crawl
			// at 3 requests/minute even with the whole hour untouched.
			rate_limiter: RateLimiter::per_hour_with_burst(
				rate_limit.unwrap_or(COMIC_VINE_REQUESTS_PER_HOUR),
				COMIC_VINE_BURST,
				min_interval,
			),
			runtime: noop_runtime(),
		})
	}

	/// GET a ComicVine resource, always requesting JSON, through the runtime's
	/// response cache: a fresh hit skips the rate limiter and budget entirely.
	/// Returns the raw [`CvEnvelope`]; callers extract typed `results` via
	/// [`CvEnvelope::into_results`] (which maps a non-1 `status_code` to an error).
	#[tracing::instrument(skip(self))]
	async fn request(
		&self,
		path: &str,
		params: &[(&str, String)],
	) -> Result<CvEnvelope, MetadataProviderError> {
		let mut query: Vec<(&str, String)> = vec![
			("api_key", self.api_key.clone()),
			("format", "json".to_string()),
		];
		query.extend(params.iter().cloned());

		let request = self
			.client
			.get(format!("{}/{path}/", self.base_url))
			.query(&query)
			.build()?;
		let body = cached_get_json(
			&self.client,
			self.runtime.as_ref(),
			&self.rate_limiter,
			"comicvine",
			request,
			comic_vine_body_cacheable,
		)
		.await?;
		Ok(serde_json::from_value(body)?)
	}

	/// Resolve issues via the volume→issue path: look up the series' volume(s) by
	/// name, then fetch the exact issue(s) by `(volume, issue_number)`. ComicVine's
	/// free-text `/search` has poor recall for a specific issue (it surfaces related
	/// series and other issues first), so this is the primary path when the query
	/// carries a series name and an issue number. Returns an empty vec — signalling a
	/// fall back to `/search` — when there's no number, no matching volume, or nothing
	/// found.
	async fn search_issues_by_volume(
		&self,
		query: &SearchQuery,
	) -> Result<Vec<MatchCandidate>, MetadataProviderError> {
		let series = query
			.series_name
			.as_deref()
			.filter(|s| !s.is_empty())
			.unwrap_or(&query.title);
		let number = match query.number.as_deref().filter(|n| !n.is_empty()) {
			Some(number) => number,
			None => return Ok(Vec::new()),
		};
		if series.is_empty() {
			return Ok(Vec::new());
		}

		// 1. Find candidate volumes by name (a `contains` match on ComicVine's side).
		let envelope = self
			.request(
				"volumes",
				&[
					// `name:` is a substring match, so a popular franchise ("Absolute
					// Batman") returns many "…: Subtitle" volumes; fetch the max page so
					// the exact-name volume is present for the client-side filter below.
					("filter", format!("name:{series}")),
					("field_list", "id,name,count_of_issues".to_string()),
					("limit", "100".to_string()),
				],
			)
			.await?;
		let volumes: Vec<CvVolumeHit> = envelope.into_results()?;

		// 2. Prefer volumes whose name matches the series exactly; otherwise take the
		//    first couple of near-matches. Keeps the follow-up issue queries bounded.
		let (exact, inexact): (Vec<CvVolumeHit>, Vec<CvVolumeHit>) =
			volumes.into_iter().partition(|v| {
				v.name
					.as_deref()
					.is_some_and(|n| n.eq_ignore_ascii_case(series))
			});
		let selected: Vec<CvVolumeHit> = if exact.is_empty() {
			inexact.into_iter().take(2).collect()
		} else {
			exact.into_iter().take(3).collect()
		};

		// 3. For each selected volume, resolve the issue(s) matching the number.
		let mut issue_ids: Vec<i64> = Vec::new();
		for volume in &selected {
			issue_ids.extend(self.issue_ids_in_volume(volume, number).await?);
		}
		issue_ids.sort_unstable();
		issue_ids.dedup();

		// 4. Fetch full detail for each resolved issue.
		let limit = query.limit.unwrap_or(10) as usize;
		let mut candidates = Vec::with_capacity(issue_ids.len().min(limit));
		for id in issue_ids.into_iter().take(limit) {
			match self.fetch_media_metadata(&id.to_string()).await {
				Ok(metadata) => candidates.push(MatchCandidate {
					provider: self.id().to_string(),
					external_id: id.to_string(),
					metadata: ExternalMetadata::Media(metadata),
					confidence: 0.0,
					confidence_factors: Vec::new(),
				}),
				Err(e) => tracing::error!(
					external_id = id,
					error = ?e,
					"Failed to fetch ComicVine issue detail (volume path)"
				),
			}
		}
		Ok(candidates)
	}

	/// Resolve the ids of the issue(s) in `volume` carrying `number`.
	///
	/// Prefers a **shared volume index**: one unfiltered `/issues/?filter=volume:{id}`
	/// listing per volume, matched against `number` client-side. The point is cache
	/// reuse across a batch. The per-number filter this replaces produces a distinct URL
	/// for every issue number, so matching 50 books from one series meant 50 distinct
	/// cache keys and 50 live calls; the index URL is byte-identical for all 50, so the
	/// first book pays for it and the other 49 are served from
	/// `metadata_response_cache` without touching the API.
	///
	/// Falls back to the targeted filter for volumes larger than
	/// [`VOLUME_INDEX_MAX_ISSUES`], where paging the whole index would cost more calls
	/// than it saves.
	async fn issue_ids_in_volume(
		&self,
		volume: &CvVolumeHit,
		number: &str,
	) -> Result<Vec<i64>, MetadataProviderError> {
		let too_large = volume
			.count_of_issues
			.is_some_and(|count| count as usize > VOLUME_INDEX_MAX_ISSUES);
		if too_large {
			return self.issue_ids_by_number_filter(volume.id, number).await;
		}

		let mut ids = Vec::new();
		let mut offset = 0usize;
		loop {
			let envelope = self
				.request(
					"issues",
					&[
						// Deliberately *not* narrowed by issue_number: the whole value here
						// is that this URL is the same for every book in the volume.
						("filter", format!("volume:{}", volume.id)),
						("field_list", "id,issue_number".to_string()),
						("limit", VOLUME_INDEX_PAGE_SIZE.to_string()),
						("offset", offset.to_string()),
					],
				)
				.await?;
			let page: Vec<CvVolumeIndexIssue> =
				envelope.into_results().unwrap_or_default();
			let page_len = page.len();

			ids.extend(page.into_iter().filter_map(|issue| {
				issue
					.issue_number
					.as_deref()
					.filter(|candidate| issue_numbers_match(candidate, number))
					.map(|_| issue.id)
			}));

			offset += page_len;
			if page_len < VOLUME_INDEX_PAGE_SIZE || offset >= VOLUME_INDEX_MAX_ISSUES {
				break;
			}
		}
		Ok(ids)
	}

	/// The targeted per-number lookup: one call, one issue number. Used for volumes too
	/// large to index whole.
	async fn issue_ids_by_number_filter(
		&self,
		volume_id: i64,
		number: &str,
	) -> Result<Vec<i64>, MetadataProviderError> {
		let envelope = self
			.request(
				"issues",
				&[
					(
						"filter",
						format!("volume:{volume_id},issue_number:{number}"),
					),
					("field_list", "id".to_string()),
					("limit", "5".to_string()),
				],
			)
			.await?;
		let hits: Vec<CvSearchHit> = envelope.into_results().unwrap_or_default();
		Ok(hits.into_iter().map(|h| h.id).collect())
	}
}

#[async_trait::async_trait]
impl MetadataProvider for ComicVineClient {
	fn id(&self) -> &'static str {
		"comicvine"
	}

	/// Windowed store-date sweep for the release-calendar oracle. Paginates
	/// `/issues/` in 100-row pages (through the cache/budget runtime) until the
	/// window is exhausted or `cap` is reached. Issues without a volume link
	/// can't be matched to a series and are skipped.
	async fn fetch_upcoming_releases(
		&self,
		start: NaiveDate,
		end: NaiveDate,
		cap: usize,
	) -> Result<Vec<UpcomingRelease>, MetadataProviderError> {
		const PAGE_SIZE: usize = 100;

		#[derive(Deserialize)]
		struct CvVolumeRef {
			id: i64,
			#[serde(default)]
			name: Option<String>,
		}
		#[derive(Deserialize)]
		struct CvWindowIssue {
			id: i64,
			#[serde(default)]
			name: Option<String>,
			#[serde(default)]
			issue_number: Option<String>,
			#[serde(default)]
			store_date: Option<String>,
			#[serde(default)]
			cover_date: Option<String>,
			#[serde(default)]
			image: Option<CvImage>,
			#[serde(default)]
			volume: Option<CvVolumeRef>,
		}

		let mut releases: Vec<UpcomingRelease> = Vec::new();
		let mut offset = 0usize;
		loop {
			let envelope = self
				.request(
					"issues",
					&[
						("filter", format!("store_date:{start}|{end}")),
						("sort", "store_date:asc".to_string()),
						(
							"field_list",
							"id,name,issue_number,store_date,cover_date,image,volume"
								.to_string(),
						),
						("limit", PAGE_SIZE.to_string()),
						("offset", offset.to_string()),
					],
				)
				.await?;
			let page: Vec<CvWindowIssue> = envelope.into_results()?;
			let page_len = page.len();

			for issue in page {
				// A volume-less issue is still a release. It cannot bind to a library
				// series without an id, but it belongs in "what is coming out".
				let volume = issue.volume;
				releases.push(UpcomingRelease {
					series_external_id: volume.as_ref().map(|v| v.id.to_string()),
					series_name: volume.and_then(|v| v.name),
					external_id: issue.id.to_string(),
					number: issue.issue_number,
					title: issue.name,
					cover_url: issue.image.and_then(|i| i.medium_url.or(i.original_url)),
					release_date: issue.store_date.or(issue.cover_date),
				});
				if releases.len() >= cap {
					return Ok(releases);
				}
			}

			if page_len < PAGE_SIZE {
				break;
			}
			offset += PAGE_SIZE;
		}
		Ok(releases)
	}

	fn name(&self) -> &'static str {
		"Comic Vine"
	}

	fn supported_media_types(&self) -> Vec<MediaType> {
		vec![MediaType::Comic]
	}

	#[tracing::instrument(skip(self))]
	async fn search_series(
		&self,
		query: &SearchQuery,
	) -> Result<Vec<MatchCandidate>, MetadataProviderError> {
		let envelope = self
			.request(
				"search",
				&[
					("resources", "volume".to_string()),
					("query", query.title.clone()),
					("limit", query.limit.unwrap_or(10).to_string()),
				],
			)
			.await?;
		let hits: Vec<CvSearchHit> = envelope.into_results()?;

		let limit = query.limit.unwrap_or(10) as usize;
		let mut candidates = Vec::with_capacity(hits.len().min(limit));
		for hit in hits.into_iter().take(limit) {
			match self.fetch_series_metadata(&hit.id.to_string()).await {
				Ok(metadata) => candidates.push(MatchCandidate {
					provider: self.id().to_string(),
					external_id: hit.id.to_string(),
					metadata: ExternalMetadata::Series(metadata),
					confidence: 0.0,
					confidence_factors: Vec::new(),
				}),
				Err(e) => tracing::error!(
					external_id = hit.id,
					error = ?e,
					"Failed to fetch ComicVine volume detail for search result"
				),
			}
		}

		Ok(self.score_search(query, candidates))
	}

	#[tracing::instrument(skip(self))]
	async fn search_media(
		&self,
		query: &SearchQuery,
	) -> Result<Vec<MatchCandidate>, MetadataProviderError> {
		// A known ComicVine issue ID resolves directly to an exact (1.0) match.
		if let Some(cv_id) = &query.comicvine_id {
			match self.fetch_media_metadata(cv_id).await {
				Ok(metadata) => {
					return Ok(vec![MatchCandidate {
						provider: self.id().to_string(),
						external_id: cv_id.clone(),
						metadata: ExternalMetadata::Media(metadata),
						confidence: 1.0,
						confidence_factors: vec![ConfidenceFactor {
							factor: "comicvine_id_exact".to_string(),
							weight: 1.0,
							matched: true,
						}],
					}]);
				},
				Err(e) => tracing::warn!(
					cv_id,
					error = ?e,
					"ComicVine direct id lookup failed; falling back to fuzzy search"
				),
			}
		}

		// Precise path first: resolve the exact issue via the series' volume, since the
		// free-text /search below has poor recall for a specific issue number.
		let by_volume = self
			.search_issues_by_volume(query)
			.await
			.unwrap_or_default();
		if !by_volume.is_empty() {
			return Ok(self.score_search(query, by_volume));
		}

		let envelope = self
			.request(
				"search",
				&[
					("resources", "issue".to_string()),
					("query", build_issue_search_query(query)),
					("limit", query.limit.unwrap_or(10).to_string()),
				],
			)
			.await?;
		let hits: Vec<CvSearchHit> = envelope.into_results()?;

		let limit = query.limit.unwrap_or(10) as usize;
		let mut candidates = Vec::with_capacity(hits.len().min(limit));
		for hit in hits.into_iter().take(limit) {
			match self.fetch_media_metadata(&hit.id.to_string()).await {
				Ok(metadata) => candidates.push(MatchCandidate {
					provider: self.id().to_string(),
					external_id: hit.id.to_string(),
					metadata: ExternalMetadata::Media(metadata),
					confidence: 0.0,
					confidence_factors: Vec::new(),
				}),
				Err(e) => tracing::error!(
					external_id = hit.id,
					error = ?e,
					"Failed to fetch ComicVine issue detail for search result"
				),
			}
		}

		Ok(self.score_search(query, candidates))
	}

	#[tracing::instrument(skip(self))]
	async fn fetch_series_metadata(
		&self,
		external_id: &str,
	) -> Result<ExternalSeriesMetadata, MetadataProviderError> {
		let envelope = self
			.request(
				&format!(
					"volume/{VOLUME_RESOURCE_PREFIX}-{}",
					numeric_id(external_id)
				),
				&[],
			)
			.await?;
		let volume: CvVolume = envelope.into_results()?;
		Ok(map_volume(volume, self.id()))
	}

	#[tracing::instrument(skip(self))]
	async fn fetch_media_metadata(
		&self,
		external_id: &str,
	) -> Result<ExternalMediaMetadata, MetadataProviderError> {
		let envelope = self
			.request(
				&format!("issue/{ISSUE_RESOURCE_PREFIX}-{}", numeric_id(external_id)),
				&[],
			)
			.await?;
		let issue: CvIssue = envelope.into_results()?;
		Ok(map_issue(issue, self.id()))
	}

	#[tracing::instrument(skip(self))]
	async fn validate_credentials(
		&self,
	) -> Result<ProviderValidationResult, MetadataProviderError> {
		self.rate_limiter.until_ready().await;

		let send_result = self
			.client
			.get(format!("{}/publishers/", self.base_url))
			.query(&[
				("api_key", self.api_key.as_str()),
				("format", "json"),
				("limit", "1"),
			])
			.send()
			.await;

		let response = match send_result {
			Ok(response) => response,
			Err(e) => {
				tracing::warn!(error = ?e, "ComicVine validation could not reach the host");
				return Ok(ProviderValidationResult::new(
					ProviderValidationStatus::NetworkError,
					"Couldn't reach comicvine.gamespot.com.",
				));
			},
		};

		let http_status = response.status();
		if !http_status.is_success() {
			return Ok(match http_status.as_u16() {
				401 | 403 => ProviderValidationResult::new(
					ProviderValidationStatus::Forbidden,
					"Access denied — the request may have been filtered.",
				),
				429 => ProviderValidationResult::new(
					ProviderValidationStatus::RateLimited,
					"ComicVine rate limit hit (200/resource/hour). Try again shortly.",
				),
				500..=599 => ProviderValidationResult::new(
					ProviderValidationStatus::ProviderError,
					"ComicVine is having server issues. Try again later.",
				),
				other => ProviderValidationResult::new(
					ProviderValidationStatus::ProviderError,
					format!("Unexpected response from ComicVine (HTTP {other})."),
				),
			});
		}

		// A 200 that isn't the JSON envelope means a bot filter answered, not the API.
		let envelope = match response.json::<CvEnvelope>().await {
			Ok(envelope) => envelope,
			Err(_) => {
				return Ok(ProviderValidationResult::new(
					ProviderValidationStatus::Forbidden,
					"Unexpected non-JSON response from ComicVine — the request may have \
					 been intercepted by a bot filter.",
				));
			},
		};

		Ok(match envelope.status_code {
			CV_STATUS_OK => ProviderValidationResult::new(
				ProviderValidationStatus::Valid,
				"Credentials verified.",
			),
			100 => ProviderValidationResult::new(
				ProviderValidationStatus::InvalidCredentials,
				"API key rejected.",
			),
			107 => ProviderValidationResult::new(
				ProviderValidationStatus::RateLimited,
				"ComicVine rate limit hit (200/resource/hour). Try again shortly.",
			),
			other => ProviderValidationResult::new(
				ProviderValidationStatus::ProviderError,
				format!("Unexpected ComicVine status_code {other}."),
			),
		})
	}
}

/// Extract the trailing numeric id from a ComicVine external id, tolerating both
/// the bare numeric form (`"12345"`) and the prefixed form (`"4000-12345"`).
fn numeric_id(external_id: &str) -> &str {
	external_id.rsplit('-').next().unwrap_or(external_id)
}

/// Build the free-text query for the `/search` issue endpoint: the series name
/// (falling back to the generic title) plus the issue number when known.
fn build_issue_search_query(query: &SearchQuery) -> String {
	let base = query
		.series_name
		.clone()
		.filter(|s| !s.is_empty())
		.unwrap_or_else(|| query.title.clone());
	match &query.number {
		Some(number) if !number.is_empty() => format!("{base} {number}"),
		_ => base,
	}
}

/// Map a ComicVine issue detail into [`ExternalMediaMetadata`].
fn map_issue(issue: CvIssue, provider_id: &str) -> ExternalMediaMetadata {
	let credits = bucket_credits(issue.person_credits.as_deref().unwrap_or(&[]));
	let (year, month, day) = parse_ymd(issue.cover_date.as_deref());

	let series_name = issue.volume.as_ref().and_then(|v| v.name.clone());
	let series_external_id = issue.volume.as_ref().map(|v| v.id.to_string());
	let number = issue
		.issue_number
		.as_deref()
		.and_then(|n| n.parse::<f32>().ok());
	let number_raw = issue.issue_number.filter(|s| !s.trim().is_empty());
	let story_title = issue.name.filter(|s| !s.trim().is_empty());
	// Compose the audiobookshelf-style "{Series} #{n}" display title (the format the
	// user selected); fall back to the story title when we can't compose one.
	let title = series_name
		.as_deref()
		.and_then(|series| {
			crate::title::compose_comic_title(series, number_raw.as_deref())
		})
		.or(story_title);

	ExternalMediaMetadata {
		provider: provider_id.to_string(),
		external_id: issue.id.to_string(),
		title,
		summary: issue
			.deck
			.filter(|s| !s.trim().is_empty())
			.or_else(|| issue.description.as_deref().map(strip_html))
			.filter(|s| !s.trim().is_empty()),
		number,
		number_raw,
		series_name,
		series_external_id,
		day,
		month,
		year,
		writers: non_empty(credits.writers),
		artists: non_empty(credits.artists),
		colorists: non_empty(credits.colorists),
		letterers: non_empty(credits.letterers),
		cover_artists: non_empty(credits.cover_artists),
		pencillers: non_empty(credits.pencillers),
		inkers: non_empty(credits.inkers),
		editors: non_empty(credits.editors),
		characters: non_empty(named_refs(issue.character_credits)),
		teams: non_empty(named_refs(issue.team_credits)),
		story_arc: non_empty(named_refs(issue.story_arc_credits))
			.map(|arcs| arcs.join(", ")),
		cover_url: issue.image.and_then(|i| i.original_url.or(i.medium_url)),
		provider_url: issue.site_detail_url,
		..Default::default()
	}
}

/// Map a ComicVine volume detail into [`ExternalSeriesMetadata`].
fn map_volume(volume: CvVolume, provider_id: &str) -> ExternalSeriesMetadata {
	ExternalSeriesMetadata {
		provider: provider_id.to_string(),
		external_id: volume.id.to_string(),
		title: volume.name.unwrap_or_default(),
		alternative_titles: vec![],
		summary: volume
			.deck
			.filter(|s| !s.trim().is_empty())
			.or_else(|| volume.description.as_deref().map(strip_html))
			.filter(|s| !s.trim().is_empty()),
		year: volume
			.start_year
			.as_deref()
			.and_then(|s| s.trim().parse::<i32>().ok()),
		publisher: volume.publisher.and_then(|p| p.name),
		volume_count: volume.count_of_issues,
		cover_url: volume.image.and_then(|i| i.original_url.or(i.medium_url)),
		..Default::default()
	}
}

#[derive(Debug, Default)]
struct CreditBuckets {
	writers: Vec<String>,
	pencillers: Vec<String>,
	inkers: Vec<String>,
	colorists: Vec<String>,
	letterers: Vec<String>,
	cover_artists: Vec<String>,
	editors: Vec<String>,
	/// Catch-all for roles that don't map to a more specific bucket
	artists: Vec<String>,
}

/// Bucket ComicVine person credits by role. ComicVine encodes a creator's roles
/// as a single comma-joined string (e.g. `"writer, cover"`), so each is split and
/// normalized before matching — the key difference from Metron's array-of-roles.
fn bucket_credits(credits: &[CvPersonCredit]) -> CreditBuckets {
	let mut buckets = CreditBuckets::default();

	for credit in credits {
		let Some(name) = credit.name.as_ref().filter(|n| !n.trim().is_empty()) else {
			continue;
		};
		let roles = credit.role.as_deref().unwrap_or("");
		for role in roles
			.split(',')
			.map(|r| r.trim().to_lowercase())
			.filter(|r| !r.is_empty())
		{
			match role.as_str() {
				"writer" => buckets.writers.push(name.clone()),
				"penciler" | "penciller" => buckets.pencillers.push(name.clone()),
				"inker" => buckets.inkers.push(name.clone()),
				"colorist" | "colourist" => buckets.colorists.push(name.clone()),
				"letterer" => buckets.letterers.push(name.clone()),
				"cover" => buckets.cover_artists.push(name.clone()),
				"editor" => buckets.editors.push(name.clone()),
				_ => buckets.artists.push(name.clone()),
			}
		}
	}

	buckets
}

fn named_refs(refs: Option<Vec<CvNamedRef>>) -> Vec<String> {
	refs.unwrap_or_default()
		.into_iter()
		.filter_map(|r| r.name)
		.filter(|n| !n.trim().is_empty())
		.collect()
}

fn parse_ymd(date: Option<&str>) -> (Option<i32>, Option<i32>, Option<i32>) {
	date.and_then(|d| NaiveDate::parse_from_str(d, "%Y-%m-%d").ok())
		.map(|d| (Some(d.year()), Some(d.month() as i32), Some(d.day() as i32)))
		.unwrap_or((None, None, None))
}

/// Strip HTML tags from ComicVine's `description` (which is rich HTML) to a plain
/// string, collapsing runs of whitespace. Deliberately minimal — a full parser
/// isn't warranted for a summary field.
fn strip_html(html: &str) -> String {
	let mut out = String::with_capacity(html.len());
	let mut in_tag = false;
	for ch in html.chars() {
		match ch {
			'<' => in_tag = true,
			'>' => in_tag = false,
			_ if !in_tag => out.push(ch),
			_ => {},
		}
	}
	out.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn non_empty(items: Vec<String>) -> Option<Vec<String>> {
	if items.is_empty() {
		None
	} else {
		Some(items)
	}
}

// --- ComicVine API response shapes ---
// ComicVine wraps every response in an envelope and reports errors via
// `status_code` (1 = OK). `results` is an object for the singular detail
// endpoints and an array for list/search endpoints, so it is kept as a raw
// `Value` and deserialized by the caller (see `CvEnvelope::into_results`).

#[derive(Debug, Deserialize)]
struct CvEnvelope {
	#[serde(default)]
	status_code: i32,
	#[serde(default)]
	error: String,
	#[serde(default)]
	results: serde_json::Value,
}

impl CvEnvelope {
	fn into_results<T: DeserializeOwned>(self) -> Result<T, MetadataProviderError> {
		if self.status_code != CV_STATUS_OK {
			return Err(cv_status_error(self.status_code, &self.error));
		}
		serde_json::from_value(self.results).map_err(MetadataProviderError::from)
	}
}

/// Only a successful envelope is worth storing.
///
/// ComicVine puts API-level failures in the *body* of an HTTP 200: 107 for the rate
/// limit, 100 for a rejected key, 101 for a missing object. Without this check those
/// envelopes were cached under the requested URL and replayed for the full TTL — 12
/// hours for a search, 7 days for a detail lookup — so a brief rate-limit blip during
/// a bulk match run turned into a day of "rate limit exceeded" for exactly the books
/// that were being matched, long after the real window had reset.
fn comic_vine_body_cacheable(body: &serde_json::Value) -> bool {
	body.get("status_code").and_then(serde_json::Value::as_i64)
		== Some(CV_STATUS_OK as i64)
}

fn cv_status_error(status_code: i32, error: &str) -> MetadataProviderError {
	match status_code {
		100 => {
			MetadataProviderError::Other(format!("ComicVine: invalid API key ({error})"))
		},
		101 => MetadataProviderError::NotFound(error.to_string()),
		107 => MetadataProviderError::RateLimited,
		other => {
			MetadataProviderError::Other(format!("ComicVine error {other}: {error}"))
		},
	}
}

#[derive(Debug, Deserialize)]
struct CvSearchHit {
	id: i64,
}

#[derive(Debug, Deserialize)]
struct CvVolumeHit {
	id: i64,
	#[serde(default)]
	name: Option<String>,
	/// Requested in the same `field_list` as `id`/`name`, so it costs no extra call.
	/// Decides whether the volume is small enough to index whole — see
	/// [`ComicVineClient::issue_ids_in_volume`].
	#[serde(default)]
	count_of_issues: Option<i64>,
}

/// One row of a volume's issue index: enough to match an issue number client-side
/// without fetching per-issue detail.
#[derive(Debug, Deserialize)]
struct CvVolumeIndexIssue {
	id: i64,
	#[serde(default)]
	issue_number: Option<String>,
}

#[derive(Debug, Deserialize)]
struct CvIssue {
	id: i64,
	#[serde(default)]
	issue_number: Option<String>,
	#[serde(default)]
	name: Option<String>,
	#[serde(default)]
	cover_date: Option<String>,
	#[serde(default)]
	description: Option<String>,
	#[serde(default)]
	deck: Option<String>,
	#[serde(default)]
	image: Option<CvImage>,
	#[serde(default)]
	volume: Option<CvVolumeRef>,
	#[serde(default)]
	person_credits: Option<Vec<CvPersonCredit>>,
	#[serde(default)]
	character_credits: Option<Vec<CvNamedRef>>,
	#[serde(default)]
	team_credits: Option<Vec<CvNamedRef>>,
	#[serde(default)]
	story_arc_credits: Option<Vec<CvNamedRef>>,
	#[serde(default)]
	site_detail_url: Option<String>,
}

#[derive(Debug, Deserialize)]
struct CvVolume {
	id: i64,
	#[serde(default)]
	name: Option<String>,
	#[serde(default)]
	start_year: Option<String>,
	#[serde(default)]
	count_of_issues: Option<i32>,
	#[serde(default)]
	description: Option<String>,
	#[serde(default)]
	deck: Option<String>,
	#[serde(default)]
	publisher: Option<CvNamedRef>,
	#[serde(default)]
	image: Option<CvImage>,
}

#[derive(Debug, Deserialize)]
struct CvVolumeRef {
	id: i64,
	#[serde(default)]
	name: Option<String>,
}

#[derive(Debug, Deserialize)]
struct CvImage {
	#[serde(default)]
	original_url: Option<String>,
	#[serde(default)]
	medium_url: Option<String>,
}

#[derive(Debug, Deserialize)]
struct CvPersonCredit {
	#[serde(default)]
	name: Option<String>,
	#[serde(default)]
	role: Option<String>,
}

#[derive(Debug, Deserialize)]
struct CvNamedRef {
	#[serde(default)]
	name: Option<String>,
}

#[cfg(test)]
mod tests {
	use std::sync::Arc;

	use super::*;
	use serde_json::json;
	use wiremock::{
		matchers::{method, path},
		Mock, MockServer, ResponseTemplate,
	};

	fn client(base_url: String) -> ComicVineClient {
		// A large hourly allowance and no velocity floor: pagination tests make several
		// requests back to back and must not sleep through production pacing.
		ComicVineClient::build(
			"test-key".to_string(),
			Some(100_000),
			base_url,
			Duration::ZERO,
		)
		.expect("valid key")
	}

	/// A runtime that caches every offered body, so the test can observe exactly what
	/// the provider chose to store.
	#[derive(Default)]
	struct RecordingRuntime {
		store: tokio::sync::Mutex<std::collections::HashMap<String, serde_json::Value>>,
	}

	#[async_trait::async_trait]
	impl crate::runtime::ProviderRuntime for RecordingRuntime {
		async fn cache_get(
			&self,
			_provider: &str,
			url: &str,
		) -> Option<serde_json::Value> {
			self.store
				.lock()
				.await
				.get(&crate::response_cache::cache_key(url))
				.cloned()
		}
		async fn cache_put(&self, _provider: &str, url: &str, body: &serde_json::Value) {
			self.store
				.lock()
				.await
				.insert(crate::response_cache::cache_key(url), body.clone());
		}
		async fn record_call(&self, _provider: &str, _url: &str) {}
		async fn budget_exhausted(&self, _provider: &str) -> bool {
			false
		}
	}

	/// A rate-limit envelope must never be cached.
	///
	/// ComicVine answers a breached limit with HTTP 200 and `status_code: 107`. Caching
	/// that body stored "Rate limit exceeded" under the requested URL's key and replayed
	/// it for the whole TTL — 7 days for a detail lookup — so a blip during a bulk match
	/// run outlived the hourly window that caused it by days.
	#[tokio::test]
	async fn rate_limit_envelope_is_not_cached() {
		let server = MockServer::start().await;
		// First call is rate limited, the second succeeds. If the 107 were cached, the
		// second call would be served from the cache and never reach this second mock.
		Mock::given(method("GET"))
			.and(path("/issue/4000-42/"))
			.respond_with(ResponseTemplate::new(200).set_body_json(json!({
				"status_code": 107,
				"error": "Rate limit exceeded. Slow down cowboy.",
				"results": [],
			})))
			.up_to_n_times(1)
			.expect(1)
			.mount(&server)
			.await;
		Mock::given(method("GET"))
			.and(path("/issue/4000-42/"))
			.respond_with(ResponseTemplate::new(200).set_body_json(json!({
				"status_code": 1,
				"results": { "id": 42, "name": "After the window reset" },
			})))
			.expect(1)
			.mount(&server)
			.await;

		let runtime: RuntimeHandle = Arc::new(RecordingRuntime::default());
		let cv = client(server.uri()).with_runtime(runtime.clone());

		let limited = cv.fetch_media_metadata("42").await;
		assert!(
			matches!(limited, Err(MetadataProviderError::RateLimited)),
			"a 107 envelope must surface as RateLimited, got {limited:?}"
		);

		let recovered = cv
			.fetch_media_metadata("42")
			.await
			.expect("the retry must reach the network, not a cached 107");
		assert_eq!(recovered.title.as_deref(), Some("After the window reset"));
	}

	/// The counterpart: a *successful* envelope still gets cached, so the fix above did
	/// not simply disable caching for ComicVine.
	#[tokio::test]
	async fn successful_envelope_is_still_cached() {
		let server = MockServer::start().await;
		Mock::given(method("GET"))
			.and(path("/issue/4000-7/"))
			.respond_with(ResponseTemplate::new(200).set_body_json(json!({
				"status_code": 1,
				"results": { "id": 7, "name": "Cached" },
			})))
			.expect(1) // exactly one network hit for two lookups
			.mount(&server)
			.await;

		let runtime: RuntimeHandle = Arc::new(RecordingRuntime::default());
		let cv = client(server.uri()).with_runtime(runtime.clone());

		for _ in 0..2 {
			let issue = cv.fetch_media_metadata("7").await.expect("lookup succeeds");
			assert_eq!(issue.title.as_deref(), Some("Cached"));
		}
	}

	/// Bulk matching must not re-query per issue number.
	///
	/// Matching a run of books from one series used to issue a
	/// `filter=volume:X,issue_number:N` query per book. Every number produced a
	/// different URL, so the response cache — which keys on the normalized URL — could
	/// never serve the second book, and 50 omnibuses cost 50 live calls against a
	/// 200/hour budget. Pulling the volume's issue index once gives all of them the same
	/// URL, so only the first book pays.
	#[tokio::test]
	async fn volume_issue_index_is_shared_across_issue_numbers() {
		use wiremock::matchers::query_param;

		let server = MockServer::start().await;
		Mock::given(method("GET"))
			.and(path("/volumes/"))
			.respond_with(ResponseTemplate::new(200).set_body_json(json!({
				"status_code": 1,
				"results": [{ "id": 900, "name": "Spider-Man", "count_of_issues": 3 }],
			})))
			.mount(&server)
			.await;
		// One unfiltered index call serves every issue number in the volume. `expect(1)`
		// is the assertion: a second call here means the per-number URLs came back.
		Mock::given(method("GET"))
			.and(path("/issues/"))
			.and(query_param("filter", "volume:900"))
			.respond_with(ResponseTemplate::new(200).set_body_json(json!({
				"status_code": 1,
				"results": [
					{ "id": 11, "issue_number": "1" },
					{ "id": 12, "issue_number": "2" },
					{ "id": 13, "issue_number": "3" },
				],
			})))
			.expect(1)
			.mount(&server)
			.await;
		for id in [11, 12, 13] {
			Mock::given(method("GET"))
				.and(path(format!("/issue/4000-{id}/")))
				.respond_with(ResponseTemplate::new(200).set_body_json(json!({
					"status_code": 1,
					"results": { "id": id, "name": format!("Issue {id}") },
				})))
				.mount(&server)
				.await;
		}

		let runtime: RuntimeHandle = Arc::new(RecordingRuntime::default());
		let cv = client(server.uri()).with_runtime(runtime.clone());

		for (number, expected_id) in [("1", "11"), ("2", "12"), ("3", "13")] {
			let query = SearchQuery {
				title: "Spider-Man".to_string(),
				series_name: Some("Spider-Man".to_string()),
				number: Some(number.to_string()),
				..Default::default()
			};
			let candidates = cv.search_media(&query).await.expect("search succeeds");
			assert_eq!(
				candidates.first().map(|c| c.external_id.as_str()),
				Some(expected_id),
				"issue {number} must resolve through the shared index"
			);
		}
		// MockServer verifies expect(1) on the index call at drop.
	}

	/// A volume too large to index whole still resolves through the targeted filter,
	/// so the optimization above never turns a one-call lookup into a five-page crawl.
	#[tokio::test]
	async fn oversized_volume_falls_back_to_the_number_filter() {
		use wiremock::matchers::query_param;

		let server = MockServer::start().await;
		Mock::given(method("GET"))
			.and(path("/volumes/"))
			.respond_with(ResponseTemplate::new(200).set_body_json(json!({
				"status_code": 1,
				"results": [{
					"id": 901,
					"name": "Detective Comics",
					"count_of_issues": VOLUME_INDEX_MAX_ISSUES + 1,
				}],
			})))
			.mount(&server)
			.await;
		Mock::given(method("GET"))
			.and(path("/issues/"))
			.and(query_param("filter", "volume:901,issue_number:27"))
			.respond_with(ResponseTemplate::new(200).set_body_json(json!({
				"status_code": 1,
				"results": [{ "id": 27 }],
			})))
			.expect(1)
			.mount(&server)
			.await;
		Mock::given(method("GET"))
			.and(path("/issue/4000-27/"))
			.respond_with(ResponseTemplate::new(200).set_body_json(json!({
				"status_code": 1,
				"results": { "id": 27, "name": "The Case of the Chemical Syndicate" },
			})))
			.mount(&server)
			.await;

		let query = SearchQuery {
			title: "Detective Comics".to_string(),
			series_name: Some("Detective Comics".to_string()),
			number: Some("27".to_string()),
			..Default::default()
		};
		let candidates = client(server.uri())
			.search_media(&query)
			.await
			.expect("search succeeds");
		assert_eq!(
			candidates.first().map(|c| c.external_id.as_str()),
			Some("27")
		);
	}

	fn window_issue(id: i64, volume_id: Option<i64>) -> serde_json::Value {
		let mut issue = json!({
			"id": id,
			"name": format!("Issue {id}"),
			"issue_number": id.to_string(),
			"store_date": "2026-08-12",
			"cover_date": "2026-08-01",
			"image": { "medium_url": format!("https://cv.example/{id}.jpg") },
		});
		if let Some(vid) = volume_id {
			issue["volume"] = json!({ "id": vid, "name": "Saga" });
		}
		issue
	}

	#[tokio::test]
	async fn upcoming_releases_paginate_and_keep_volumeless() {
		use wiremock::matchers::query_param;

		let server = MockServer::start().await;
		// Page 1: a full 100-row page (99 with volumes + 1 without, which is kept but
		// left unbound) forces a second request at offset=100.
		let mut page_one: Vec<serde_json::Value> =
			(1..=99).map(|i| window_issue(i, Some(1000 + i))).collect();
		page_one.push(window_issue(500, None));
		Mock::given(method("GET"))
			.and(path("/issues/"))
			.and(query_param("offset", "0"))
			.respond_with(ResponseTemplate::new(200).set_body_json(json!({
				"status_code": 1, "results": page_one,
			})))
			.expect(1)
			.mount(&server)
			.await;
		Mock::given(method("GET"))
			.and(path("/issues/"))
			.and(query_param("offset", "100"))
			.respond_with(ResponseTemplate::new(200).set_body_json(json!({
				"status_code": 1, "results": [window_issue(200, Some(2000))],
			})))
			.expect(1)
			.mount(&server)
			.await;

		let releases = client(server.uri())
			.fetch_upcoming_releases(
				NaiveDate::from_ymd_opt(2026, 7, 26).unwrap(),
				NaiveDate::from_ymd_opt(2026, 11, 7).unwrap(),
				3000,
			)
			.await
			.expect("sweep succeeds");

		assert_eq!(releases.len(), 101, "100 on page 1 + 1 on page 2");
		// The volumeless row is reported like any other, with nothing to bind it by.
		let volumeless = releases
			.iter()
			.find(|r| r.external_id == "500")
			.expect("a volumeless issue is still a release");
		assert_eq!(volumeless.series_external_id, None);

		let first = &releases[0];
		assert_eq!(first.series_external_id.as_deref(), Some("1001"));
		assert_eq!(first.external_id, "1");
		assert_eq!(first.number.as_deref(), Some("1"));
		assert_eq!(first.release_date.as_deref(), Some("2026-08-12"));
		assert!(first.cover_url.as_deref().unwrap().contains("cv.example"));
	}

	#[tokio::test]
	async fn upcoming_releases_respect_the_cap() {
		let server = MockServer::start().await;
		let page: Vec<serde_json::Value> =
			(1..=50).map(|i| window_issue(i, Some(1))).collect();
		Mock::given(method("GET"))
			.and(path("/issues/"))
			.respond_with(ResponseTemplate::new(200).set_body_json(json!({
				"status_code": 1, "results": page,
			})))
			.expect(1) // the cap must stop pagination after one page
			.mount(&server)
			.await;

		let releases = client(server.uri())
			.fetch_upcoming_releases(
				NaiveDate::from_ymd_opt(2026, 7, 26).unwrap(),
				NaiveDate::from_ymd_opt(2026, 11, 7).unwrap(),
				10,
			)
			.await
			.expect("sweep succeeds");
		assert_eq!(releases.len(), 10);
	}

	#[test]
	fn new_rejects_empty_key() {
		assert!(matches!(
			ComicVineClient::new("   ".to_string(), None),
			Err(MetadataProviderError::MissingToken)
		));
	}

	#[test]
	fn numeric_id_strips_resource_prefix() {
		assert_eq!(numeric_id("4000-12345"), "12345");
		assert_eq!(numeric_id("12345"), "12345");
	}

	#[test]
	fn build_issue_search_query_prefers_series_name_and_number() {
		let query = SearchQuery {
			title: "ignored".to_string(),
			series_name: Some("Absolute Batman".to_string()),
			number: Some("1".to_string()),
			..Default::default()
		};
		assert_eq!(build_issue_search_query(&query), "Absolute Batman 1");
	}

	#[test]
	fn build_issue_search_query_falls_back_to_title() {
		let query = SearchQuery {
			title: "Absolute Batman".to_string(),
			..Default::default()
		};
		assert_eq!(build_issue_search_query(&query), "Absolute Batman");
	}

	#[test]
	fn strip_html_removes_tags_and_collapses_whitespace() {
		assert_eq!(
			strip_html("<p>Bruce  Wayne\n<i>never</i> inherited</p>"),
			"Bruce Wayne never inherited"
		);
	}

	const ISSUE_DETAIL: &str = r#"
	{
		"id": 78901,
		"issue_number": "1",
		"name": null,
		"cover_date": "2024-12-01",
		"deck": "A rawer, self-made Batman rises.",
		"description": "<p>In a Gotham where <i>Bruce Wayne</i> never inherited the fortune.</p>",
		"image": { "original_url": "https://static.comicvine.com/ab-1.jpg", "medium_url": "https://static.comicvine.com/ab-1-med.jpg" },
		"volume": { "id": 4412, "name": "Absolute Batman" },
		"person_credits": [
			{ "name": "Scott Snyder", "role": "writer" },
			{ "name": "Nick Dragotta", "role": "penciler, inker, cover" },
			{ "name": "Frank Martin", "role": "colorist" },
			{ "name": "Clayton Cowles", "role": "letterer" }
		],
		"character_credits": [ { "name": "Batman" }, { "name": "Bruce Wayne" } ],
		"team_credits": [],
		"story_arc_credits": [ { "name": "The Zoo" } ],
		"site_detail_url": "https://comicvine.gamespot.com/absolute-batman-1/4000-78901/"
	}
	"#;

	fn parse_issue() -> CvIssue {
		serde_json::from_str(ISSUE_DETAIL).unwrap()
	}

	#[test]
	fn map_issue_buckets_comma_joined_roles() {
		let meta = map_issue(parse_issue(), "comicvine");
		assert_eq!(meta.writers, Some(vec!["Scott Snyder".to_string()]));
		assert_eq!(meta.pencillers, Some(vec!["Nick Dragotta".to_string()]));
		assert_eq!(meta.inkers, Some(vec!["Nick Dragotta".to_string()]));
		assert_eq!(meta.cover_artists, Some(vec!["Nick Dragotta".to_string()]));
		assert_eq!(meta.colorists, Some(vec!["Frank Martin".to_string()]));
		assert_eq!(meta.letterers, Some(vec!["Clayton Cowles".to_string()]));
	}

	#[test]
	fn map_issue_maps_core_fields() {
		let meta = map_issue(parse_issue(), "comicvine");
		assert_eq!(meta.external_id, "78901");
		assert_eq!(meta.series_name, Some("Absolute Batman".to_string()));
		assert_eq!(meta.series_external_id, Some("4412".to_string()));
		assert_eq!(meta.number, Some(1.0));
		assert_eq!(meta.number_raw, Some("1".to_string()));
		assert_eq!(meta.year, Some(2024));
		assert_eq!(meta.month, Some(12));
		assert_eq!(meta.day, Some(1));
		assert_eq!(
			meta.characters,
			Some(vec!["Batman".into(), "Bruce Wayne".into()])
		);
		assert_eq!(meta.story_arc, Some("The Zoo".to_string()));
		// title is composed as "{Series} #{n}" even though this issue has no story title
		assert_eq!(meta.title, Some("Absolute Batman #1".to_string()));
		// deck is preferred over the HTML description for the summary
		assert_eq!(
			meta.summary,
			Some("A rawer, self-made Batman rises.".to_string())
		);
	}

	#[test]
	fn map_issue_falls_back_to_stripped_description() {
		let issue: CvIssue = serde_json::from_str(&ISSUE_DETAIL.replace(
			r#""deck": "A rawer, self-made Batman rises.","#,
			r#""deck": null,"#,
		))
		.unwrap();
		let meta = map_issue(issue, "comicvine");
		assert_eq!(
			meta.summary,
			Some(
				"In a Gotham where Bruce Wayne never inherited the fortune.".to_string()
			)
		);
	}

	#[test]
	fn map_issue_preserves_non_numeric_issue_number() {
		let issue: CvIssue = serde_json::from_str(
			&ISSUE_DETAIL
				.replace(r#""issue_number": "1","#, r#""issue_number": "1.MU","#),
		)
		.unwrap();
		let meta = map_issue(issue, "comicvine");
		assert_eq!(meta.number, None); // f32 parse fails
		assert_eq!(meta.number_raw, Some("1.MU".to_string())); // raw kept
	}

	#[tokio::test]
	async fn fetch_media_metadata_hits_prefixed_detail_endpoint() {
		let server = MockServer::start().await;
		Mock::given(method("GET"))
			.and(path("/issue/4000-78901/"))
			.respond_with(ResponseTemplate::new(200).set_body_json(json!({
				"status_code": 1,
				"error": "OK",
				"results": serde_json::from_str::<serde_json::Value>(ISSUE_DETAIL).unwrap()
			})))
			.mount(&server)
			.await;

		let meta = client(server.uri())
			.fetch_media_metadata("78901")
			.await
			.expect("fetch ok");
		assert_eq!(meta.series_name, Some("Absolute Batman".to_string()));
		assert_eq!(meta.writers, Some(vec!["Scott Snyder".to_string()]));
	}

	#[tokio::test]
	async fn search_media_by_comicvine_id_is_exact_match() {
		let server = MockServer::start().await;
		Mock::given(method("GET"))
			.and(path("/issue/4000-78901/"))
			.respond_with(ResponseTemplate::new(200).set_body_json(json!({
				"status_code": 1,
				"results": serde_json::from_str::<serde_json::Value>(ISSUE_DETAIL).unwrap()
			})))
			.mount(&server)
			.await;

		let query = SearchQuery {
			title: "Absolute Batman".to_string(),
			comicvine_id: Some("78901".to_string()),
			..Default::default()
		};
		let candidates = client(server.uri()).search_media(&query).await.unwrap();
		assert_eq!(candidates.len(), 1);
		assert_eq!(candidates[0].confidence, 1.0);
	}

	#[tokio::test]
	async fn search_media_resolves_exact_issue_via_volume() {
		let server = MockServer::start().await;
		// Volume lookup by name returns the exact volume plus a decoy near-match.
		Mock::given(method("GET"))
			.and(path("/volumes/"))
			.respond_with(ResponseTemplate::new(200).set_body_json(json!({
				"status_code": 1,
				"results": [
					{ "id": 4412, "name": "Absolute Batman" },
					{ "id": 9999, "name": "Absolute Batman: Hush" }
				]
			})))
			.mount(&server)
			.await;
		// The volume's issue index resolves the exact issue id. `issue_number` is part of
		// the row because the number is matched client-side now -- the request is the
		// volume's whole index rather than a per-number filter, so that every book in the
		// volume shares one cache entry (see volume_issue_index_is_shared_across_issue_numbers).
		Mock::given(method("GET"))
			.and(path("/issues/"))
			.respond_with(ResponseTemplate::new(200).set_body_json(json!({
				"status_code": 1,
				"results": [ { "id": 78901, "issue_number": "1" } ]
			})))
			.mount(&server)
			.await;
		Mock::given(method("GET"))
			.and(path("/issue/4000-78901/"))
			.respond_with(ResponseTemplate::new(200).set_body_json(json!({
				"status_code": 1,
				"results": serde_json::from_str::<serde_json::Value>(ISSUE_DETAIL).unwrap()
			})))
			.mount(&server)
			.await;

		let query = SearchQuery {
			title: "Absolute Batman".into(),
			series_name: Some("Absolute Batman".into()),
			number: Some("1".into()),
			..Default::default()
		};
		let candidates = client(server.uri()).search_media(&query).await.unwrap();

		// The exact issue is retrieved (not reachable via free-text /search) and, with
		// the scorer's series+number signal, ranks first at auto-apply confidence.
		assert_eq!(
			candidates.first().map(|c| c.external_id.as_str()),
			Some("78901")
		);
		assert!(
			candidates[0].confidence >= 0.95,
			"exact volume+issue match should be >= 0.95, got {}",
			candidates[0].confidence
		);
	}

	#[tokio::test]
	async fn into_results_maps_invalid_key_status() {
		let server = MockServer::start().await;
		Mock::given(method("GET"))
			.and(path("/issue/4000-1/"))
			.respond_with(ResponseTemplate::new(200).set_body_json(json!({
				"status_code": 100,
				"error": "Invalid API Key",
				"results": []
			})))
			.mount(&server)
			.await;

		let err = client(server.uri())
			.fetch_media_metadata("1")
			.await
			.expect_err("should surface invalid key");
		assert!(matches!(err, MetadataProviderError::Other(_)));
	}

	async fn validate_with_status_code(code: i32) -> ProviderValidationStatus {
		let server = MockServer::start().await;
		Mock::given(method("GET"))
			.and(path("/publishers/"))
			.respond_with(
				ResponseTemplate::new(200)
					.set_body_json(json!({ "status_code": code, "results": [] })),
			)
			.mount(&server)
			.await;
		client(server.uri())
			.validate_credentials()
			.await
			.expect("validation should not error")
			.status
	}

	#[tokio::test]
	async fn validate_status_1_is_valid() {
		assert_eq!(
			validate_with_status_code(1).await,
			ProviderValidationStatus::Valid
		);
	}

	#[tokio::test]
	async fn validate_status_100_is_invalid_credentials() {
		assert_eq!(
			validate_with_status_code(100).await,
			ProviderValidationStatus::InvalidCredentials
		);
	}

	#[tokio::test]
	async fn validate_status_107_is_rate_limited() {
		assert_eq!(
			validate_with_status_code(107).await,
			ProviderValidationStatus::RateLimited
		);
	}

	#[tokio::test]
	async fn validate_http_500_is_provider_error() {
		let server = MockServer::start().await;
		Mock::given(method("GET"))
			.and(path("/publishers/"))
			.respond_with(ResponseTemplate::new(500))
			.mount(&server)
			.await;
		let status = client(server.uri())
			.validate_credentials()
			.await
			.unwrap()
			.status;
		assert_eq!(status, ProviderValidationStatus::ProviderError);
	}

	#[tokio::test]
	async fn validate_unreachable_host_is_network_error() {
		let status = client("http://127.0.0.1:1".to_string())
			.validate_credentials()
			.await
			.unwrap()
			.status;
		assert_eq!(status, ProviderValidationStatus::NetworkError);
	}

	fn live_client() -> ComicVineClient {
		dotenvy::dotenv().ok();
		let key =
			std::env::var("COMIC_VINE_API_KEY").expect("COMIC_VINE_API_KEY not set");
		ComicVineClient::new(key, None).expect("valid key")
	}

	#[ignore = "Requires COMIC_VINE_API_KEY env var (hits live API)"]
	#[tokio::test]
	async fn live_search_absolute_batman() {
		let client = live_client();
		let query = SearchQuery {
			title: "Absolute Batman".to_string(),
			series_name: Some("Absolute Batman".to_string()),
			number: Some("1".to_string()),
			limit: Some(5),
			..Default::default()
		};
		let results = client.search_media(&query).await;
		println!("comicvine search_media: {results:#?}");
		assert!(results.is_ok());
	}

	#[ignore = "Requires COMIC_VINE_API_KEY env var (hits live API)"]
	#[tokio::test]
	async fn live_filename_only_match() {
		// Filename-only library: build the query the way core's enrich path now does —
		// parse the raw filename — and confirm it resolves the exact issue.
		let client = live_client();
		let filename = "Absolute Batman 001 (2024) (digital) (Son of Ultron-Empire)";
		let parsed = crate::parse_comic_filename(filename);
		let query = SearchQuery {
			title: filename.to_string(),
			series_name: parsed.series,
			number: parsed.number,
			year: parsed.year,
			limit: Some(5),
			..Default::default()
		};
		let results = client.search_media(&query).await.unwrap();
		let top = results.first().expect("expected at least one candidate");
		let title = top.metadata.as_media().and_then(|m| m.title.clone());
		println!(
			"filename→match top: {title:?} confidence={}",
			top.confidence
		);
		assert_eq!(title.as_deref(), Some("Absolute Batman #1"));
		assert!(top.confidence >= 0.9, "got {}", top.confidence);
	}
}
