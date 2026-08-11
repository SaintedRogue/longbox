use crate::object::media_metadata_overview::{
	MediaMetadataOverview, MetadataOverviewScope,
};
use async_graphql::{Context, Object, Result, ID};

#[derive(Default)]
pub struct MediaMetadataOverviewQuery;

#[Object]
impl MediaMetadataOverviewQuery {
	/// Distinct metadata values across books, for building filter controls.
	///
	/// `series_id` and `library_id` are both optional and compose. Passing
	/// `library_id` is what makes a library view's filter options describe that
	/// library rather than the whole server.
	async fn media_metadata_overview(
		&self,
		_ctx: &Context<'_>,
		series_id: Option<ID>,
		library_id: Option<ID>,
	) -> Result<MediaMetadataOverview> {
		Ok(MediaMetadataOverview {
			scope: MetadataOverviewScope {
				series_id: series_id.map(|id| id.to_string()),
				library_id: library_id.map(|id| id.to_string()),
			},
		})
	}
}
