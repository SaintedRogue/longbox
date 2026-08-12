use std::collections::{HashMap, HashSet};

use async_graphql::{Context, Enum, Object, Result, ID};
use longbox_core::omnibus;
use models::entity::{media, series};
use sea_orm::{prelude::*, QueryFilter, QueryOrder, QuerySelect};

use crate::{
	data::{AuthContext, CoreContext},
	object::omnibus::OmnibusSet,
	pagination::{
		CursorPaginationInfo, OffsetPaginationInfo, PaginatedResponse, Pagination,
		PaginationValidator,
	},
};

/// How to order the shelf.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Enum, Default)]
pub enum OmnibusSetOrderBy {
	/// Alphabetical by set title — a bookshelf's natural order.
	#[default]
	Title,
	/// Newest arrival first, by the most recently added volume in each set.
	RecentlyAdded,
}

#[derive(Default)]
pub struct OmnibusQuery;

#[Object]
impl OmnibusQuery {
	/// The omnibus sets in a library: one entry per set, with its volumes.
	///
	/// Books are grouped into sets here, in the resolver, and it is the *sets* that are
	/// paginated. Paginating books instead would be a smaller change and quietly wrong: a
	/// page boundary would fall inside a five-volume set, the volume count would report
	/// only the volumes on the current page, and the set would appear again on the next
	/// one.
	///
	/// A book qualifies when its own name, its metadata title, its metadata format, or its
	/// series' name says "omnibus". Including the series name is what covers a flat
	/// library, where the folder carries the name and the files inside it are called
	/// `v01.cbz`.
	async fn omnibus_sets(
		&self,
		ctx: &Context<'_>,
		#[graphql(
			desc = "Restrict to one library. Omitted, the shelf spans every library the caller can see."
		)]
		library_id: Option<ID>,
		#[graphql(desc = "Free-text match against the set title, case-insensitive.")]
		search: Option<String>,
		#[graphql(default)] order_by: OmnibusSetOrderBy,
		#[graphql(default, validator(custom = "PaginationValidator"))]
		pagination: Pagination,
	) -> Result<PaginatedResponse<OmnibusSet>> {
		let AuthContext { user, .. } = ctx.data::<AuthContext>()?;
		let conn = ctx.data::<CoreContext>()?.conn.as_ref();

		let library_id = library_id.map(|id| id.to_string());

		// `find_for_user` is what confines the shelf to libraries this caller may see, and
		// applies their age restriction. Everything below narrows an already-safe query.
		let mut query = media::ModelWithMetadata::find_for_user(user)
			.filter(media::Column::DeletedAt.is_null())
			.filter(omnibus::qualifying_condition(
				omnibus::omnibus_series_query(library_id.as_deref()),
			));

		if let Some(ref library_id) = library_id {
			query = query.filter(
				media::Column::SeriesId
					.in_subquery(omnibus::series_in_library_query(library_id)),
			);
		}

		// One past the ceiling, so hitting it is detectable rather than merely suspected.
		let mut books = query
			.order_by_asc(media::Column::Name)
			.limit(omnibus::MAX_QUALIFYING_BOOKS + 1)
			.into_model::<media::ModelWithMetadata>()
			.all(conn)
			.await?;

		let truncated = books.len() as u64 > omnibus::MAX_QUALIFYING_BOOKS;
		if truncated {
			tracing::warn!(
				ceiling = omnibus::MAX_QUALIFYING_BOOKS,
				?library_id,
				"Omnibus shelf hit the qualifying-books ceiling; the shelf is partial"
			);
			books.truncate(omnibus::MAX_QUALIFYING_BOOKS as usize);
		}

		let series_names = fetch_series_names(conn, &books).await?;

		let mut sets = omnibus::group_sets(books, &series_names);

		// Filtering after grouping means the term is matched against the set's name — the
		// thing on the card — rather than against individual filenames, which for a flat
		// library are often just `v01.cbz`.
		if let Some(term) = search.as_deref().map(str::trim).filter(|t| !t.is_empty()) {
			let term = term.to_lowercase();
			sets.retain(|set| set.title.to_lowercase().contains(&term));
		}

		match order_by {
			OmnibusSetOrderBy::Title => {
				sets.sort_by(|a, b| a.title.to_lowercase().cmp(&b.title.to_lowercase()))
			},
			// Sets with no dated volume sort last rather than first, so an oddity in the
			// data doesn't take over the top of the shelf.
			OmnibusSetOrderBy::RecentlyAdded => {
				sets.sort_by(|a, b| b.newest_added().cmp(&a.newest_added()))
			},
		}

		Ok(paginate(sets, truncated, pagination.resolve()))
	}
}

/// The names of every series the given books belong to.
///
/// Needed for two things at once: deciding whether a book's *series* is the omnibus set,
/// and titling the card when it is.
async fn fetch_series_names(
	conn: &DatabaseConnection,
	books: &[media::ModelWithMetadata],
) -> Result<HashMap<String, String>> {
	let series_ids = books
		.iter()
		.filter_map(|book| book.media.series_id.clone())
		.collect::<HashSet<_>>();

	if series_ids.is_empty() {
		return Ok(HashMap::new());
	}

	let rows = series::Entity::find()
		.filter(series::Column::Id.is_in(series_ids))
		.all(conn)
		.await?;

	Ok(rows
		.into_iter()
		.map(|row| (row.id, row.name))
		.collect::<HashMap<_, _>>())
}

/// Slice the ordered sets into the requested page.
///
/// Cursor pagination treats `after` as a set key and resumes from the entry following it.
/// An unknown key — a set that has since been renamed or removed — restarts from the
/// beginning rather than erroring, which is the friendlier failure for a browse surface.
fn paginate(
	sets: Vec<omnibus::OmnibusSetData>,
	truncated: bool,
	pagination: Pagination,
) -> PaginatedResponse<OmnibusSet> {
	let total = sets.len() as u64;
	let build = |data: Vec<omnibus::OmnibusSetData>| {
		data.into_iter()
			.map(|set| OmnibusSet::from_data(set, truncated))
			.collect::<Vec<_>>()
	};

	match pagination {
		Pagination::Offset(info) => {
			let nodes = build(
				sets.into_iter()
					.skip(info.offset() as usize)
					.take(info.limit() as usize)
					.collect(),
			);

			PaginatedResponse {
				nodes,
				page_info: OffsetPaginationInfo::new(info, total).into(),
			}
		},
		Pagination::Cursor(info) => {
			let start = info
				.after
				.as_deref()
				.and_then(|cursor| sets.iter().position(|set| set.key.as_id() == cursor))
				.map(|position| position + 1)
				.unwrap_or(0);

			let limit = info.limit as usize;
			let next_cursor = sets
				.get(start + limit)
				.map(|_| sets[start + limit - 1].key.as_id());
			let current_cursor = sets.get(start).map(|set| set.key.as_id());

			let nodes = build(sets.into_iter().skip(start).take(limit).collect());

			PaginatedResponse {
				nodes,
				page_info: CursorPaginationInfo {
					current_cursor,
					next_cursor,
					limit: info.limit,
				}
				.into(),
			}
		},
		Pagination::None(_) => PaginatedResponse {
			nodes: build(sets),
			page_info: OffsetPaginationInfo::unpaged(total).into(),
		},
	}
}
