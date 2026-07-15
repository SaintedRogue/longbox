use reqwest_middleware::ClientWithMiddleware;

use crate::{
	client::{build_client_with_retry, RetryClientConfig},
	error::MetadataProviderError,
	types::{
		ExternalMediaMetadata, ExternalSeriesMetadata, MatchCandidate, MediaType,
		SearchQuery,
	},
	MetadataProvider, RateLimiter,
};

const METRON_API_URL: &str = "https://metron.cloud/api";
const METRON_RATE_LIMIT_PER_MINUTE: u32 = 20;

/// Metron (https://metron.cloud) metadata provider client
///
/// Metron uses HTTP Basic auth (username + password). The config store only has a
/// single `encrypted_api_token` field, so credentials are encoded as `username:password`
/// in that one token field (see [`MetronClient::new`]).
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
			// TODO(E4): switch to RateLimiter::per_minute once it lands (TDD in E4)
			rate_limiter: RateLimiter::new(
				rate_limit.unwrap_or(METRON_RATE_LIMIT_PER_MINUTE),
			),
		})
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

	async fn search_series(
		&self,
		_query: &SearchQuery,
	) -> Result<Vec<MatchCandidate>, MetadataProviderError> {
		Err(MetadataProviderError::Other("not implemented".into()))
	}

	async fn search_media(
		&self,
		_query: &SearchQuery,
	) -> Result<Vec<MatchCandidate>, MetadataProviderError> {
		Err(MetadataProviderError::Other("not implemented".into()))
	}

	async fn fetch_series_metadata(
		&self,
		_external_id: &str,
	) -> Result<ExternalSeriesMetadata, MetadataProviderError> {
		Err(MetadataProviderError::Other("not implemented".into()))
	}

	async fn fetch_media_metadata(
		&self,
		_external_id: &str,
	) -> Result<ExternalMediaMetadata, MetadataProviderError> {
		Err(MetadataProviderError::Other("not implemented".into()))
	}
}
