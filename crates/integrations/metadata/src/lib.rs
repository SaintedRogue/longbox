pub mod client;
pub mod error;
pub mod filename;
pub mod merge;
mod provider;
mod providers;
pub mod rate_limit;
pub mod scoring;
pub(crate) mod serde_utils;
pub mod title;
pub mod types;

pub use client::build_client_with_retry;
pub use error::{MetadataProviderError, MetadataResult};
pub use filename::{parse_comic_filename, ParsedComicName};
pub use merge::{AutoApplyConfig, FieldMerger, MergeStrategy, MetadataFieldOverride};
pub use provider::MetadataProvider;
pub use rate_limit::RateLimiter;
pub use scoring::MatchScorer;
pub use title::compose_comic_title;
pub use types::{
	ConfidenceFactor, ExternalMediaMetadata, ExternalMetadata, ExternalSeriesMetadata,
	MatchCandidate, MediaType, MetadataField, ProviderValidationResult,
	ProviderValidationStatus, PublicationStatus, SearchQuery,
};

use providers::{ComicVineClient, HardcoverClient, MetronClient};

pub fn create_provider(
	provider_type: &str,
	api_token: String,
) -> MetadataResult<Box<dyn MetadataProvider + Send + Sync>> {
	match provider_type {
		"HARDCOVER" => Ok(Box::new(HardcoverClient::new(api_token, None))),
		"METRON" => Ok(Box::new(MetronClient::new(api_token, None)?)),
		"COMIC_VINE" => Ok(Box::new(ComicVineClient::new(api_token, None)?)),
		_ => Err(MetadataProviderError::UnsupportedProvider(
			provider_type.to_string(),
		)),
	}
}
