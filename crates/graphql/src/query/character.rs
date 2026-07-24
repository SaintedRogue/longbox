use std::collections::{HashMap, HashSet};

use async_graphql::{Context, Object, Result, ID};
use models::entity::{media, media_metadata, user::AuthUser};
use sea_orm::prelude::*;

use crate::{
	data::{AuthContext, CoreContext},
	object::character::Character,
	pagination::{
		OffsetPaginationInfo, PaginatedResponse, Pagination, PaginationValidator,
	},
	utils::{parse_comma_separated_list, series_in_library_subquery},
};

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
		#[graphql(default, validator(custom = "PaginationValidator"))]
		pagination: Pagination,
	) -> Result<PaginatedResponse<Character>> {
		let AuthContext { user, .. } = ctx.data::<AuthContext>()?;
		let conn = ctx.data::<CoreContext>()?.conn.as_ref();
		let library_id = library_id.map(|id| id.to_string());

		let all_characters = fetch_all_characters(conn, library_id.clone(), user).await?;

		let filtered: Vec<(String, i64)> = if let Some(ref search_term) = search {
			let search_lower = search_term.to_lowercase();
			all_characters
				.into_iter()
				.filter(|(key, _)| key.contains(&search_lower))
				.map(|(_, value)| value)
				.collect()
		} else {
			all_characters.into_values().collect()
		};

		let mut sorted: Vec<(String, i64)> = filtered;
		sorted.sort_by_key(|(name, _)| name.to_lowercase());

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
					.map(|(name, count)| Character {
						name,
						book_count: Some(count),
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
					.map(|(name, count)| Character {
						name,
						book_count: Some(count),
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
	use models::entity::library_exclusion;

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
