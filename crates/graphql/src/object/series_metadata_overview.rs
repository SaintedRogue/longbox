use crate::data::CoreContext;
use async_graphql::{Context, Object, Result};
use models::entity::{series, series_metadata};
use sea_orm::{prelude::*, DatabaseConnection, QuerySelect, Select};

/// Which series the distinct values are drawn from.
///
/// `library_id` exists for the same reason it does on the media overview: the filter
/// controls in a library view are only useful if their options describe *that* library.
#[derive(Default, Debug, Clone)]
pub struct SeriesMetadataOverviewScope {
	pub library_id: Option<String>,
}

fn get_base_query(
	column: series_metadata::Column,
	scope: SeriesMetadataOverviewScope,
) -> Select<series_metadata::Entity> {
	let query = series_metadata::Entity::find_for_column(column);

	// One hop rather than the media overview's two: `library_id` sits on `series`, which
	// owns the metadata row directly.
	if let Some(library_id) = scope.library_id {
		return query
			.join_rev(
				sea_orm::JoinType::InnerJoin,
				series::Entity::belongs_to(series_metadata::Entity)
					.from(series::Column::Id)
					.to(series_metadata::Column::SeriesId)
					.into(),
			)
			.filter(series::Column::LibraryId.eq(library_id));
	}

	query
}

macro_rules! get_unique_values {
	($column:ident, $conn:ident, $scope:ident) => {{
		let query = get_base_query(series_metadata::Column::$column, $scope);
		let values: Vec<String> = query.into_tuple().all($conn).await?;
		Ok(values)
	}};
}

/// Distinct series-metadata values, for building filter controls over a series list.
///
/// Deliberately narrower than the media overview: these are the columns a series list is
/// worth narrowing by, and each is a single value per series rather than a comma-separated
/// list, so no splitting is needed.
#[derive(Default, Debug, Clone)]
pub struct SeriesMetadataOverview {
	pub scope: SeriesMetadataOverviewScope,
}

#[Object]
impl SeriesMetadataOverview {
	async fn publishers(&self, ctx: &Context<'_>) -> Result<Vec<String>> {
		let conn: &DatabaseConnection = ctx.data::<CoreContext>()?.conn.as_ref();
		let scope = self.scope.clone();
		get_unique_values!(Publisher, conn, scope)
	}

	async fn imprints(&self, ctx: &Context<'_>) -> Result<Vec<String>> {
		let conn: &DatabaseConnection = ctx.data::<CoreContext>()?.conn.as_ref();
		let scope = self.scope.clone();
		get_unique_values!(Imprint, conn, scope)
	}

	/// Print, OneShot, TPB or GN.
	async fn book_types(&self, ctx: &Context<'_>) -> Result<Vec<String>> {
		let conn: &DatabaseConnection = ctx.data::<CoreContext>()?.conn.as_ref();
		let scope = self.scope.clone();
		get_unique_values!(Booktype, conn, scope)
	}

	/// Sourced rather than hard-coded: the column is free text, and providers do not agree
	/// on it as reliably as the "Continuing or Ended" comment suggests.
	async fn statuses(&self, ctx: &Context<'_>) -> Result<Vec<String>> {
		let conn: &DatabaseConnection = ctx.data::<CoreContext>()?.conn.as_ref();
		let scope = self.scope.clone();
		get_unique_values!(Status, conn, scope)
	}
}

#[cfg(test)]
mod tests {
	use super::*;
	use sea_orm::{sea_query::SqliteQueryBuilder, QueryTrait};

	#[test]
	fn get_base_query_unscoped_has_no_joins() {
		let sql = get_base_query(
			series_metadata::Column::Publisher,
			SeriesMetadataOverviewScope::default(),
		)
		.into_query()
		.to_string(SqliteQueryBuilder);

		assert!(!sql.contains("JOIN"), "expected no joins, got: {sql}");
		assert!(sql.contains(r#""series_metadata"."publisher""#), "{sql}");
	}

	#[test]
	fn get_base_query_scopes_to_a_library() {
		let scope = SeriesMetadataOverviewScope {
			library_id: Some("lib-1".to_string()),
		};
		let sql = get_base_query(series_metadata::Column::Publisher, scope)
			.into_query()
			.to_string(SqliteQueryBuilder);

		assert!(
			sql.contains(
				r#"INNER JOIN "series" ON "series"."id" = "series_metadata"."series_id""#
			),
			"must reach the series that carries library_id: {sql}"
		);
		assert!(
			sql.contains(r#""series"."library_id" = 'lib-1'"#),
			"must filter on the library: {sql}"
		);
	}
}
