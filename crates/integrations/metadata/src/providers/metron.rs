use chrono::{Datelike, NaiveDate};
use reqwest_middleware::ClientWithMiddleware;
use serde::Deserialize;

use crate::{
	client::{build_client_with_retry, RetryClientConfig},
	error::MetadataProviderError,
	types::{
		ConfidenceFactor, ExternalMediaMetadata, ExternalSeriesMetadata, MatchCandidate,
		MediaType, SearchQuery,
	},
	ExternalMetadata, MetadataProvider, RateLimiter,
};

const METRON_API_URL: &str = "https://metron.cloud/api";
const METRON_RATE_LIMIT_PER_MINUTE: u32 = 20;

/// Metron (https://metron.cloud) metadata provider client
///
/// Metron uses HTTP Basic auth (username + password). The config store only has a
/// single `encrypted_api_token` field, so credentials are encoded as `username:password`
/// in that one token field (see [`MetronClient::new`]). This is an accepted tradeoff
/// (see the security self-audit in E6) rather than a schema migration.
pub struct MetronClient {
	client: ClientWithMiddleware,
	username: String,
	password: String,
	rate_limiter: RateLimiter,
}

impl MetronClient {
	pub fn new(
		token: String,
		rate_limit: Option<u32>,
	) -> Result<Self, MetadataProviderError> {
		let (username, password) = token.split_once(':').ok_or_else(|| {
			MetadataProviderError::Other(
				"Metron credentials must be 'username:password'".to_string(),
			)
		})?;
		Ok(Self {
			client: build_client_with_retry(
				reqwest::Client::new(),
				RetryClientConfig::default(),
			),
			username: username.to_string(),
			password: password.to_string(),
			rate_limiter: RateLimiter::per_minute(
				rate_limit.unwrap_or(METRON_RATE_LIMIT_PER_MINUTE),
			),
		})
	}

	/// GET a JSON resource from the Metron API with Basic auth, honoring the local
	/// rate limiter. Server-side 429/5xx responses are retried with backoff by
	/// `build_client_with_retry`; 4xx (including 401/403 auth failures) are treated
	/// as fatal and NOT retried (`RetryOn429And5xx`), so bad credentials fail fast.
	#[tracing::instrument(skip(self))]
	async fn get_json<T: serde::de::DeserializeOwned>(
		&self,
		path: &str,
		params: &[(&str, String)],
	) -> Result<T, MetadataProviderError> {
		self.rate_limiter.until_ready().await;
		let response = self
			.client
			.get(format!("{METRON_API_URL}/{path}/"))
			.basic_auth(&self.username, Some(&self.password))
			.query(params)
			.send()
			.await?
			.error_for_status()?;
		Ok(response.json::<T>().await?)
	}
}

#[async_trait::async_trait]
impl MetadataProvider for MetronClient {
	fn id(&self) -> &'static str {
		"metron"
	}

	fn name(&self) -> &'static str {
		"Metron"
	}

	fn supported_media_types(&self) -> Vec<MediaType> {
		vec![MediaType::Comic]
	}

	#[tracing::instrument(skip(self))]
	async fn search_series(
		&self,
		query: &SearchQuery,
	) -> Result<Vec<MatchCandidate>, MetadataProviderError> {
		let mut params: Vec<(&str, String)> = vec![("name", query.title.clone())];
		if let Some(year) = query.year {
			params.push(("year_began", year.to_string()));
		}

		let response: Paginated<SeriesListItem> =
			self.get_json("series", &params).await?;
		let limit = query.limit.unwrap_or(10) as usize;

		let mut candidates = Vec::with_capacity(response.results.len().min(limit));
		for hit in response.results.into_iter().take(limit) {
			match self.fetch_series_metadata(&hit.id.to_string()).await {
				Ok(metadata) => candidates.push(MatchCandidate {
					provider: self.id().to_string(),
					external_id: hit.id.to_string(),
					metadata: ExternalMetadata::Series(metadata),
					confidence: 0.0,
					confidence_factors: Vec::new(),
				}),
				Err(e) => {
					tracing::error!(
						external_id = hit.id,
						error = ?e,
						"Failed to fetch Metron series detail for search result"
					);
				},
			}
		}

		Ok(self.score_search(query, candidates))
	}

	#[tracing::instrument(skip(self))]
	async fn search_media(
		&self,
		query: &SearchQuery,
	) -> Result<Vec<MatchCandidate>, MetadataProviderError> {
		// A known ComicVine issue ID lets us skip fuzzy search entirely: a unique hit
		// is treated as an exact match with confidence 1.0
		if let Some(cv_id) = &query.comicvine_id {
			let params = [("cv_id", cv_id.clone())];
			let response: Paginated<IssueListItem> =
				self.get_json("issue", &params).await?;
			if response.count == 1 {
				if let Some(hit) = response.results.into_iter().next() {
					let metadata = self.fetch_media_metadata(&hit.id.to_string()).await?;
					return Ok(vec![MatchCandidate {
						provider: self.id().to_string(),
						external_id: hit.id.to_string(),
						metadata: ExternalMetadata::Media(metadata),
						confidence: 1.0,
						confidence_factors: vec![ConfidenceFactor {
							factor: "comicvine_id_exact".to_string(),
							weight: 1.0,
							matched: true,
						}],
					}]);
				}
			}
			// Ambiguous (0 or >1 hits) — fall through to the fuzzy search below
		}

		let mut params: Vec<(&str, String)> = Vec::new();
		let series_name = query
			.series_name
			.clone()
			.filter(|s| !s.is_empty())
			.unwrap_or_else(|| query.title.clone());
		if !series_name.is_empty() {
			params.push(("series_name", series_name));
		}
		if let Some(number) = &query.number {
			params.push(("number", number.clone()));
		}
		if let Some(series_year) = query.series_year {
			params.push(("series_year_began", series_year.to_string()));
		}

		let response: Paginated<IssueListItem> = self.get_json("issue", &params).await?;
		let limit = query.limit.unwrap_or(10) as usize;

		let mut candidates = Vec::with_capacity(response.results.len().min(limit));
		for hit in response.results.into_iter().take(limit) {
			match self.fetch_media_metadata(&hit.id.to_string()).await {
				Ok(metadata) => candidates.push(MatchCandidate {
					provider: self.id().to_string(),
					external_id: hit.id.to_string(),
					metadata: ExternalMetadata::Media(metadata),
					confidence: 0.0,
					confidence_factors: Vec::new(),
				}),
				Err(e) => {
					tracing::error!(
						external_id = hit.id,
						error = ?e,
						"Failed to fetch Metron issue detail for search result"
					);
				},
			}
		}

		Ok(self.score_search(query, candidates))
	}

	#[tracing::instrument(skip(self))]
	async fn fetch_series_metadata(
		&self,
		external_id: &str,
	) -> Result<ExternalSeriesMetadata, MetadataProviderError> {
		let id: i64 = external_id.parse().map_err(|_| {
			MetadataProviderError::Other(format!("Invalid series ID: {}", external_id))
		})?;

		let detail: SeriesDetail = self.get_json(&format!("series/{id}"), &[]).await?;

		Ok(ExternalSeriesMetadata {
			provider: self.id().to_string(),
			external_id: detail.id.to_string(),
			title: detail.name,
			alternative_titles: vec![],
			summary: detail.desc,
			year: detail.year_began,
			end_year: detail.year_end,
			publisher: detail.publisher.map(|p| p.name),
			genres: detail
				.genres
				.map(|genres| genres.into_iter().map(|g| g.name).collect())
				.filter(|g: &Vec<String>| !g.is_empty()),
			volume_count: detail.issue_count,
			// Note: `imprint` has no corresponding field on ExternalSeriesMetadata
			// (same gap as media metadata — see apply.rs), so it isn't mapped here.
			..Default::default()
		})
	}

	#[tracing::instrument(skip(self))]
	async fn fetch_media_metadata(
		&self,
		external_id: &str,
	) -> Result<ExternalMediaMetadata, MetadataProviderError> {
		let id: i64 = external_id.parse().map_err(|_| {
			MetadataProviderError::Other(format!("Invalid issue ID: {}", external_id))
		})?;

		let detail: IssueDetail = self.get_json(&format!("issue/{id}"), &[]).await?;

		Ok(map_issue_detail(detail, self.id()))
	}
}

/// Map a Metron issue detail response into [`ExternalMediaMetadata`]
fn map_issue_detail(detail: IssueDetail, provider_id: &str) -> ExternalMediaMetadata {
	let credits = detail
		.credits
		.map(|c| bucket_credits(&c))
		.unwrap_or_default();

	let (year, month, day) = detail
		.cover_date
		.as_deref()
		.and_then(|d| NaiveDate::parse_from_str(d, "%Y-%m-%d").ok())
		.map(|d| (Some(d.year()), Some(d.month() as i32), Some(d.day() as i32)))
		.unwrap_or((None, None, None));

	let title = detail
		.story_titles
		.as_ref()
		.and_then(|titles| titles.first().cloned())
		.or_else(|| detail.collection_title.clone());

	let story_arc = detail.arcs.as_ref().and_then(|arcs| {
		let names: Vec<String> = arcs.iter().map(|a| a.name.clone()).collect();
		non_empty(names).map(|n| n.join(", "))
	});

	let characters = non_empty(
		detail
			.characters
			.as_ref()
			.map(|items| items.iter().map(|i| i.name.clone()).collect())
			.unwrap_or_default(),
	);
	let teams = non_empty(
		detail
			.teams
			.as_ref()
			.map(|items| items.iter().map(|i| i.name.clone()).collect())
			.unwrap_or_default(),
	);

	let number = detail.number.parse::<f32>().ok();

	ExternalMediaMetadata {
		provider: provider_id.to_string(),
		external_id: detail.id.to_string(),
		title,
		summary: detail.desc,
		number,
		series_name: Some(detail.series.name),
		series_external_id: Some(detail.series.id.to_string()),
		day,
		month,
		year,
		isbn: detail.isbn,
		publisher: detail.publisher.map(|p| p.name),
		imprint: detail.imprint.map(|i| i.name),
		writers: non_empty(credits.writers),
		artists: non_empty(credits.artists),
		colorists: non_empty(credits.colorists),
		letterers: non_empty(credits.letterers),
		cover_artists: non_empty(credits.cover_artists),
		pencillers: non_empty(credits.pencillers),
		inkers: non_empty(credits.inkers),
		editors: non_empty(credits.editors),
		characters,
		teams,
		story_arc,
		cover_url: detail.image,
		provider_url: detail.resource_url,
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

/// Bucket credits by case-insensitive role name into the fields they map onto in
/// [`ExternalMediaMetadata`]. A creator with multiple roles is added to every
/// bucket their roles map to.
fn bucket_credits(credits: &[Credit]) -> CreditBuckets {
	let mut buckets = CreditBuckets::default();

	for credit in credits {
		for role in &credit.role {
			match role.name.to_lowercase().as_str() {
				"writer" => buckets.writers.push(credit.creator.clone()),
				"penciller" | "penciler" => {
					buckets.pencillers.push(credit.creator.clone())
				},
				"inker" => buckets.inkers.push(credit.creator.clone()),
				"colorist" => buckets.colorists.push(credit.creator.clone()),
				"letterer" => buckets.letterers.push(credit.creator.clone()),
				"cover" => buckets.cover_artists.push(credit.creator.clone()),
				"editor" => buckets.editors.push(credit.creator.clone()),
				_ => buckets.artists.push(credit.creator.clone()),
			}
		}
	}

	buckets
}

fn non_empty(items: Vec<String>) -> Option<Vec<String>> {
	if items.is_empty() {
		None
	} else {
		Some(items)
	}
}

// --- Metron API response shapes ---
// Deliberately tolerant of unknown/extra fields (serde's default "ignore unknown
// fields" behavior) since the upstream API adds fields over time.

#[derive(Debug, Deserialize)]
#[serde(bound(deserialize = "T: Deserialize<'de>"))]
struct Paginated<T> {
	count: u32,
	#[serde(default = "Vec::new")]
	results: Vec<T>,
}

#[derive(Debug, Deserialize)]
struct GenericItem {
	#[allow(dead_code)]
	id: i64,
	name: String,
}

#[derive(Debug, Deserialize)]
struct IssueListItem {
	id: i64,
	#[allow(dead_code)]
	#[serde(default)]
	issue: Option<String>,
}

#[derive(Debug, Deserialize)]
struct SeriesListItem {
	id: i64,
	#[allow(dead_code)]
	#[serde(default)]
	name: Option<String>,
}

#[derive(Debug, Deserialize)]
struct IssueDetail {
	id: i64,
	number: String,
	#[serde(default)]
	collection_title: Option<String>,
	#[serde(default)]
	story_titles: Option<Vec<String>>,
	#[serde(default)]
	cover_date: Option<String>,
	#[serde(default)]
	desc: Option<String>,
	#[serde(default)]
	image: Option<String>,
	#[serde(default)]
	publisher: Option<GenericItem>,
	#[serde(default)]
	imprint: Option<GenericItem>,
	series: IssueDetailSeries,
	#[serde(default)]
	credits: Option<Vec<Credit>>,
	#[serde(default)]
	arcs: Option<Vec<GenericItem>>,
	#[serde(default)]
	characters: Option<Vec<GenericItem>>,
	#[serde(default)]
	teams: Option<Vec<GenericItem>>,
	#[serde(default)]
	isbn: Option<String>,
	#[serde(default)]
	resource_url: Option<String>,
}

#[derive(Debug, Deserialize)]
struct IssueDetailSeries {
	id: i64,
	name: String,
}

#[derive(Debug, Deserialize)]
struct Credit {
	creator: String,
	#[serde(default)]
	role: Vec<GenericItem>,
}

#[derive(Debug, Deserialize)]
struct SeriesDetail {
	id: i64,
	name: String,
	#[serde(default)]
	desc: Option<String>,
	#[serde(default)]
	year_began: Option<i32>,
	#[serde(default)]
	year_end: Option<i32>,
	#[serde(default)]
	publisher: Option<GenericItem>,
	#[serde(default)]
	issue_count: Option<i32>,
	#[serde(default)]
	genres: Option<Vec<GenericItem>>,
}

#[cfg(test)]
mod tests {
	use super::*;

	const ISSUE_DETAIL_FIXTURE: &str = r#"
	{
		"id": 1234,
		"number": "1",
		"collection_title": null,
		"story_titles": ["Harley Quinn: Be Careful What You Wish For"],
		"cover_date": "2016-03-01",
		"store_date": "2016-02-24",
		"desc": "Harley Quinn gets her own ongoing series.",
		"image": "https://metron.cloud/media/issue/1234/cover.jpg",
		"publisher": { "id": 10, "name": "DC Comics" },
		"imprint": null,
		"rating": { "id": 1, "name": "Teen" },
		"series": { "id": 55, "name": "Harley Quinn", "year_began": 2016 },
		"credits": [
			{ "id": 1, "creator": "Jimmy Palmiotti", "role": [{ "id": 1, "name": "Writer" }] },
			{ "id": 2, "creator": "John Timms", "role": [{ "id": 2, "name": "Penciller" }] },
			{ "id": 3, "creator": "Alex Sinclair", "role": [{ "id": 3, "name": "Colorist" }] }
		],
		"arcs": [],
		"characters": [{ "id": 3, "name": "Harley Quinn" }],
		"teams": [],
		"variants": [],
		"isbn": null,
		"upc": "76194134413200111",
		"page": 32,
		"cv_id": 555444,
		"gcd_id": null,
		"resource_url": "https://metron.cloud/issue/harley-quinn-2016-1/"
	}
	"#;

	#[test]
	fn test_map_issue_detail_credits_by_role() {
		let detail: IssueDetail = serde_json::from_str(ISSUE_DETAIL_FIXTURE).unwrap();
		let meta = map_issue_detail(detail, "metron");

		assert_eq!(meta.writers, Some(vec!["Jimmy Palmiotti".to_string()]));
		assert_eq!(meta.pencillers, Some(vec!["John Timms".to_string()]));
		assert_eq!(meta.colorists, Some(vec!["Alex Sinclair".to_string()]));
		assert_eq!(meta.characters, Some(vec!["Harley Quinn".to_string()]));
		assert_eq!(meta.year, Some(2016));
		assert_eq!(meta.month, Some(3));
		assert_eq!(meta.day, Some(1));
	}

	#[test]
	fn test_map_issue_detail_title_prefers_story_title() {
		let detail: IssueDetail = serde_json::from_str(ISSUE_DETAIL_FIXTURE).unwrap();
		let meta = map_issue_detail(detail, "metron");

		assert_eq!(
			meta.title,
			Some("Harley Quinn: Be Careful What You Wish For".to_string())
		);
	}

	#[test]
	fn test_map_issue_detail_title_falls_back_to_collection_title() {
		let json = ISSUE_DETAIL_FIXTURE
			.replace(
				r#""story_titles": ["Harley Quinn: Be Careful What You Wish For"],"#,
				r#""story_titles": null,"#,
			)
			.replace(
				r#""collection_title": null,"#,
				r#""collection_title": "Vol. 1","#,
			);
		let detail: IssueDetail = serde_json::from_str(&json).unwrap();
		let meta = map_issue_detail(detail, "metron");

		assert_eq!(meta.title, Some("Vol. 1".to_string()));
	}

	#[test]
	fn test_map_issue_detail_metadata_fields() {
		let detail: IssueDetail = serde_json::from_str(ISSUE_DETAIL_FIXTURE).unwrap();
		let meta = map_issue_detail(detail, "metron");

		assert_eq!(meta.provider, "metron");
		assert_eq!(meta.external_id, "1234");
		assert_eq!(meta.number, Some(1.0));
		assert_eq!(meta.series_name, Some("Harley Quinn".to_string()));
		assert_eq!(meta.series_external_id, Some("55".to_string()));
		assert_eq!(meta.publisher, Some("DC Comics".to_string()));
		assert_eq!(meta.imprint, None);
		assert_eq!(
			meta.cover_url,
			Some("https://metron.cloud/media/issue/1234/cover.jpg".to_string())
		);
		assert_eq!(
			meta.provider_url,
			Some("https://metron.cloud/issue/harley-quinn-2016-1/".to_string())
		);
	}

	#[test]
	fn test_map_issue_detail_non_numeric_number_is_none() {
		let json =
			ISSUE_DETAIL_FIXTURE.replace(r#""number": "1","#, r#""number": "1.MU","#);
		let detail: IssueDetail = serde_json::from_str(&json).unwrap();
		let meta = map_issue_detail(detail, "metron");

		assert_eq!(meta.number, None);
	}

	#[test]
	fn test_map_issue_detail_story_arc_joins_multiple_arcs() {
		let json = ISSUE_DETAIL_FIXTURE.replace(
			r#""arcs": [],"#,
			r#""arcs": [{ "id": 1, "name": "New 52" }, { "id": 2, "name": "Rebirth" }],"#,
		);
		let detail: IssueDetail = serde_json::from_str(&json).unwrap();
		let meta = map_issue_detail(detail, "metron");

		assert_eq!(meta.story_arc, Some("New 52, Rebirth".to_string()));
	}

	#[test]
	fn test_bucket_credits_all_roles_case_insensitive() {
		let credits = vec![
			Credit {
				creator: "A Writer".into(),
				role: vec![GenericItem {
					id: 1,
					name: "writer".into(),
				}],
			},
			Credit {
				creator: "A Penciler".into(),
				role: vec![GenericItem {
					id: 2,
					name: "Penciler".into(),
				}],
			},
			Credit {
				creator: "An Inker".into(),
				role: vec![GenericItem {
					id: 3,
					name: "INKER".into(),
				}],
			},
			Credit {
				creator: "A Letterer".into(),
				role: vec![GenericItem {
					id: 4,
					name: "Letterer".into(),
				}],
			},
			Credit {
				creator: "A Cover Artist".into(),
				role: vec![GenericItem {
					id: 5,
					name: "Cover".into(),
				}],
			},
			Credit {
				creator: "An Editor".into(),
				role: vec![GenericItem {
					id: 6,
					name: "Editor".into(),
				}],
			},
			Credit {
				creator: "A Miscellaneous Artist".into(),
				role: vec![GenericItem {
					id: 7,
					name: "Production".into(),
				}],
			},
		];

		let buckets = bucket_credits(&credits);

		assert_eq!(buckets.writers, vec!["A Writer".to_string()]);
		assert_eq!(buckets.pencillers, vec!["A Penciler".to_string()]);
		assert_eq!(buckets.inkers, vec!["An Inker".to_string()]);
		assert_eq!(buckets.letterers, vec!["A Letterer".to_string()]);
		assert_eq!(buckets.cover_artists, vec!["A Cover Artist".to_string()]);
		assert_eq!(buckets.editors, vec!["An Editor".to_string()]);
		assert_eq!(buckets.artists, vec!["A Miscellaneous Artist".to_string()]);
	}

	fn get_test_client() -> MetronClient {
		dotenvy::dotenv().ok();
		let creds =
			std::env::var("METRON_CREDENTIALS").expect("METRON_CREDENTIALS not set");
		MetronClient::new(creds, None).expect("METRON_CREDENTIALS must be 'user:pass'")
	}

	#[ignore = "Requires METRON_CREDENTIALS env var"]
	#[tokio::test]
	async fn test_search_series() {
		let client = get_test_client();
		let query = SearchQuery {
			title: "Harley Quinn".to_string(),
			limit: Some(5),
			..Default::default()
		};

		let results = client.search_series(&query).await;
		println!("search_series results: {:#?}", results);
		assert!(results.is_ok());
		assert!(!results.unwrap().is_empty());
	}

	#[ignore = "Requires METRON_CREDENTIALS env var"]
	#[tokio::test]
	async fn test_search_media() {
		let client = get_test_client();
		let query = SearchQuery {
			title: "Harley Quinn".to_string(),
			series_name: Some("Harley Quinn".to_string()),
			number: Some("1".to_string()),
			limit: Some(5),
			..Default::default()
		};

		let results = client.search_media(&query).await;
		println!("search_media results: {:#?}", results);
		assert!(results.is_ok());
		assert!(!results.unwrap().is_empty());
	}

	#[ignore = "Requires METRON_CREDENTIALS env var"]
	#[tokio::test]
	async fn test_search_media_by_comicvine_id() {
		let client = get_test_client();
		let query = SearchQuery {
			title: "Harley Quinn".to_string(),
			comicvine_id: Some("555444".to_string()),
			..Default::default()
		};

		let results = client.search_media(&query).await;
		println!("search_media (cv_id) results: {:#?}", results);
		assert!(results.is_ok());
		let candidates = results.unwrap();
		assert!(!candidates.is_empty());
		assert_eq!(candidates[0].confidence, 1.0);
	}

	#[ignore = "Requires METRON_CREDENTIALS env var"]
	#[tokio::test]
	async fn test_fetch_series_metadata() {
		let client = get_test_client();
		let query = SearchQuery {
			title: "Harley Quinn".to_string(),
			limit: Some(1),
			..Default::default()
		};

		let search_results = client.search_series(&query).await.unwrap();
		assert!(!search_results.is_empty());

		let series_id = &search_results[0].external_id;
		let metadata = client.fetch_series_metadata(series_id).await;
		println!("fetch_series_metadata result: {:#?}", metadata);
		assert!(metadata.is_ok());
	}

	#[ignore = "Requires METRON_CREDENTIALS env var"]
	#[tokio::test]
	async fn test_fetch_media_metadata() {
		let client = get_test_client();
		let query = SearchQuery {
			title: "Harley Quinn".to_string(),
			series_name: Some("Harley Quinn".to_string()),
			number: Some("1".to_string()),
			limit: Some(1),
			..Default::default()
		};

		let search_results = client.search_media(&query).await.unwrap();
		assert!(!search_results.is_empty());

		let issue_id = &search_results[0].external_id;
		let metadata = client.fetch_media_metadata(issue_id).await;
		println!("fetch_media_metadata result: {:#?}", metadata);
		assert!(metadata.is_ok());
	}
}
