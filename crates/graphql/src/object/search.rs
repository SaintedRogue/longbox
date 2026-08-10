use async_graphql::{OutputType, SimpleObject};

use crate::object::{
	author::Author, character::Character, library::Library, media::Media, series::Series,
};

/// One entity type's slice of a unified search.
///
/// `total_count` is the number of matches across the whole server, not the
/// length of `nodes` -- the caller uses it to decide whether to offer "N more"
/// and to link into that type's own fully-paginated query.
#[derive(Debug, SimpleObject)]
#[graphql(concrete(name = "MediaSearchGroup", params(Media)))]
#[graphql(concrete(name = "SeriesSearchGroup", params(Series)))]
#[graphql(concrete(name = "LibrarySearchGroup", params(Library)))]
#[graphql(concrete(name = "AuthorSearchGroup", params(Author)))]
#[graphql(concrete(name = "CharacterSearchGroup", params(Character)))]
pub struct SearchGroup<T>
where
	T: OutputType,
{
	pub nodes: Vec<T>,
	pub total_count: u64,
}

/// The result of a unified search: one capped group per entity type.
///
/// Grouped rather than a flat union of results, because the five sources cannot
/// share a pagination scheme. Books, series and libraries paginate in SQL, while
/// characters and authors are tallied from CSV metadata columns into a HashMap
/// and paginated in memory. A single interleaved list would have to materialise
/// all five on every page request to order them consistently.
#[derive(Debug, SimpleObject)]
pub struct SearchAllResult {
	pub media: SearchGroup<Media>,
	pub series: SearchGroup<Series>,
	pub libraries: SearchGroup<Library>,
	pub authors: SearchGroup<Author>,
	pub characters: SearchGroup<Character>,
}
