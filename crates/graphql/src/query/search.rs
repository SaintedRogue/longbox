use async_graphql::{Context, Object, Result};
use models::entity::{library, media, series};
use sea_orm::{prelude::*, QuerySelect, QueryTrait};

use crate::{
	data::{AuthContext, CoreContext},
	filter::{
		library::library_keyword_condition, media::media_keyword_condition,
		series::series_keyword_condition,
	},
	object::{
		library::Library,
		media::Media,
		search::{SearchAllResult, SearchGroup},
		series::Series,
	},
	query::{author::search_authors, character::search_characters},
};

/// Keep a library's loose-file bucket out of search results.
///
/// Mirrors `query::series::exclude_loose_root`. The scanner turns a library root
/// into a series when books sit loose in it, so a library at `/data` grows a
/// series named `data` -- a scan artifact nobody asked for, which should not
/// surface as a search hit.
fn exclude_loose_root(query: Select<series::Entity>) -> Select<series::Entity> {
	query.filter(
		series::Column::Id.not_in_subquery(series::Entity::loose_root_ids_subquery()),
	)
}

#[derive(Default)]
pub struct SearchQuery;

#[Object]
impl SearchQuery {
	/// Search books, series, libraries, authors and characters in one request.
	///
	/// This is a *preview* endpoint: each group is capped, and expanding one type
	/// means calling that type's own paginated query with the same search string
	/// rather than paginating here. That keeps the fan-out cheap and means
	/// expanding one group never refetches the others.
	async fn search_all(
		&self,
		ctx: &Context<'_>,
		#[graphql(desc = "The search string. Terms are AND-ed, as they are for \
		                  the per-entity `search` arguments.")]
		query: String,
		#[graphql(
			desc = "Maximum results per entity type.",
			default = 5,
			validator(minimum = 1, maximum = 20)
		)]
		limit_per_type: u64,
	) -> Result<SearchAllResult> {
		let AuthContext { user, .. } = ctx.data::<AuthContext>()?;
		let conn = ctx.data::<CoreContext>()?.conn.as_ref();

		// Every branch goes through the same `find_for_user`/`fetch_all_*` scoping
		// the individual resolvers use. This is a fan-out over already-correct
		// paths, not a new access-control surface.
		let media_query = media::ModelWithMetadata::find_for_user(user)
			.filter(media::Column::DeletedAt.is_null())
			.apply_if(media_keyword_condition(Some(&query)), |query, condition| {
				query.filter(condition)
			});
		let media_total = media_query.clone().count(conn).await?;
		let media_nodes = media_query
			.limit(limit_per_type)
			.into_model::<media::ModelWithMetadata>()
			.all(conn)
			.await?
			.into_iter()
			.map(Media::from)
			.collect::<Vec<_>>();

		let series_query =
			exclude_loose_root(series::ModelWithMetadata::find_for_user(user).apply_if(
				series_keyword_condition(Some(&query)),
				|query, condition| query.filter(condition),
			));
		let series_total = series_query.clone().count(conn).await?;
		let series_nodes = series_query
			.limit(limit_per_type)
			.into_model::<series::ModelWithMetadata>()
			.all(conn)
			.await?
			.into_iter()
			.map(Series::from)
			.collect::<Vec<_>>();

		let library_query = library::Entity::find_for_user(user).apply_if(
			library_keyword_condition(Some(&query)),
			|query, condition| query.filter(condition),
		);
		let library_total = library_query.clone().count(conn).await?;
		let library_nodes = library_query
			.limit(limit_per_type)
			.all(conn)
			.await?
			.into_iter()
			.map(Library::from)
			.collect::<Vec<_>>();

		let limit = limit_per_type as usize;
		let (author_nodes, author_total) =
			search_authors(conn, user, &query, limit).await?;
		let (character_nodes, character_total) =
			search_characters(conn, user, &query, limit).await?;

		Ok(SearchAllResult {
			media: SearchGroup {
				nodes: media_nodes,
				total_count: media_total,
			},
			series: SearchGroup {
				nodes: series_nodes,
				total_count: series_total,
			},
			libraries: SearchGroup {
				nodes: library_nodes,
				total_count: library_total,
			},
			authors: SearchGroup {
				nodes: author_nodes,
				total_count: author_total,
			},
			characters: SearchGroup {
				nodes: character_nodes,
				total_count: character_total,
			},
		})
	}
}
