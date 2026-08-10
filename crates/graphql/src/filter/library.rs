use async_graphql::InputObject;
use models::entity::library;
use sea_orm::{prelude::*, Condition};
use serde::{Deserialize, Serialize};
use serde_with::skip_serializing_none;

use super::{
	apply_string_filter,
	keyword::{like_contains, multi_term_condition},
	IntoFilter, StringLikeFilter,
};

// TODO: Support filter by tags (requires join logic)

/// The columns one term of a bare keyword search fans out across for a library.
///
/// Unlike books and series, `path` *is* searched here. The reason the other two
/// exclude it does not apply: a library is its path, so a match returns the one
/// row that owns that directory rather than fanning out across everything that
/// merely inherits the prefix. This also preserves the behaviour the `libraries`
/// resolver already had.
fn library_keyword_term_condition(term: &str) -> Condition {
	Condition::any()
		.add(library::Column::Name.like(like_contains(term)))
		.add(library::Column::Path.like(like_contains(term)))
		.add(library::Column::Description.like(like_contains(term)))
}

/// Turns a free-text search string into a condition over libraries.
pub fn library_keyword_condition(search: Option<&str>) -> Option<Condition> {
	multi_term_condition(search?, library_keyword_term_condition)
}

#[skip_serializing_none]
#[derive(InputObject, Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryFilterInput {
	#[graphql(default)]
	pub id: Option<StringLikeFilter<String>>,
	#[graphql(default)]
	pub name: Option<StringLikeFilter<String>>,
	#[graphql(default)]
	pub path: Option<StringLikeFilter<String>>,

	#[graphql(name = "_and", default)]
	pub _and: Option<Vec<LibraryFilterInput>>,
	#[graphql(name = "_not", default)]
	pub _not: Option<Vec<LibraryFilterInput>>,
	#[graphql(name = "_or", default)]
	pub _or: Option<Vec<LibraryFilterInput>>,
}

impl IntoFilter for LibraryFilterInput {
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
				self.name
					.map(|f| apply_string_filter(library::Column::Name, f)),
			)
			.add_option(
				self.path
					.map(|f| apply_string_filter(library::Column::Path, f)),
			)
	}
}
