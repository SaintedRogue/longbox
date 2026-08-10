use std::{
	cmp::Ordering,
	collections::{HashMap, HashSet},
};

use async_graphql::{Context, Object, Result, ID};
use models::entity::{media, media_metadata, user::AuthUser};
use sea_orm::prelude::*;

use crate::{
	data::{AuthContext, CoreContext},
	filter::keyword::matches_all_terms,
	object::character::Character,
	order::{CharacterOrderBy, CharacterOrdering},
	pagination::{
		OffsetPaginationInfo, PaginatedResponse, Pagination, PaginationValidator,
	},
	utils::{parse_comma_separated_list, series_in_library_subquery},
};

/// An intermediate, in-memory representation of a character while it is being filtered,
/// ordered and paginated. `key` is the lowercased `name`, retained so that
/// case-insensitive name comparisons don't re-allocate on every comparator call.
struct CharacterTally {
	key: String,
	name: String,
	book_count: i64,
}

/// Sorts characters according to `order_by`, always falling back to name ascending as the
/// final tiebreaker.
///
/// The tiebreaker matters: most characters share a `book_count` of 1, and this list is
/// paginated in-memory *after* sorting. Without a total order, two requests for different
/// pages could interleave equal-count characters differently and produce duplicates and
/// omissions across page boundaries.
fn sort_characters(characters: &mut [CharacterTally], order_by: &[CharacterOrderBy]) {
	characters.sort_by(|left, right| {
		for order in order_by {
			let ordering = match order.field {
				CharacterOrdering::Name => left.key.cmp(&right.key),
				CharacterOrdering::BookCount => left.book_count.cmp(&right.book_count),
			};

			let ordering = order.apply_direction(ordering);
			if ordering != Ordering::Equal {
				return ordering;
			}
		}

		// Names are unique (the tally is keyed by lowercased name), so this is a total order
		left.key.cmp(&right.key)
	});
}

/// Applies the (optional, case-insensitive substring) search filter to a character tally
/// and returns the result ordered per `order_by`.
///
/// Callers must paginate the *return value* of this - filtering and ordering both have to
/// happen before any page slicing, otherwise a page is a slice of an arbitrary
/// (HashMap-iteration-order) permutation.
fn filter_and_sort_characters(
	all_characters: HashMap<String, (String, i64)>,
	search: Option<&str>,
	order_by: &[CharacterOrderBy],
) -> Vec<CharacterTally> {
	let search_lower = search.map(str::to_lowercase);

	let mut characters = all_characters
		.into_iter()
		.filter(|(key, _)| {
			search_lower
				.as_ref()
				.is_none_or(|search| key.contains(search))
		})
		.map(|(key, (name, book_count))| CharacterTally {
			key,
			name,
			book_count,
		})
		.collect::<Vec<_>>();

	sort_characters(&mut characters, order_by);

	characters
}

/// Fetches all unique character names from the database, optionally scoped to a library,
/// and scoped to whatever the given user is allowed to see (hidden libraries, age
/// restrictions) - i.e. the same visibility rules `CharacterMediaLoader` applies via
/// `media::ModelWithMetadata::find_for_user`.
///
/// Returns a HashMap with lowercase name as key and (original casing, book count) as value.
///
/// Note: unlike `fetch_all_authors`, this does *not* select distinct `characters` CSV rows -
/// we need an accurate per-book tally for `book_count`, so every media row's characters are
/// counted individually rather than collapsing rows that happen to share an identical CSV value.
async fn fetch_all_characters(
	conn: &DatabaseConnection,
	library_id: Option<String>,
	auth_user: &AuthUser,
) -> Result<HashMap<String, (String, i64)>> {
	let mut query = media::ModelWithMetadata::find_for_user(auth_user)
		.filter(media_metadata::Column::Characters.is_not_null());

	if let Some(lib_id) = library_id {
		query = query.filter(
			media::Column::SeriesId.in_subquery(series_in_library_subquery(lib_id)),
		);
	}

	let models = query
		.into_model::<media::ModelWithMetadata>()
		.all(conn)
		.await?;

	// Deduplicate with case-insensitive key, preserving first-seen casing, tallying a
	// book_count as we go. A character appearing more than once in a single book's CSV
	// field must only contribute 1 to that character's book_count - so we first dedupe
	// names within each row before folding them into the global tally.
	let mut unique_characters: HashMap<String, (String, i64)> = HashMap::new();
	for model in models {
		let Some(characters_str) = model.metadata.and_then(|m| m.characters) else {
			continue;
		};

		let mut seen_in_book: HashSet<String> = HashSet::new();
		for name in parse_comma_separated_list(&characters_str) {
			let key = name.to_lowercase();
			if !seen_in_book.insert(key.clone()) {
				continue;
			}

			unique_characters
				.entry(key)
				.and_modify(|(_, c)| *c += 1)
				.or_insert((name, 1));
		}
	}

	Ok(unique_characters)
}

/// A capped preview of characters matching `query`, for the unified search
/// fan-out. Returns the page plus the total match count so the caller can show
/// "N more" and link into the fully-paginated `characters` query.
///
/// Uses the same AND-across-terms rule the SQL keyword search uses, so a query
/// does not quietly mean two different things depending on which entity answers
/// it.
pub(crate) async fn search_characters(
	conn: &DatabaseConnection,
	auth_user: &AuthUser,
	query: &str,
	limit: usize,
) -> Result<(Vec<Character>, u64)> {
	let all_characters = fetch_all_characters(conn, None, auth_user).await?;

	let mut matches = all_characters
		.into_iter()
		.filter(|(key, _)| matches_all_terms(key, query))
		.map(|(_, (name, book_count))| (name, book_count))
		.collect::<Vec<_>>();

	// Most-appearances first, name as the tiebreaker - the same default ordering
	// the `characters` query uses, so the preview is a true prefix of the full list.
	matches.sort_by(|left, right| {
		right
			.1
			.cmp(&left.1)
			.then_with(|| left.0.to_lowercase().cmp(&right.0.to_lowercase()))
	});

	let total_count = matches.len() as u64;
	let nodes = matches
		.into_iter()
		.take(limit)
		.map(|(name, book_count)| Character {
			name,
			book_count: Some(book_count),
			library_id: None,
		})
		.collect();

	Ok((nodes, total_count))
}

#[derive(Default)]
pub struct CharacterQuery;

#[Object]
impl CharacterQuery {
	/// Get a single character by name (case-insensitive exact match)
	async fn character_by_name(
		&self,
		ctx: &Context<'_>,
		name: String,
		#[graphql(desc = "Optional library ID to scope the character search")]
		library_id: Option<ID>,
	) -> Result<Option<Character>> {
		let AuthContext { user, .. } = ctx.data::<AuthContext>()?;
		let conn = ctx.data::<CoreContext>()?.conn.as_ref();
		let library_id = library_id.map(|id| id.to_string());

		let characters = fetch_all_characters(conn, library_id.clone(), user).await?;
		let search_key = name.to_lowercase();

		Ok(characters
			.get(&search_key)
			.map(|(original_name, count)| Character {
				name: original_name.clone(),
				book_count: Some(*count),
				library_id,
			}))
	}

	/// Get a paginated list of characters with optional search filter
	async fn characters(
		&self,
		ctx: &Context<'_>,
		#[graphql(desc = "Case-insensitive substring search filter")] search: Option<
			String,
		>,
		#[graphql(desc = "Optional library ID to scope the character search")]
		library_id: Option<ID>,
		#[graphql(
			desc = "Ordering for the returned characters, applied before pagination. Defaults to most books first",
			default_with = "CharacterOrderBy::default_vec()"
		)]
		order_by: Vec<CharacterOrderBy>,
		#[graphql(default, validator(custom = "PaginationValidator"))]
		pagination: Pagination,
	) -> Result<PaginatedResponse<Character>> {
		let AuthContext { user, .. } = ctx.data::<AuthContext>()?;
		let conn = ctx.data::<CoreContext>()?.conn.as_ref();
		let library_id = library_id.map(|id| id.to_string());

		let all_characters = fetch_all_characters(conn, library_id.clone(), user).await?;

		// NOTE: filtering and ordering both happen before the pagination slicing below
		let sorted =
			filter_and_sort_characters(all_characters, search.as_deref(), &order_by);

		let total_count = sorted.len() as u64;

		// TODO: Pagination with large datasets NOT bound strictly to db records is a bit tricky and honestly not overly efficient
		match pagination.resolve() {
			Pagination::Cursor(_) => {
				// Cursor pagination doesn't make sense for in-memory data without stable IDs
				Err("Cursor pagination is not supported for characters".into())
			},
			Pagination::Offset(info) => {
				let offset = info.offset() as usize;
				let limit = info.limit() as usize;

				let paginated: Vec<Character> = sorted
					.into_iter()
					.skip(offset)
					.take(limit)
					.map(|tally| Character {
						name: tally.name,
						book_count: Some(tally.book_count),
						library_id: library_id.clone(),
					})
					.collect();

				Ok(PaginatedResponse {
					nodes: paginated,
					page_info: OffsetPaginationInfo::new(info, total_count).into(),
				})
			},
			Pagination::None(_) => {
				let characters: Vec<Character> = sorted
					.into_iter()
					.map(|tally| Character {
						name: tally.name,
						book_count: Some(tally.book_count),
						library_id: library_id.clone(),
					})
					.collect();

				Ok(PaginatedResponse {
					nodes: characters,
					page_info: OffsetPaginationInfo::unpaged(total_count).into(),
				})
			},
		}
	}
}

#[cfg(test)]
mod tests {
	use super::*;
	use ::tests::{db::test_database, fake_data};
	use models::{entity::library_exclusion, shared::ordering::OrderDirection};

	/// Builds the same shape `fetch_all_characters` returns from `(name, book_count)` pairs
	fn tally(entries: &[(&str, i64)]) -> HashMap<String, (String, i64)> {
		entries
			.iter()
			.map(|(name, count)| (name.to_lowercase(), (String::from(*name), *count)))
			.collect()
	}

	fn order_by(field: CharacterOrdering, direction: OrderDirection) -> CharacterOrderBy {
		CharacterOrderBy { field, direction }
	}

	fn names(characters: &[CharacterTally]) -> Vec<&str> {
		characters.iter().map(|c| c.name.as_str()).collect()
	}

	#[test]
	fn test_default_ordering_is_book_count_descending() {
		let characters = filter_and_sort_characters(
			tally(&[("Robin", 3), ("Batman", 12), ("Alfred", 7)]),
			None,
			&CharacterOrderBy::default_vec(),
		);

		assert_eq!(names(&characters), vec!["Batman", "Alfred", "Robin"]);
	}

	#[test]
	fn test_equal_book_counts_tiebreak_on_name_ascending() {
		// Every character shares a count of 1, so ordering is decided entirely by the
		// tiebreaker. Casing must not matter ("alfred" sorts before "Batman").
		let characters = filter_and_sort_characters(
			tally(&[("Robin", 1), ("Batman", 1), ("alfred", 1), ("Zatanna", 1)]),
			None,
			&CharacterOrderBy::default_vec(),
		);

		assert_eq!(
			names(&characters),
			vec!["alfred", "Batman", "Robin", "Zatanna"]
		);
	}

	#[test]
	fn test_tiebreaker_applies_to_partial_ties_within_book_count() {
		let characters = filter_and_sort_characters(
			tally(&[("Robin", 2), ("Batman", 5), ("Alfred", 2), ("Nightwing", 5)]),
			None,
			&CharacterOrderBy::default_vec(),
		);

		assert_eq!(
			names(&characters),
			vec!["Batman", "Nightwing", "Alfred", "Robin"]
		);
	}

	#[test]
	fn test_order_by_name_in_either_direction() {
		let entries = [("Robin", 3), ("Batman", 12), ("alfred", 7)];

		let ascending = filter_and_sort_characters(
			tally(&entries),
			None,
			&[order_by(CharacterOrdering::Name, OrderDirection::Asc)],
		);
		assert_eq!(names(&ascending), vec!["alfred", "Batman", "Robin"]);

		let descending = filter_and_sort_characters(
			tally(&entries),
			None,
			&[order_by(CharacterOrdering::Name, OrderDirection::Desc)],
		);
		assert_eq!(names(&descending), vec!["Robin", "Batman", "alfred"]);
	}

	#[test]
	fn test_order_by_book_count_ascending() {
		let characters = filter_and_sort_characters(
			tally(&[("Robin", 3), ("Batman", 12), ("Alfred", 7)]),
			None,
			&[order_by(CharacterOrdering::BookCount, OrderDirection::Asc)],
		);

		assert_eq!(names(&characters), vec!["Robin", "Alfred", "Batman"]);
	}

	#[test]
	fn test_search_filter_is_applied_before_ordering() {
		let characters = filter_and_sort_characters(
			tally(&[("Batman", 1), ("Batgirl", 9), ("Superman", 20)]),
			Some("BAT"),
			&CharacterOrderBy::default_vec(),
		);

		assert_eq!(names(&characters), vec!["Batgirl", "Batman"]);
	}

	#[test]
	fn test_ordering_is_applied_before_pagination() {
		// Deliberately mostly-tied counts: without the name tiebreaker, the HashMap's
		// (randomized, per-instance) iteration order would leak into the page slices and
		// the same character could appear on both pages - or on neither.
		let entries = [
			("Robin", 1),
			("Batman", 4),
			("Alfred", 1),
			("Nightwing", 1),
			("Zatanna", 1),
			("Catwoman", 1),
		];
		let page_size = 3;

		// Built from two independently-constructed HashMaps, mirroring two separate
		// requests for page 1 and page 2
		let first_page = filter_and_sort_characters(
			tally(&entries),
			None,
			&CharacterOrderBy::default_vec(),
		)
		.into_iter()
		.take(page_size)
		.collect::<Vec<_>>();
		let second_page = filter_and_sort_characters(
			tally(&entries),
			None,
			&CharacterOrderBy::default_vec(),
		)
		.into_iter()
		.skip(page_size)
		.take(page_size)
		.collect::<Vec<_>>();

		assert_eq!(names(&first_page), vec!["Batman", "Alfred", "Catwoman"]);
		assert_eq!(names(&second_page), vec!["Nightwing", "Robin", "Zatanna"]);

		// No overlap, and between them the two pages cover every character exactly once
		let mut all = names(&first_page);
		all.extend(names(&second_page));
		let unique = all.iter().copied().collect::<HashSet<_>>();
		assert_eq!(all.len(), entries.len());
		assert_eq!(unique.len(), entries.len());
	}

	fn auth_user(id: &str) -> AuthUser {
		AuthUser {
			id: id.to_string(),
			username: format!("user-{id}"),
			is_server_owner: true,
			..Default::default()
		}
	}

	async fn insert_media_with_characters(
		db: &DatabaseConnection,
		series_id: &str,
		characters: &str,
	) {
		let media = fake_data::Media {
			series_id: series_id.to_string(),
			..Default::default()
		}
		.insert(db)
		.await;

		media_metadata::ActiveModel {
			media_id: sea_orm::Set(Some(media.id)),
			characters: sea_orm::Set(Some(characters.to_string())),
			..Default::default()
		}
		.insert(db)
		.await
		.expect("failed to insert media metadata");
	}

	#[tokio::test]
	async fn test_duplicate_character_name_in_one_book_counts_once() {
		let db = test_database().await;

		let library = fake_data::Library::default().insert(&db).await;
		let series = fake_data::Series {
			library_id: Some(library.id.clone()),
			..Default::default()
		}
		.insert(&db)
		.await;

		// A single book whose CSV `characters` field lists the same character twice
		// (e.g. from manually-edited/merged metadata) must only count once towards
		// that character's book_count.
		insert_media_with_characters(&db, &series.id, "Batman, Batman").await;

		let user = auth_user("user-1");
		let characters = fetch_all_characters(&db, None, &user)
			.await
			.expect("fetch_all_characters failed");

		let (_, count) = characters.get("batman").expect("expected a batman entry");
		assert_eq!(*count, 1);
	}

	#[tokio::test]
	async fn test_book_count_excludes_books_in_hidden_library() {
		let db = test_database().await;

		let visible_library = fake_data::Library::default().insert(&db).await;
		let hidden_library = fake_data::Library::default().insert(&db).await;

		let visible_series = fake_data::Series {
			library_id: Some(visible_library.id.clone()),
			..Default::default()
		}
		.insert(&db)
		.await;
		let hidden_series = fake_data::Series {
			library_id: Some(hidden_library.id.clone()),
			..Default::default()
		}
		.insert(&db)
		.await;

		insert_media_with_characters(&db, &visible_series.id, "Batman").await;
		insert_media_with_characters(&db, &hidden_series.id, "Batman").await;

		// The `library_exclusions` table has a real FK to `users`, so the user needs to
		// actually exist for the exclusion insert below to succeed.
		let user_model = fake_data::User::new("user-2").insert(&db).await;
		let user = auth_user(&user_model.id);

		library_exclusion::ActiveModel {
			user_id: sea_orm::Set(user.id.clone()),
			library_id: sea_orm::Set(hidden_library.id.clone()),
			..Default::default()
		}
		.insert(&db)
		.await
		.expect("failed to insert library exclusion");

		let characters = fetch_all_characters(&db, None, &user)
			.await
			.expect("fetch_all_characters failed");

		// Only the book in the visible library should be counted - if the hidden
		// library's book leaked in, this would be 2.
		let (_, count) = characters.get("batman").expect("expected a batman entry");
		assert_eq!(*count, 1);
	}

	#[tokio::test]
	async fn test_book_count_excludes_books_over_age_restriction() {
		let db = test_database().await;

		let library = fake_data::Library::default().insert(&db).await;
		let series = fake_data::Series {
			library_id: Some(library.id.clone()),
			..Default::default()
		}
		.insert(&db)
		.await;

		let allowed_media = fake_data::Media {
			series_id: series.id.clone(),
			..Default::default()
		}
		.insert(&db)
		.await;
		media_metadata::ActiveModel {
			media_id: sea_orm::Set(Some(allowed_media.id)),
			characters: sea_orm::Set(Some("Batman".to_string())),
			age_rating: sea_orm::Set(Some(10)),
			..Default::default()
		}
		.insert(&db)
		.await
		.expect("failed to insert media metadata");

		let restricted_media = fake_data::Media {
			series_id: series.id.clone(),
			..Default::default()
		}
		.insert(&db)
		.await;
		media_metadata::ActiveModel {
			media_id: sea_orm::Set(Some(restricted_media.id)),
			characters: sea_orm::Set(Some("Batman".to_string())),
			age_rating: sea_orm::Set(Some(18)),
			..Default::default()
		}
		.insert(&db)
		.await
		.expect("failed to insert media metadata");

		let mut user = auth_user("user-3");
		user.age_restriction = Some(models::entity::age_restriction::Model {
			id: 1,
			age: 13,
			restrict_on_unset: true,
			user_id: user.id.clone(),
		});

		let characters = fetch_all_characters(&db, None, &user)
			.await
			.expect("fetch_all_characters failed");

		// Only the book rated for the user's age restriction should be counted - if the
		// over-restricted book leaked in, this would be 2.
		let (_, count) = characters.get("batman").expect("expected a batman entry");
		assert_eq!(*count, 1);
	}
}
