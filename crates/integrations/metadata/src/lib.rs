pub mod client;
pub mod error;
pub mod filename;
pub mod merge;
mod provider;
mod providers;
pub mod rate_limit;
pub mod response_cache;
pub mod runtime;
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
pub use scoring::{issue_numbers_match, MatchScorer};
pub use title::compose_comic_title;
pub use types::{
	ConfidenceFactor, ExternalMediaMetadata, ExternalMetadata, ExternalSeriesMetadata,
	MatchCandidate, MediaType, MetadataField, ProviderValidationResult,
	ProviderValidationStatus, PublicationStatus, SearchQuery, UpcomingRelease,
};

use providers::{ComicVineClient, HardcoverClient, LocgClient, MetronClient};

pub fn create_provider(
	provider_type: &str,
	api_token: String,
	runtime: runtime::RuntimeHandle,
) -> MetadataResult<Box<dyn MetadataProvider + Send + Sync>> {
	match provider_type {
		// Hardcover's GraphQL POSTs are uncacheable, so it takes no runtime.
		"HARDCOVER" => Ok(Box::new(HardcoverClient::new(api_token, None))),
		"METRON" => Ok(Box::new(
			MetronClient::new(api_token, None)?.with_runtime(runtime),
		)),
		"COMIC_VINE" => Ok(Box::new(
			ComicVineClient::new(api_token, None)?.with_runtime(runtime),
		)),
		// Unofficial: LOCG has no API, so this client logs into the site as the
		// operator. It is unreachable from the UI until the server owner acknowledges
		// that (`server_config.unofficial_providers_acknowledged_at`); reaching it here
		// means a config row already exists, which only that acknowledgement allows.
		"LOCG" => Ok(Box::new(
			LocgClient::new(api_token, None)?.with_runtime(runtime),
		)),
		_ => Err(MetadataProviderError::UnsupportedProvider(
			provider_type.to_string(),
		)),
	}
}
