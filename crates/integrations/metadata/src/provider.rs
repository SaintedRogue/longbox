use async_trait::async_trait;

use chrono::NaiveDate;

use crate::{
	error::MetadataProviderError,
	types::{
		ExternalMediaMetadata, ExternalSeriesMetadata, MatchCandidate, MediaType,
		ProviderValidationResult, ProviderValidationStatus, SearchQuery, UpcomingRelease,
	},
	MatchScorer,
};

/// Represents an external metadata source
#[async_trait]
pub trait MetadataProvider: Send + Sync {
	/// Unique identifier for this provider (e.g., "hardcover")
	fn id(&self) -> &'static str;

	/// Human-readable name for display
	fn name(&self) -> &'static str;

	/// Media types supported by this provider
	fn supported_media_types(&self) -> Vec<MediaType>;

	/// Search for series/works matching the query
	async fn search_series(
		&self,
		query: &SearchQuery,
	) -> Result<Vec<MatchCandidate>, MetadataProviderError>;

	/// Search for individual books/issues/volumes/etc
	async fn search_media(
		&self,
		query: &SearchQuery,
	) -> Result<Vec<MatchCandidate>, MetadataProviderError>;

	/// Score and sort search results based on their relevance to the query
	fn score_search(
		&self,
		query: &SearchQuery,
		mut candidates: Vec<MatchCandidate>,
	) -> Vec<MatchCandidate> {
		let scorer = MatchScorer;
		scorer.score_and_sort(query, &mut candidates);
		candidates
	}

	/// Fetch full metadata for a known external ID
	async fn fetch_series_metadata(
		&self,
		external_id: &str,
	) -> Result<ExternalSeriesMetadata, MetadataProviderError>;

	/// Fetch full metadata for a specific book/volume/issue/etc
	async fn fetch_media_metadata(
		&self,
		external_id: &str,
	) -> Result<ExternalMediaMetadata, MetadataProviderError>;

	/// Cheaply verify that the configured credentials work against the provider's
	/// live API, returning a granular [`ProviderValidationResult`].
	///
	/// Issues the provider reports releasing inside `[start, end]` (inclusive),
	/// capped at `cap` results — the release-calendar oracle's data source.
	/// Default: unsupported; only the comics providers implement it.
	async fn fetch_upcoming_releases(
		&self,
		_start: NaiveDate,
		_end: NaiveDate,
		_cap: usize,
	) -> Result<Vec<UpcomingRelease>, MetadataProviderError> {
		Err(MetadataProviderError::OperationNotSupported)
	}

	/// Default implementation reports [`ProviderValidationStatus::Unsupported`] for
	/// providers that validate elsewhere (e.g. Hardcover, which validates client-side
	/// because it supports CORS). Providers without CORS — like Metron — override this
	/// so the browser never has to reach the provider directly.
	async fn validate_credentials(
		&self,
	) -> Result<ProviderValidationResult, MetadataProviderError> {
		Ok(ProviderValidationResult::new(
			ProviderValidationStatus::Unsupported,
			"This provider does not support server-side validation.",
		))
	}

	//// Fetch cover image URL
	// async fn fetch_cover_url(
	// 	&self,
	// 	external_id: &str,
	//  source_type ??? like Series/Media?
	// ) -> Result<Option<String>, MetadataProviderError>;
}
