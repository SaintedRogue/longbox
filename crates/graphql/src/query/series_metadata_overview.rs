use crate::object::series_metadata_overview::{
	SeriesMetadataOverview, SeriesMetadataOverviewScope,
};
use async_graphql::{Context, Object, Result, ID};

#[derive(Default)]
pub struct SeriesMetadataOverviewQuery;

#[Object]
impl SeriesMetadataOverviewQuery {
	/// Distinct metadata values across series, for building filter controls.
	///
	/// Passing `library_id` is what makes a library view's filter options describe that
	/// library rather than the whole server.
	async fn series_metadata_overview(
		&self,
		_ctx: &Context<'_>,
		library_id: Option<ID>,
	) -> Result<SeriesMetadataOverview> {
		Ok(SeriesMetadataOverview {
			scope: SeriesMetadataOverviewScope {
				library_id: library_id.map(|id| id.to_string()),
			},
		})
	}
}
