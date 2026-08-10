use std::collections::HashMap;

use async_graphql::{Context, Object, Result};
use models::entity::{media, media_metadata, user::AuthUser};
use sea_orm::{prelude::*, QuerySelect};

use crate::{
	data::{AuthContext, CoreContext},
	filter::keyword::matches_all_terms,
	object::author::{Author, AuthorSeries},
	pagination::{
		OffsetPaginationInfo, PaginatedResponse, Pagination, PaginationValidator,
	},
	utils::{parse_comma_separated_list, series_in_library_subquery},
};

/// Fetches all unique author names from the database, optionally scoped to a library,
/// and scoped to whatever the given user is allowed to see (hidden libraries, age
/// restrictions) - i.e. the same visibility rules `fetch_all_characters` applies.
///
/// Returns a HashMap with lowercase name as key and original casing as value.
///
/// Note: unlike `fetch_all_characters`, this selects distinct `writers` CSV values
/// rather than whole media rows. There is no per-author book count to tally here, so
/// collapsing rows that share an identical CSV value in SQL is both correct and much
/// cheaper than materialising every visible book.
async fn fetch_all_authors(
	conn: &DatabaseConnection,
	library_id: Option<String>,
	auth_user: &AuthUser,
) -> Result<HashMap<String, String>> {
	let mut query = media::Entity::find_for_user(auth_user)
		.select_only()
		.column(media_metadata::Column::Writers)
		.distinct()
		.filter(media_metadata::Column::Writers.is_not_null());

	if let Some(lib_id) = library_id {
		query = query.filter(
			media::Column::SeriesId.in_subquery(series_in_library_subquery(lib_id)),
		);
	}

	let writers: Vec<String> = query.into_tuple().all(conn).await?;

	// Deduplicate with case-insensitive key, preserving first-seen casing
	let mut unique_authors: HashMap<String, String> = HashMap::new();
	for writer_str in writers {
		for name in parse_comma_separated_list(&writer_str) {
			let key = name.to_lowercase();
			unique_authors.entry(key).or_insert(name);
		}
	}

	Ok(unique_authors)
}

/// A capped preview of authors matching `query`, for the unified search fan-out.
/// Mirrors [`crate::query::character::search_characters`] -- same AND-across-terms
/// rule, same "return the total so the caller can offer to show the rest" shape.
pub(crate) async fn search_authors(
	conn: &DatabaseConnection,
	auth_user: &AuthUser,
	query: &str,
	limit: usize,
) -> Result<(Vec<Author>, u64)> {
	let all_authors = fetch_all_authors(conn, None, auth_user).await?;

	let mut matches = all_authors
		.into_iter()
		.filter(|(key, _)| matches_all_terms(key, query))
		.map(|(_, name)| name)
		.collect::<Vec<_>>();
	matches.sort_by_key(|name| name.to_lowercase());

	let total_count = matches.len() as u64;
	let nodes = matches
		.into_iter()
		.take(limit)
		.map(|name| Author {
			name,
			role: None,
			library_id: None,
		})
		.collect();

	Ok((nodes, total_count))
}

#[derive(Default)]
pub struct AuthorQuery;

#[Object]
impl AuthorQuery {
	/// Get a single author by name (case-insensitive exact match)
	async fn author_by_name(
		&self,
		ctx: &Context<'_>,
		name: String,
		#[graphql(desc = "Optional library ID to scope the author search")]
		library_id: Option<String>,
	) -> Result<Option<Author>> {
		let AuthContext { user, .. } = ctx.data::<AuthContext>()?;
		let conn = ctx.data::<CoreContext>()?.conn.as_ref();

		let authors = fetch_all_authors(conn, library_id.clone(), user).await?;
		let search_key = name.to_lowercase();

		Ok(authors.get(&search_key).map(|original_name| Author {
			name: original_name.clone(),
			role: None,
			library_id,
		}))
	}

	/// Get a paginated list of authors with optional search filter
	async fn authors(
		&self,
		ctx: &Context<'_>,
		#[graphql(desc = "Case-insensitive substring search filter")] search: Option<
			String,
		>,
		#[graphql(desc = "Optional library ID to scope the author search")]
		library_id: Option<String>,
		#[graphql(default, validator(custom = "PaginationValidator"))]
		pagination: Pagination,
	) -> Result<PaginatedResponse<Author>> {
		let AuthContext { user, .. } = ctx.data::<AuthContext>()?;
		let conn = ctx.data::<CoreContext>()?.conn.as_ref();

		let all_authors = fetch_all_authors(conn, library_id.clone(), user).await?;

		let filtered: Vec<String> = if let Some(ref search_term) = search {
			let search_lower = search_term.to_lowercase();
			all_authors
				.into_iter()
				.filter(|(key, _)| key.contains(&search_lower))
				.map(|(_, name)| name)
				.collect()
		} else {
			all_authors.into_values().collect()
		};

		let mut sorted: Vec<String> = filtered;
		sorted.sort_by_key(|a| a.to_lowercase());

		let total_count = sorted.len() as u64;

		// TODO: Pagination with large datasets NOT bound strictly to db records is a bit tricky and honestly not overly efficient
		match pagination.resolve() {
			Pagination::Cursor(_) => {
				// Cursor pagination doesn't make sense for in-memory data without stable IDs
				Err("Cursor pagination is not supported for authors".into())
			},
			Pagination::Offset(info) => {
				let offset = info.offset() as usize;
				let limit = info.limit() as usize;

				let paginated: Vec<Author> = sorted
					.into_iter()
					.skip(offset)
					.take(limit)
					.map(|name| Author {
						name,
						role: None,
						library_id: library_id.clone(),
					})
					.collect();

				Ok(PaginatedResponse {
					nodes: paginated,
					page_info: OffsetPaginationInfo::new(info, total_count).into(),
				})
			},
			Pagination::None(_) => {
				let authors: Vec<Author> = sorted
					.into_iter()
					.map(|name| Author {
						name,
						role: None,
						library_id: library_id.clone(),
					})
					.collect();

				Ok(PaginatedResponse {
					nodes: authors,
					page_info: OffsetPaginationInfo::unpaged(total_count).into(),
				})
			},
		}
	}

	/// Get a single author series by name (case-insensitive exact match)
	async fn author_series_by_name(
		&self,
		ctx: &Context<'_>,
		name: String,
		#[graphql(desc = "Optional library ID to scope the series search")]
		library_id: Option<String>,
	) -> Result<Option<AuthorSeries>> {
		let AuthContext { user, .. } = ctx.data::<AuthContext>()?;
		let conn = ctx.data::<CoreContext>()?.conn.as_ref();

		let mut query = media::Entity::find_for_user(user)
			.select_only()
			.column(media_metadata::Column::Series)
			.distinct()
			.filter(media_metadata::Column::Series.is_not_null());

		if let Some(ref lib_id) = library_id {
			query = query.filter(
				media::Column::SeriesId
					.in_subquery(series_in_library_subquery(lib_id.clone())),
			);
		}

		let series_names: Vec<String> = query.into_tuple().all(conn).await?;

		let search_lower = name.to_lowercase();
		let found = series_names
			.into_iter()
			.find(|s| s.to_lowercase() == search_lower);

		Ok(found.map(|title| AuthorSeries { title, library_id }))
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

	async fn insert_media_with_writers(
		db: &DatabaseConnection,
		series_id: &str,
		writers: &str,
	) {
		let media = fake_data::Media {
			series_id: series_id.to_string(),
			..Default::default()
		}
		.insert(db)
		.await;

		media_metadata::ActiveModel {
			media_id: sea_orm::Set(Some(media.id)),
			writers: sea_orm::Set(Some(writers.to_string())),
			..Default::default()
		}
		.insert(db)
		.await
		.expect("failed to insert media metadata");
	}

	#[tokio::test]
	async fn test_authors_exclude_hidden_library() {
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

		insert_media_with_writers(&db, &visible_series.id, "Grant Morrison").await;
		insert_media_with_writers(&db, &hidden_series.id, "Alan Moore").await;

		// The `library_exclusions` table has a real FK to `users`, so the user needs to
		// actually exist for the exclusion insert below to succeed.
		let user_model = fake_data::User::new("author-user-1").insert(&db).await;
		let user = auth_user(&user_model.id);

		library_exclusion::ActiveModel {
			user_id: sea_orm::Set(user.id.clone()),
			library_id: sea_orm::Set(hidden_library.id.clone()),
			..Default::default()
		}
		.insert(&db)
		.await
		.expect("failed to insert library exclusion");

		let authors = fetch_all_authors(&db, None, &user)
			.await
			.expect("fetch_all_authors failed");

		assert!(authors.contains_key("grant morrison"));
		// Before this was scoped by `find_for_user`, the writer on a book in a
		// library hidden from this user leaked out of the authors list.
		assert!(!authors.contains_key("alan moore"));
	}

	#[tokio::test]
	async fn test_authors_exclude_books_over_age_restriction() {
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
			writers: sea_orm::Set(Some("Raina Telgemeier".to_string())),
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
			writers: sea_orm::Set(Some("Garth Ennis".to_string())),
			age_rating: sea_orm::Set(Some(18)),
			..Default::default()
		}
		.insert(&db)
		.await
		.expect("failed to insert media metadata");

		let mut user = auth_user("author-user-2");
		user.age_restriction = Some(models::entity::age_restriction::Model {
			id: 1,
			age: 13,
			restrict_on_unset: true,
			user_id: user.id.clone(),
		});

		let authors = fetch_all_authors(&db, None, &user)
			.await
			.expect("fetch_all_authors failed");

		assert!(authors.contains_key("raina telgemeier"));
		// The writer of a book rated above this user's age restriction must not
		// be discoverable through the authors list either.
		assert!(!authors.contains_key("garth ennis"));
	}

	/// `search_all` claims its author group is scoped like every other branch.
	/// It inherits that from `fetch_all_authors`, so prove it rather than assume it.
	#[tokio::test]
	async fn test_search_authors_excludes_hidden_library_and_caps_results() {
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

		insert_media_with_writers(&db, &visible_series.id, "Grant Morrison").await;
		insert_media_with_writers(&db, &visible_series.id, "Grant Ellis").await;
		insert_media_with_writers(&db, &visible_series.id, "Grant Wood").await;
		insert_media_with_writers(&db, &hidden_series.id, "Grant Hidden").await;

		let user_model = fake_data::User::new("search-user").insert(&db).await;
		let user = auth_user(&user_model.id);

		library_exclusion::ActiveModel {
			user_id: sea_orm::Set(user.id.clone()),
			library_id: sea_orm::Set(hidden_library.id.clone()),
			..Default::default()
		}
		.insert(&db)
		.await
		.expect("failed to insert library exclusion");

		let (nodes, total_count) = search_authors(&db, &user, "grant", 2)
			.await
			.expect("search_authors failed");

		// Three visible matches, not four - the hidden library's writer is excluded
		// from the count as well as the page.
		assert_eq!(total_count, 3);
		assert_eq!(nodes.len(), 2, "the page is capped at the requested limit");
		assert!(nodes.iter().all(|author| author.name != "Grant Hidden"));
	}

	/// Multi-term queries behave the same here as they do in SQL.
	#[tokio::test]
	async fn test_search_authors_ands_terms() {
		let db = test_database().await;

		let library = fake_data::Library::default().insert(&db).await;
		let series = fake_data::Series {
			library_id: Some(library.id.clone()),
			..Default::default()
		}
		.insert(&db)
		.await;

		insert_media_with_writers(&db, &series.id, "Grant Morrison, Grant Ellis").await;

		let user = auth_user("search-user-2");
		let (nodes, total_count) = search_authors(&db, &user, "grant morrison", 10)
			.await
			.expect("search_authors failed");

		assert_eq!(total_count, 1);
		assert_eq!(
			nodes.first().map(|author| author.name.as_str()),
			Some("Grant Morrison")
		);
	}

	#[tokio::test]
	async fn test_authors_preserve_first_seen_casing() {
		let db = test_database().await;

		let library = fake_data::Library::default().insert(&db).await;
		let series = fake_data::Series {
			library_id: Some(library.id.clone()),
			..Default::default()
		}
		.insert(&db)
		.await;

		insert_media_with_writers(&db, &series.id, "Brian K. Vaughan, Fiona Staples")
			.await;

		let user = auth_user("author-user-3");
		let authors = fetch_all_authors(&db, None, &user)
			.await
			.expect("fetch_all_authors failed");

		assert_eq!(
			authors.get("brian k. vaughan").map(String::as_str),
			Some("Brian K. Vaughan")
		);
		assert_eq!(
			authors.get("fiona staples").map(String::as_str),
			Some("Fiona Staples")
		);
	}
}
