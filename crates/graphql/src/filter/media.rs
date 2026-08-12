use async_graphql::InputObject;
use longbox_core::omnibus;
use models::{
	entity::{media, media_metadata, media_tag, reading_session, series, tag},
	shared::enums::{FileStatus, ReadingStatus},
};
use sea_orm::{
	prelude::{DateTimeWithTimeZone, *},
	sea_query::{ConditionExpression, Expr, Query, SelectStatement},
	Condition,
};
use serde::{Deserialize, Serialize};
use serde_with::skip_serializing_none;

use super::{
	apply_numeric_filter, apply_string_filter,
	keyword::{like_contains, multi_term_condition},
	media_metadata::MediaMetadataFilterInput,
	series::SeriesFilterInput,
	ConceptualFilter, IntoFilter, NumericFilter, StringLikeFilter,
};

fn apply_reading_status_filter(
	value: ReadingStatus,
	not: bool,
) -> impl Into<ConditionExpression> {
	let newer_exists = reading_session::Entity::newer_session_exists_subquery();
	let latest_only = Expr::expr(Expr::exists(newer_exists)).not();

	let base_filter = match value {
		ReadingStatus::Reading => reading_session::Column::Id
			.is_not_null()
			.and(reading_session::Column::Status.eq(ReadingStatus::Reading))
			.and(latest_only.clone()),
		ReadingStatus::Finished => reading_session::Column::Id
			.is_not_null()
			.and(reading_session::Column::Status.eq(ReadingStatus::Finished))
			.and(latest_only.clone()),
		ReadingStatus::Abandoned => reading_session::Column::Id
			.is_not_null()
			.and(reading_session::Column::Status.eq(ReadingStatus::Abandoned))
			.and(latest_only),
		ReadingStatus::NotStarted => reading_session::Column::Id.is_null(),
	};

	if not {
		base_filter.not()
	} else {
		base_filter
	}
}

fn media_tag_name_subquery(filter: StringLikeFilter<String>) -> SelectStatement {
	let name_condition = apply_string_filter(tag::Column::Name, filter);
	let tag_id_subquery = Query::select()
		.column(tag::Column::Id)
		.from(tag::Entity)
		.cond_where(name_condition)
		.to_owned();

	// SELECT DISTINCT media_id FROM media_tags WHERE tag_id IN
	Query::select()
		.distinct()
		.column(media_tag::Column::MediaId)
		.from(media_tag::Entity)
		.and_where(Expr::col(media_tag::Column::TagId).in_subquery(tag_id_subquery))
		.to_owned()
}

/// The columns one term of a bare keyword search fans out across for a book.
///
/// Everything here except `tags` lives on `media` or `media_metadata`, both of
/// which `ModelWithMetadata::find_for_user` already joins, so widening this list
/// costs predicates rather than joins. Tags go through the existing
/// [`media_tag_name_subquery`] rather than a join, so a book carrying two
/// matching tags still comes back once.
///
/// Deliberately absent: `path` (an absolute path carries its library's mount
/// prefix, so matching it would return every book in a library called
/// `/mnt/comics` for the term "comics"), and the noisier credit fields -
/// `genres`, `colorists`, `teams` and friends stay reachable through the
/// explicit `filter` argument, where the user has asked for them by name.
fn media_keyword_term_condition(term: &str) -> Condition {
	let condition = Condition::any()
		.add(media::Column::Name.like(like_contains(term)))
		.add(media_metadata::Column::Title.like(like_contains(term)))
		.add(media_metadata::Column::Summary.like(like_contains(term)))
		.add(media_metadata::Column::Publisher.like(like_contains(term)))
		.add(media_metadata::Column::Series.like(like_contains(term)))
		.add(media_metadata::Column::Writers.like(like_contains(term)))
		.add(media_metadata::Column::Characters.like(like_contains(term)))
		.add(media_metadata::Column::StoryArc.like(like_contains(term)))
		.add(media::Column::Id.in_subquery(media_tag_name_subquery(
			StringLikeFilter::Contains(term.to_string()),
		)));

	// Issue numbers are matched by equality, never substring: the column is
	// numeric, and `LIKE '%1%'` would pull in #10, #11 and #21 for a search of
	// "1". A term that is not a number simply does not consider this field.
	match term.parse::<Decimal>() {
		Ok(number) => condition.add(media_metadata::Column::Number.eq(number)),
		Err(_) => condition,
	}
}

/// Turns a free-text search string into a condition over books.
///
/// `None` when there is nothing to search for, so callers can thread it through
/// `apply_if` and treat an absent or blank query as a no-op.
pub fn media_keyword_condition(search: Option<&str>) -> Option<Condition> {
	multi_term_condition(search?, media_keyword_term_condition)
}

#[skip_serializing_none]
#[derive(InputObject, Clone, Serialize, Deserialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct MediaFilterInput {
	#[graphql(default)]
	pub id: Option<StringLikeFilter<String>>,
	#[graphql(default)]
	pub name: Option<StringLikeFilter<String>>,
	#[graphql(default)]
	pub size: Option<NumericFilter<i64>>,
	#[graphql(default)]
	pub extension: Option<StringLikeFilter<String>>,
	#[graphql(default)]
	pub created_at: Option<NumericFilter<DateTimeWithTimeZone>>,
	#[graphql(default)]
	pub updated_at: Option<NumericFilter<DateTimeWithTimeZone>>,
	#[graphql(default)]
	pub series_id: Option<StringLikeFilter<String>>,
	/// Restrict to books on a given virtual shelf.
	#[graphql(default)]
	pub book_group_id: Option<StringLikeFilter<String>>,
	/// `true` keeps only books that stand alone — no virtual shelf, and a series that is
	/// really the library's loose-file bucket. `false` inverts it.
	#[graphql(default)]
	pub is_standalone: Option<bool>,
	/// `true` keeps only omnibuses — books whose name, metadata title, metadata format, or
	/// series name says so. `false` inverts it.
	#[graphql(default)]
	pub is_omnibus: Option<bool>,
	#[graphql(default)]
	pub status: Option<StringLikeFilter<FileStatus>>,
	#[graphql(default)]
	pub path: Option<StringLikeFilter<String>>,
	#[graphql(default)]
	pub pages: Option<NumericFilter<i32>>,

	#[graphql(default)]
	pub reading_status: Option<ConceptualFilter<ReadingStatus>>,

	#[graphql(default)]
	pub metadata: Option<MediaMetadataFilterInput>,
	#[graphql(default)]
	pub series: Option<SeriesFilterInput>,

	#[graphql(default)]
	pub tags: Option<StringLikeFilter<String>>,
	#[graphql(name = "_and", default)]
	pub _and: Option<Vec<MediaFilterInput>>,
	#[graphql(name = "_not", default)]
	pub _not: Option<Vec<MediaFilterInput>>,
	#[graphql(name = "_or", default)]
	pub _or: Option<Vec<MediaFilterInput>>,
}

impl IntoFilter for MediaFilterInput {
	fn into_filter(self) -> sea_orm::Condition {
		sea_orm::Condition::all()
			.add_option(self._and.map(|f| {
				let mut and_condition = sea_orm::Condition::all();
				for filter in f {
					and_condition = and_condition.add(filter.into_filter());
				}
				and_condition
			}))
			.add_option(self._not.map(|f| {
				let mut not_condition = sea_orm::Condition::any();
				for filter in f {
					not_condition = not_condition.add(filter.into_filter());
				}
				not_condition.not()
			}))
			.add_option(self._or.map(|f| {
				let mut or_condition = sea_orm::Condition::any();
				for filter in f {
					or_condition = or_condition.add(filter.into_filter());
				}
				or_condition
			}))
			.add_option(
				self.book_group_id
					.map(|f| apply_string_filter(media::Column::BookGroupId, f)),
			)
			.add_option(self.is_standalone.map(|standalone| {
				// Standalone is derived, never stored: no shelf, and a series that is the
				// library's own loose-file bucket rather than one anyone created.
				let condition = sea_orm::Condition::all()
					.add(media::Column::BookGroupId.is_null())
					.add(
						media::Column::SeriesId
							.in_subquery(series::Entity::loose_root_ids_subquery()),
					);

				if standalone {
					condition
				} else {
					condition.not()
				}
			}))
			.add_option(self.is_omnibus.map(|omnibus| {
				// Like `is_standalone`, derived rather than stored. The rule lives in
				// `core` so the scan pipeline could reuse it.
				let condition = omnibus::qualifying_condition();

				if omnibus {
					condition
				} else {
					condition.not()
				}
			}))
			.add_option(self.id.map(|f| apply_string_filter(media::Column::Id, f)))
			.add_option(
				self.name
					.map(|f| apply_string_filter(media::Column::Name, f)),
			)
			.add_option(
				self.size
					.map(|f| apply_numeric_filter(media::Column::Size, f)),
			)
			.add_option(
				self.extension
					.map(|f| apply_string_filter(media::Column::Extension, f)),
			)
			.add_option(
				self.created_at
					.map(|f| apply_numeric_filter(media::Column::CreatedAt, f)),
			)
			.add_option(
				self.updated_at
					.map(|f| apply_numeric_filter(media::Column::UpdatedAt, f)),
			)
			.add_option(
				self.series_id
					.map(|f| apply_string_filter(media::Column::SeriesId, f)),
			)
			.add_option(
				self.status
					.map(|f| apply_string_filter(media::Column::Status, f)),
			)
			.add_option(
				self.path
					.map(|f| apply_string_filter(media::Column::Path, f)),
			)
			.add_option(
				self.pages
					.map(|f| apply_numeric_filter(media::Column::Pages, f)),
			)
			.add_option(self.reading_status.map(|f| {
				match f {
					ConceptualFilter::Is(value) => {
						Condition::all().add(apply_reading_status_filter(value, false))
					},
					ConceptualFilter::IsNot(value) => {
						Condition::all().add(apply_reading_status_filter(value, true))
					},
					ConceptualFilter::IsAnyOf(values) => {
						values.into_iter().fold(Condition::any(), |cond, v| {
							cond.add(apply_reading_status_filter(v, false))
						})
					},
					ConceptualFilter::IsNoneOf(values) => values
						.into_iter()
						.fold(Condition::any(), |cond, v| {
							cond.add(apply_reading_status_filter(v, false))
						})
						.not(),
				}
			}))
			.add_option(self.tags.map(|f| {
				let subquery = media_tag_name_subquery(f);
				Condition::all().add(media::Column::Id.in_subquery(subquery))
			}))
			.add_option(self.metadata.map(|f| f.into_filter()))
			.add_option(self.series.map(|f| f.into_filter()))
	}
}

#[cfg(test)]
mod keyword_tests {
	use super::*;
	use ::tests::{db::test_database, fake_data};
	use models::entity::user::AuthUser;

	fn auth_user() -> AuthUser {
		AuthUser {
			id: "keyword-user".to_string(),
			username: "keyword-user".to_string(),
			is_server_owner: true,
			..Default::default()
		}
	}

	/// Inserts a book plus the metadata row the keyword search reads from.
	async fn insert_book(
		db: &DatabaseConnection,
		series_id: &str,
		name: &str,
		metadata: media_metadata::ActiveModel,
	) -> String {
		let media = fake_data::Media {
			series_id: series_id.to_string(),
			name: Some(name.to_string()),
			..Default::default()
		}
		.insert(db)
		.await;

		media_metadata::ActiveModel {
			media_id: sea_orm::Set(Some(media.id.clone())),
			..metadata
		}
		.insert(db)
		.await
		.expect("failed to insert media metadata");

		media.id
	}

	async fn search_names(db: &DatabaseConnection, query: &str) -> Vec<String> {
		let condition =
			media_keyword_condition(Some(query)).expect("expected a condition");

		let mut names = media::ModelWithMetadata::find_for_user(&auth_user())
			.filter(condition)
			.into_model::<media::ModelWithMetadata>()
			.all(db)
			.await
			.expect("keyword query failed")
			.into_iter()
			.map(|m| m.media.name)
			.collect::<Vec<_>>();
		names.sort();
		names
	}

	async fn seeded_series(db: &DatabaseConnection) -> String {
		let library = fake_data::Library::default().insert(db).await;
		fake_data::Series {
			library_id: Some(library.id.clone()),
			..Default::default()
		}
		.insert(db)
		.await
		.id
	}

	/// The reason multi-term search exists: no single column contains
	/// "batman year", but one book has "Batman" in its characters and "Year One"
	/// in its title. Single-phrase matching could never find it.
	#[tokio::test]
	async fn test_terms_may_match_different_fields() {
		let db = test_database().await;
		let series_id = seeded_series(&db).await;

		insert_book(
			&db,
			&series_id,
			"book-a",
			media_metadata::ActiveModel {
				title: sea_orm::Set(Some("Year One".to_string())),
				characters: sea_orm::Set(Some("Batman, Jim Gordon".to_string())),
				..Default::default()
			},
		)
		.await;

		// Matches "batman" only - must not satisfy a two-term query.
		insert_book(
			&db,
			&series_id,
			"book-b",
			media_metadata::ActiveModel {
				title: sea_orm::Set(Some("The Killing Joke".to_string())),
				characters: sea_orm::Set(Some("Batman".to_string())),
				..Default::default()
			},
		)
		.await;

		assert_eq!(search_names(&db, "batman year").await, vec!["book-a"]);
		assert_eq!(
			search_names(&db, "batman").await,
			vec!["book-a", "book-b"],
			"a single term should still match both books"
		);
	}

	/// Fields that were previously unreachable from the search box entirely.
	#[tokio::test]
	async fn test_widened_fields_are_searchable() {
		let db = test_database().await;
		let series_id = seeded_series(&db).await;

		insert_book(
			&db,
			&series_id,
			"publisher-book",
			media_metadata::ActiveModel {
				publisher: sea_orm::Set(Some("Dark Horse".to_string())),
				..Default::default()
			},
		)
		.await;
		insert_book(
			&db,
			&series_id,
			"arc-book",
			media_metadata::ActiveModel {
				story_arc: sea_orm::Set(Some("Knightfall".to_string())),
				..Default::default()
			},
		)
		.await;
		insert_book(
			&db,
			&series_id,
			"writer-book",
			media_metadata::ActiveModel {
				writers: sea_orm::Set(Some("Grant Morrison".to_string())),
				..Default::default()
			},
		)
		.await;

		assert_eq!(
			search_names(&db, "dark horse").await,
			vec!["publisher-book"]
		);
		assert_eq!(search_names(&db, "knightfall").await, vec!["arc-book"]);
		assert_eq!(search_names(&db, "morrison").await, vec!["writer-book"]);
	}

	/// Issue numbers match by equality. Substring matching a numeric column
	/// would make a search for "1" return #10, #11 and #21.
	#[tokio::test]
	async fn test_issue_number_matches_exactly_not_by_substring() {
		let db = test_database().await;
		let series_id = seeded_series(&db).await;

		// Names deliberately carry no digits, so the only thing a numeric term can
		// match here is the issue number itself.
		insert_book(
			&db,
			&series_id,
			"alpha",
			media_metadata::ActiveModel {
				number: sea_orm::Set(Some(Decimal::from(1))),
				..Default::default()
			},
		)
		.await;
		insert_book(
			&db,
			&series_id,
			"beta",
			media_metadata::ActiveModel {
				number: sea_orm::Set(Some(Decimal::from(10))),
				..Default::default()
			},
		)
		.await;

		assert_eq!(search_names(&db, "1").await, vec!["alpha"]);
		assert_eq!(search_names(&db, "10").await, vec!["beta"]);
	}

	/// End-to-end proof of the escaping fix through the keyword path.
	#[tokio::test]
	async fn test_wildcards_in_a_query_are_matched_literally() {
		let db = test_database().await;
		let series_id = seeded_series(&db).await;

		insert_book(
			&db,
			&series_id,
			"50% Off",
			media_metadata::ActiveModel {
				..Default::default()
			},
		)
		.await;
		insert_book(
			&db,
			&series_id,
			"500 Page Special",
			media_metadata::ActiveModel {
				..Default::default()
			},
		)
		.await;

		// Unescaped, the pattern `%50%%` collapses to `%50%` and matches both.
		assert_eq!(search_names(&db, "50%").await, vec!["50% Off"]);
	}
}

// TODO: test properly with actual queries and assert on returned recs
// #[cfg(test)]
// mod tests {
// 	use super::*;
// 	use models::entity::media;
// 	use pretty_assertions::assert_eq;
// 	use sea_orm::{sea_query::SqliteQueryBuilder, Condition, QuerySelect, QueryTrait};

// 	#[test]
// 	fn test_reading_status() {
// 		let condition = apply_reading_status_filter(ReadingStatus::Reading, false);
// 		let query = media::Entity::find().filter(Condition::all().add(condition));
// 		let sql = query
// 			.select_only()
// 			.into_query()
// 			.to_string(SqliteQueryBuilder);

// 		assert_eq!(
// 			sql,
// 			r#"SELECT  FROM "media" WHERE "reading_sessions"."id" IS NOT NULL"#
// 		);
// 	}

// 	#[test]
// 	fn test_reading_status_in() {
// 		let filter = MediaFilterInput {
// 			id: None,
// 			_and: None,
// 			created_at: None,
// 			extension: None,
// 			metadata: None,
// 			name: None,
// 			_not: None,
// 			_or: None,
// 			pages: None,
// 			path: None,
// 			reading_status: Some(ConceptualFilter::IsAnyOf(vec![
// 				ReadingStatus::Reading,
// 				ReadingStatus::Finished,
// 			])),
// 			series_id: None,
// 			series: None,
// 			size: None,
// 			status: None,
// 			updated_at: None,
// 		};
// 		let query = media::Entity::find().filter(filter.into_filter());
// 		let sql = query
// 			.select_only()
// 			.into_query()
// 			.to_string(SqliteQueryBuilder);

// 		assert_eq!(
// 			sql,
// 			r#"SELECT  FROM "media" WHERE "reading_sessions"."id" IS NOT NULL OR "finished_reading_sessions"."id" IS NOT NULL"#
// 		);
// 	}

// 	#[test]
// 	fn test_reading_status_not_in() {
// 		let filter = MediaFilterInput {
// 			id: None,
// 			_and: None,
// 			created_at: None,
// 			extension: None,
// 			metadata: None,
// 			name: None,
// 			_not: None,
// 			_or: None,
// 			pages: None,
// 			path: None,
// 			reading_status: Some(ConceptualFilter::IsNoneOf(vec![
// 				ReadingStatus::Reading,
// 				ReadingStatus::Finished,
// 			])),
// 			series_id: None,
// 			series: None,
// 			size: None,
// 			status: None,
// 			updated_at: None,
// 		};
// 		let query = media::Entity::find().filter(filter.into_filter());
// 		let sql = query
// 			.select_only()
// 			.into_query()
// 			.to_string(SqliteQueryBuilder);

// 		assert_eq!(
// 			sql,
// 			r#"SELECT  FROM "media" WHERE NOT ("reading_sessions"."id" IS NOT NULL OR "finished_reading_sessions"."id" IS NOT NULL)"#
// 		);
// 	}
// }

// #[cfg(test)]
// mod tests {
// 	use super::*;
// 	use models::entity::*;

// 	#[test]
// 	fn test_serialize_media_filter() {
// 		let filter = MediaFilterInput {
// 			name: Some(FieldFilter::Equals {
// 				eq: "test".to_string(),
// 			}),
// 			..Default::default()
// 		};

// 		let serialized = serde_json::to_string(&filter).unwrap();
// 		assert_eq!(serialized, r#"{"name":{"eq":"test"}}"#);
// 	}

// 	#[test]
// 	fn test_serialize_media_filter_with_metadata() {
// 		let filter = MediaFilterInput {
// 			name: Some(FieldFilter::Equals {
// 				eq: "test".to_string(),
// 			}),
// 			metadata: Some(MediaMetadataFilterInput {
// 				title: Some(FieldFilter::Equals {
// 					eq: "test".to_string(),
// 				}),
// 				series: Some(FieldFilter::Equals {
// 					eq: "theseries".to_string(),
// 				}),
// 				..Default::default()
// 			}),
// 			..Default::default()
// 		};

// 		let serialized = serde_json::to_string(&filter).unwrap();
// 		assert_eq!(
// 			serialized,
// 			r#"{"name":{"eq":"test"},"metadata":{"title":{"eq":"test"},"series":{"eq":"theseries"}}}"#
// 		);
// 	}

// 	#[test]
// 	fn test_serialize_media_filter_with_and() {
// 		let filter = MediaFilterInput {
// 			_and: Some(vec![
// 				MediaFilterInput {
// 					name: Some(FieldFilter::Equals {
// 						eq: "test".to_string(),
// 					}),
// 					..Default::default()
// 				},
// 				MediaFilterInput {
// 					name: Some(FieldFilter::Equals {
// 						eq: "test2".to_string(),
// 					}),
// 					..Default::default()
// 				},
// 			]),
// 			..Default::default()
// 		};

// 		let serialized = serde_json::to_string(&filter).unwrap();
// 		assert_eq!(
// 			serialized,
// 			r#"{"_and":[{"name":{"eq":"test"}},{"name":{"eq":"test2"}}]}"#
// 		);
// 	}

// 	#[test]
// 	fn test_serialize_media_filter_with_metadata_with_ands() {
// 		let filter = MediaFilterInput {
// 			name: Some(FieldFilter::Equals {
// 				eq: "test".to_string(),
// 			}),
// 			metadata: Some(MediaMetadataFilterInput {
// 				_and: Some(vec![
// 					MediaMetadataFilterInput {
// 						title: Some(FieldFilter::Equals {
// 							eq: "test".to_string(),
// 						}),
// 						..Default::default()
// 					},
// 					MediaMetadataFilterInput {
// 						series: Some(FieldFilter::Equals {
// 							eq: "theseries".to_string(),
// 						}),
// 						..Default::default()
// 					},
// 				]),
// 				..Default::default()
// 			}),
// 			..Default::default()
// 		};

// 		let serialized = serde_json::to_string(&filter).unwrap();
// 		assert_eq!(
// 			serialized,
// 			r#"{"name":{"eq":"test"},"metadata":{"_and":[{"title":{"eq":"test"}},{"series":{"eq":"theseries"}}]}}"#
// 		);
// 	}

// 	#[test]
// 	fn test_deserialize_grouped_media_filter() {
// 		let filter = r#"{"_and":[{"name":{"eq":"test"}},{"name":{"eq":"test2"}}]}"#;
// 		let deserialized: MediaFilterInput = serde_json::from_str(filter).unwrap();
// 		assert!(deserialized._and.is_some());
// 		assert_eq!(deserialized._and.unwrap().len(), 2);

// 		let filter = r#"{"_or":[{"name":{"eq":"test"}},{"name":{"eq":"test2"}}]}"#;
// 		let deserialized: MediaFilterInput = serde_json::from_str(filter).unwrap();
// 		assert!(deserialized._or.is_some());
// 		assert_eq!(deserialized._or.unwrap().len(), 2);

// 		let filter = r#"{"_not":[{"name":{"eq":"test"}},{"name":{"eq":"test2"}}]}"#;
// 		let deserialized: MediaFilterInput = serde_json::from_str(filter).unwrap();
// 		assert!(deserialized._not.is_some());
// 		assert_eq!(deserialized._not.unwrap().len(), 2);
// 	}

// 	#[test]
// 	fn test_deserialize_grouped_media_filter_with_meta() {
// 		let filter = r#"{"_and":[{"name":{"eq":"test"}},{"metadata":{"_and":[{"title":{"eq":"test"}},{"series":{"eq":"theseries"}}]}}]}"#;
// 		let deserialized: MediaFilterInput = serde_json::from_str(filter).unwrap();
// 		assert!(deserialized._and.is_some());
// 		let and_vec = deserialized._and.clone().unwrap();
// 		assert_eq!(and_vec.len(), 2);
// 		let second_input = and_vec.get(1).unwrap().clone();
// 		assert!(second_input.metadata.is_some());
// 		let metadata = second_input.metadata.unwrap();
// 		assert!(metadata._and.is_some());
// 		assert_eq!(metadata._and.unwrap().len(), 2);
// 	}

// 	#[test]
// 	fn test_basic_into_filter() {
// 		let condition = MediaFilterInput {
// 			name: Some(FieldFilter::Equals {
// 				eq: "test".to_string(),
// 			}),
// 			..Default::default()
// 		}
// 		.into_filter();
// 		assert_eq!(
// 			condition,
// 			sea_orm::Condition::all().add(media::Column::Name.eq("test"))
// 		);

// 		let condition = MediaFilterInput {
// 			name: Some(FieldFilter::Not {
// 				neq: "test".to_string(),
// 			}),
// 			..Default::default()
// 		}
// 		.into_filter();
// 		assert_eq!(
// 			condition,
// 			sea_orm::Condition::all().add(media::Column::Name.ne("test"))
// 		);

// 		let condition = MediaFilterInput {
// 			name: Some(FieldFilter::Any {
// 				any: vec!["test".to_string(), "test2".to_string()],
// 			}),
// 			..Default::default()
// 		}
// 		.into_filter();
// 		assert_eq!(
// 			condition,
// 			sea_orm::Condition::all()
// 				.add(media::Column::Name.is_in(vec!["test", "test2"]))
// 		);

// 		let condition = MediaFilterInput {
// 			name: Some(FieldFilter::None {
// 				none: vec!["test".to_string(), "test2".to_string()],
// 			}),
// 			..Default::default()
// 		}
// 		.into_filter();
// 		assert_eq!(
// 			condition,
// 			sea_orm::Condition::all()
// 				.add(media::Column::Name.is_not_in(vec!["test", "test2"]))
// 		);

// 		let condition = MediaFilterInput {
// 			name: Some(FieldFilter::StringFieldFilter(StringFilter::Like {
// 				like: "test".to_string(),
// 			})),
// 			..Default::default()
// 		}
// 		.into_filter();
// 		assert_eq!(
// 			condition,
// 			sea_orm::Condition::all()
// 				.add(media::Column::Name.like(format!("%{}%", "test")))
// 		);

// 		let condition = MediaFilterInput {
// 			name: Some(FieldFilter::StringFieldFilter(StringFilter::Contains {
// 				contains: "test".to_string(),
// 			})),
// 			..Default::default()
// 		}
// 		.into_filter();
// 		assert_eq!(
// 			condition,
// 			sea_orm::Condition::all().add(media::Column::Name.contains("test"))
// 		);

// 		let condition = MediaFilterInput {
// 			name: Some(FieldFilter::StringFieldFilter(StringFilter::Excludes {
// 				excludes: "test".to_string(),
// 			})),
// 			..Default::default()
// 		}
// 		.into_filter();
// 		assert_eq!(
// 			condition,
// 			sea_orm::Condition::all()
// 				.add(media::Column::Name.not_like(format!("%{}%", "test")))
// 		);
// 	}

// 	#[test]
// 	fn test_grouped_into_filter() {
// 		// _and
// 		let condition = MediaFilterInput {
// 			_and: Some(vec![
// 				MediaFilterInput {
// 					name: Some(FieldFilter::Equals {
// 						eq: "test".to_string(),
// 					}),
// 					..Default::default()
// 				},
// 				MediaFilterInput {
// 					name: Some(FieldFilter::Equals {
// 						eq: "test2".to_string(),
// 					}),
// 					..Default::default()
// 				},
// 			]),
// 			..Default::default()
// 		}
// 		.into_filter();
// 		assert_eq!(
// 			condition,
// 			sea_orm::Condition::all().add(
// 				sea_orm::Condition::all()
// 					.add(media::Column::Name.eq("test"))
// 					.add(media::Column::Name.eq("test2"))
// 			)
// 		);

// 		// _or
// 		let condition = MediaFilterInput {
// 			_or: Some(vec![
// 				MediaFilterInput {
// 					name: Some(FieldFilter::Equals {
// 						eq: "test".to_string(),
// 					}),
// 					..Default::default()
// 				},
// 				MediaFilterInput {
// 					name: Some(FieldFilter::Equals {
// 						eq: "test2".to_string(),
// 					}),
// 					..Default::default()
// 				},
// 			]),
// 			..Default::default()
// 		}
// 		.into_filter();
// 		assert_eq!(
// 			condition,
// 			sea_orm::Condition::all().add(
// 				sea_orm::Condition::any()
// 					.add(media::Column::Name.eq("test"))
// 					.add(media::Column::Name.eq("test2"))
// 			)
// 		);

// 		// _not
// 		let condition = MediaFilterInput {
// 			_not: Some(vec![
// 				MediaFilterInput {
// 					name: Some(FieldFilter::Equals {
// 						eq: "test".to_string(),
// 					}),
// 					..Default::default()
// 				},
// 				MediaFilterInput {
// 					name: Some(FieldFilter::Equals {
// 						eq: "test2".to_string(),
// 					}),
// 					..Default::default()
// 				},
// 			]),
// 			..Default::default()
// 		}
// 		.into_filter();
// 		assert_eq!(
// 			condition,
// 			sea_orm::Condition::all().add(
// 				sea_orm::Condition::any()
// 					.add(media::Column::Name.eq("test"))
// 					.add(media::Column::Name.eq("test2"))
// 					.not()
// 			)
// 		);
// 	}

// 	#[test]
// 	fn test_nested_into_filter() {
// 		let condition = MediaFilterInput {
// 			name: Some(FieldFilter::Equals {
// 				eq: "test".to_string(),
// 			}),
// 			metadata: Some(MediaMetadataFilterInput {
// 				title: Some(FieldFilter::Equals {
// 					eq: "test".to_string(),
// 				}),
// 				series: Some(FieldFilter::Equals {
// 					eq: "theseries".to_string(),
// 				}),
// 				..Default::default()
// 			}),
// 			..Default::default()
// 		}
// 		.into_filter();
// 		assert_eq!(
// 			condition,
// 			sea_orm::Condition::all()
// 				.add(media::Column::Name.eq("test"))
// 				.add(
// 					sea_orm::Condition::all()
// 						.add(media_metadata::Column::Title.eq("test"))
// 						.add(media_metadata::Column::Series.eq("theseries"))
// 				)
// 		);
// 	}
// }
