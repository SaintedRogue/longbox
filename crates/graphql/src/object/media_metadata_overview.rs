use crate::data::CoreContext;
use async_graphql::{Context, Object, Result};
use models::entity::{media, media_metadata, series};
use sea_orm::{prelude::*, DatabaseConnection, QuerySelect, RelationTrait, Select};
use std::collections::BTreeSet;

static VALUE_SEPERATOR: char = ',';
fn make_unique(iter: impl Iterator<Item = String>) -> Vec<String> {
	BTreeSet::<String>::from_iter(iter)
		.into_iter()
		.filter(|s| !s.is_empty())
		.collect::<Vec<String>>()
}

fn list_str_to_vec(list: String) -> Vec<String> {
	list.split(VALUE_SEPERATOR)
		.map(|s| s.trim().to_string())
		.collect()
}

/// Which books the distinct values are drawn from.
///
/// Both bounds are optional and compose. `library_id` exists because the filter
/// controls in a library view are only useful if their options describe *that*
/// library: unscoped, a library with no manga in it still offered every manga
/// genre on the server, and picking one returned nothing.
#[derive(Default, Debug, Clone)]
pub struct MetadataOverviewScope {
	pub series_id: Option<String>,
	pub library_id: Option<String>,
}

impl MetadataOverviewScope {
	fn is_unscoped(&self) -> bool {
		self.series_id.is_none() && self.library_id.is_none()
	}
}

fn get_base_query(
	column: media_metadata::Column,
	scope: MetadataOverviewScope,
) -> Select<media_metadata::Entity> {
	let query = media_metadata::Entity::find_for_column(column);

	if scope.is_unscoped() {
		return query;
	}

	// Any scoping needs the owning book; `library_id` lives one further hop out, on
	// the series, so that join is added only when it is actually filtered on.
	let mut query = query.join_rev(
		sea_orm::JoinType::InnerJoin,
		media::Entity::belongs_to(media_metadata::Entity)
			.from(models::entity::media::Column::Id)
			.to(models::entity::media_metadata::Column::MediaId)
			.into(),
	);

	if let Some(series_id) = scope.series_id {
		query = query.filter(media::Column::SeriesId.eq(series_id));
	}

	if let Some(library_id) = scope.library_id {
		query = query
			.join(sea_orm::JoinType::InnerJoin, media::Relation::Series.def())
			.filter(series::Column::LibraryId.eq(library_id));
	}

	query
}

macro_rules! get_unique_values_inner {
	($column:ident, $conn:ident, $scope:ident) => {{
		let query = get_base_query(media_metadata::Column::$column, $scope);
		let values: Vec<String> = query.into_tuple().all($conn).await?;
		Ok(make_unique(values.into_iter().flat_map(list_str_to_vec)))
	}};
}

#[derive(Default, Debug, Clone)]
pub struct MediaMetadataOverview {
	pub scope: MetadataOverviewScope,
}

#[Object]
impl MediaMetadataOverview {
	async fn genres(&self, ctx: &Context<'_>) -> Result<Vec<String>> {
		let conn: &DatabaseConnection = ctx.data::<CoreContext>()?.conn.as_ref();
		let scope = self.scope.clone();
		get_unique_values_inner!(Genres, conn, scope)
	}

	async fn writers(&self, ctx: &Context<'_>) -> Result<Vec<String>> {
		let conn: &DatabaseConnection = ctx.data::<CoreContext>()?.conn.as_ref();
		let scope = self.scope.clone();
		get_unique_values_inner!(Writers, conn, scope)
	}

	async fn pencillers(&self, ctx: &Context<'_>) -> Result<Vec<String>> {
		let conn: &DatabaseConnection = ctx.data::<CoreContext>()?.conn.as_ref();
		let scope = self.scope.clone();
		get_unique_values_inner!(Pencillers, conn, scope)
	}

	async fn inkers(&self, ctx: &Context<'_>) -> Result<Vec<String>> {
		let conn: &DatabaseConnection = ctx.data::<CoreContext>()?.conn.as_ref();
		let scope = self.scope.clone();
		get_unique_values_inner!(Inkers, conn, scope)
	}

	async fn colorists(&self, ctx: &Context<'_>) -> Result<Vec<String>> {
		let conn: &DatabaseConnection = ctx.data::<CoreContext>()?.conn.as_ref();
		let scope = self.scope.clone();
		get_unique_values_inner!(Colorists, conn, scope)
	}

	async fn letterers(&self, ctx: &Context<'_>) -> Result<Vec<String>> {
		let conn: &DatabaseConnection = ctx.data::<CoreContext>()?.conn.as_ref();
		let scope = self.scope.clone();
		get_unique_values_inner!(Letterers, conn, scope)
	}

	async fn cover_artists(&self, ctx: &Context<'_>) -> Result<Vec<String>> {
		let conn: &DatabaseConnection = ctx.data::<CoreContext>()?.conn.as_ref();
		let scope = self.scope.clone();
		get_unique_values_inner!(CoverArtists, conn, scope)
	}

	async fn editors(&self, ctx: &Context<'_>) -> Result<Vec<String>> {
		let conn: &DatabaseConnection = ctx.data::<CoreContext>()?.conn.as_ref();
		let scope = self.scope.clone();
		get_unique_values_inner!(Editors, conn, scope)
	}

	async fn publishers(&self, ctx: &Context<'_>) -> Result<Vec<String>> {
		let conn: &DatabaseConnection = ctx.data::<CoreContext>()?.conn.as_ref();
		let scope = self.scope.clone();
		let values: Vec<String> =
			get_base_query(media_metadata::Column::Publisher, scope)
				.into_tuple()
				.all(conn)
				.await?;
		Ok(values)
	}

	async fn characters(&self, ctx: &Context<'_>) -> Result<Vec<String>> {
		let conn: &DatabaseConnection = ctx.data::<CoreContext>()?.conn.as_ref();
		let scope = self.scope.clone();
		get_unique_values_inner!(Characters, conn, scope)
	}

	async fn teams(&self, ctx: &Context<'_>) -> Result<Vec<String>> {
		let conn: &DatabaseConnection = ctx.data::<CoreContext>()?.conn.as_ref();
		let scope = self.scope.clone();
		get_unique_values_inner!(Teams, conn, scope)
	}

	async fn series(&self, ctx: &Context<'_>) -> Result<Vec<String>> {
		let conn: &DatabaseConnection = ctx.data::<CoreContext>()?.conn.as_ref();
		let scope = self.scope.clone();
		get_unique_values_inner!(Series, conn, scope)
	}
}

#[cfg(test)]
mod tests {
	use super::*;
	use sea_orm::{sea_query::SqliteQueryBuilder, MockDatabase, QueryTrait, Value};

	async fn get_unique_values_inner_test(
		conn: &DatabaseConnection,
	) -> Result<Vec<String>> {
		let scope = MetadataOverviewScope::default();
		get_unique_values_inner!(Genres, conn, scope)
	}

	#[test]
	fn get_base_query_test() {
		let scope = MetadataOverviewScope {
			series_id: Some("test_series".to_string()),
			library_id: None,
		};
		let query = get_base_query(media_metadata::Column::Genres, scope);
		assert_eq!(
			query.to_owned().into_query().to_string(SqliteQueryBuilder),
			r#"SELECT DISTINCT "media_metadata"."genres" FROM "media_metadata" "#
				.to_string() + r#"INNER JOIN "media" ON "media"."id" = "media_metadata"."media_id" "#
				+ r#"WHERE "media_metadata"."genres" IS NOT NULL AND "media"."series_id" = 'test_series' "#
				+ r#"ORDER BY "media_metadata"."genres" ASC"#
		);
	}

	/// Library scoping needs one hop further than series scoping: `library_id` lives
	/// on `series`, not on `media`. Without this join the filter controls in a library
	/// view listed values from every library on the server.
	#[test]
	fn get_base_query_scopes_to_a_library() {
		let scope = MetadataOverviewScope {
			series_id: None,
			library_id: Some("lib-1".to_string()),
		};
		let sql = get_base_query(media_metadata::Column::Genres, scope)
			.into_query()
			.to_string(SqliteQueryBuilder);

		assert!(
			sql.contains(
				r#"INNER JOIN "media" ON "media"."id" = "media_metadata"."media_id""#
			),
			"must reach the owning book: {sql}"
		);
		assert!(
			sql.contains(r#"INNER JOIN "series""#),
			"must reach the series that carries library_id: {sql}"
		);
		assert!(
			sql.contains(r#""series"."library_id" = 'lib-1'"#),
			"must filter on the library: {sql}"
		);
	}

	/// An unscoped overview must not pay for joins it does not use.
	#[test]
	fn get_base_query_unscoped_has_no_joins() {
		let sql = get_base_query(
			media_metadata::Column::Genres,
			MetadataOverviewScope::default(),
		)
		.into_query()
		.to_string(SqliteQueryBuilder);

		assert!(!sql.contains("JOIN"), "expected no joins, got: {sql}");
	}

	/// Both bounds compose — the series filter and the library filter are both applied.
	#[test]
	fn get_base_query_composes_series_and_library() {
		let scope = MetadataOverviewScope {
			series_id: Some("s-1".to_string()),
			library_id: Some("lib-1".to_string()),
		};
		let sql = get_base_query(media_metadata::Column::Genres, scope)
			.into_query()
			.to_string(SqliteQueryBuilder);

		assert!(sql.contains(r#""media"."series_id" = 's-1'"#), "{sql}");
		assert!(sql.contains(r#""series"."library_id" = 'lib-1'"#), "{sql}");
	}

	#[tokio::test]
	async fn test_get_unique_values() {
		let mock_db = MockDatabase::new(sea_orm::DatabaseBackend::Sqlite)
			.append_query_results([[maplit::btreemap! {
				"0" => Into::<Value>::into(["a", "a", "c"].join(&VALUE_SEPERATOR.to_string())),
			}]])
			.into_connection();

		let mut genres = get_unique_values_inner_test(&mock_db).await.unwrap();
		genres.sort();
		assert_eq!(genres, vec!["a", "c"]);
	}

	#[tokio::test]
	async fn test_get_empty_values() {
		let mock_db = MockDatabase::new(sea_orm::DatabaseBackend::Sqlite)
			.append_query_results([[maplit::btreemap! {
				"0" => Into::<Value>::into("".to_string()),
			}]])
			.into_connection();

		let genres = get_unique_values_inner_test(&mock_db).await.unwrap();
		assert!(genres.is_empty());
	}

	#[tokio::test]
	async fn test_empty_value_after_split() {
		let mock_db = MockDatabase::new(sea_orm::DatabaseBackend::Sqlite)
			.append_query_results([[maplit::btreemap! {
				"0" => Into::<Value>::into(["a", "", "c"].join(&VALUE_SEPERATOR.to_string())),
			}]])
			.into_connection();

		let mut genres = get_unique_values_inner_test(&mock_db).await.unwrap();
		genres.sort();
		assert_eq!(genres, vec!["a", "c"]);
	}
}
