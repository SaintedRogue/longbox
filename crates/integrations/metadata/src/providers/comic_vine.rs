use chrono::{Datelike, NaiveDate};
use reqwest_middleware::ClientWithMiddleware;
use serde::{de::DeserializeOwned, Deserialize};

use crate::{
	client::{build_client_with_retry, default_metadata_client, RetryClientConfig},
	error::MetadataProviderError,
	types::{
		ConfidenceFactor, ExternalMediaMetadata, ExternalSeriesMetadata, MatchCandidate,
		MediaType, ProviderValidationResult, ProviderValidationStatus, SearchQuery,
	},
	ExternalMetadata, MetadataProvider, RateLimiter,
};

const COMIC_VINE_API_URL: &str = "https://comicvine.gamespot.com/api";
/// ComicVine allows 200 requests per resource per hour plus velocity detection.
/// The shared [`RateLimiter`] only models a per-minute window, so we pick a
/// conservative default (~180/hr) that also softens the velocity heuristic.
const COMIC_VINE_RATE_LIMIT_PER_MINUTE: u32 = 3;

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
}

impl ComicVineClient {
	pub fn new(
		api_key: String,
		rate_limit: Option<u32>,
	) -> Result<Self, MetadataProviderError> {
		Self::with_base_url(api_key, rate_limit, COMIC_VINE_API_URL.to_string())
	}

	fn with_base_url(
		api_key: String,
		rate_limit: Option<u32>,
		base_url: String,
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
			rate_limiter: RateLimiter::per_minute(
				rate_limit.unwrap_or(COMIC_VINE_RATE_LIMIT_PER_MINUTE),
			),
		})
	}

	/// GET a ComicVine resource, honoring the rate limiter and always requesting
	/// JSON. Returns the raw [`CvEnvelope`]; callers extract typed `results` via
	/// [`CvEnvelope::into_results`] (which maps a non-1 `status_code` to an error).
	#[tracing::instrument(skip(self))]
	async fn request(
		&self,
		path: &str,
		params: &[(&str, String)],
	) -> Result<CvEnvelope, MetadataProviderError> {
		self.rate_limiter.until_ready().await;
		let mut query: Vec<(&str, String)> = vec![
			("api_key", self.api_key.clone()),
			("format", "json".to_string()),
		];
		query.extend(params.iter().cloned());

		let envelope: CvEnvelope = self
			.client
			.get(format!("{}/{path}/", self.base_url))
			.query(&query)
			.send()
			.await?
			.error_for_status()?
			.json()
			.await?;
		Ok(envelope)
	}
}

#[async_trait::async_trait]
impl MetadataProvider for ComicVineClient {
	fn id(&self) -> &'static str {
		"comicvine"
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
			1 => ProviderValidationResult::new(
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
		if self.status_code != 1 {
			return Err(cv_status_error(self.status_code, &self.error));
		}
		serde_json::from_value(self.results).map_err(MetadataProviderError::from)
	}
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
	use super::*;
	use serde_json::json;
	use wiremock::{
		matchers::{method, path},
		Mock, MockServer, ResponseTemplate,
	};

	fn client(base_url: String) -> ComicVineClient {
		ComicVineClient::with_base_url("test-key".to_string(), None, base_url)
			.expect("valid key")
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
}
