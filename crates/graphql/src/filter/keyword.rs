//! Shared keyword-search primitives.
//!
//! A free-text search string arrives as one opaque blob (`"batman year one"`)
//! and has to become a `Condition`. The policy is AND across terms, OR across
//! fields: every term must match *something*, but different terms may match
//! different columns. That is what lets a book whose metadata title is
//! `"Year One"` and whose characters field contains `"Batman"` match a query
//! neither column contains in full.
//!
//! Per-entity field lists live next to each `IntoFilter` impl (see
//! [`super::media`], [`super::series`], [`super::library`]) so they can reuse
//! the subquery helpers already defined there. This module owns only the
//! term-splitting and LIKE-pattern policy.

use sea_orm::{sea_query::LikeExpr, Condition};

/// Upper bound on terms honoured from a single query string.
///
/// Each term expands to one OR-group of `LIKE`s across every searched column,
/// so cost is `terms × fields`. Without a ceiling, a pathological query is an
/// easy way to make the database do a great deal of work for one request.
pub const MAX_TERMS: usize = 8;

/// The escape character paired with every generated `LIKE` pattern.
///
/// SQLite has no default escape character - `ESCAPE` must be stated explicitly
/// for a backslash in a pattern to mean anything - so this constant and
/// [`escape_like_fragment`] have to stay in agreement.
const LIKE_ESCAPE_CHAR: char = '\\';

/// Splits a raw search string into the terms that will be AND-ed together.
///
/// Whitespace-delimited, capped at [`MAX_TERMS`]. `split_whitespace` collapses
/// runs of whitespace and yields no empty items, so no separate filter is
/// needed.
///
/// Quoted phrases (`"year one" batman`) are deliberately not supported yet: the
/// tokeniser would need a fallback for unbalanced quotes, and every term here
/// is already a substring match, so a phrase mostly matters for *ordering* -
/// which LIKE-based search does not do at all.
fn split_terms(raw: &str) -> Vec<&str> {
	raw.split_whitespace().take(MAX_TERMS).collect()
}

/// ANDs together a per-term condition produced by `term_condition`.
///
/// Returns `None` for an empty or whitespace-only query so callers can thread
/// it straight through `QuerySelect::apply_if` and treat "no search" as a
/// no-op filter rather than an error - matching how `libraries(search:)`
/// already behaves.
pub fn multi_term_condition(
	raw: &str,
	term_condition: impl Fn(&str) -> Condition,
) -> Option<Condition> {
	let terms = split_terms(raw);
	if terms.is_empty() {
		return None;
	}

	Some(
		terms
			.into_iter()
			.fold(Condition::all(), |acc, term| acc.add(term_condition(term))),
	)
}

/// The in-memory counterpart of [`multi_term_condition`], for the entities that
/// are tallied in Rust rather than queried: characters and authors both build a
/// `HashMap` from CSV metadata columns and have no row to filter in SQL.
///
/// `haystack` is expected to already be lowercased, matching how those tallies
/// key themselves. Terms are AND-ed, so the same query behaves the same way
/// whether it ends up in a `WHERE` clause or a `.filter()`.
pub fn matches_all_terms(haystack: &str, raw_query: &str) -> bool {
	let terms = split_terms(raw_query);
	if terms.is_empty() {
		return true;
	}

	terms
		.iter()
		.all(|term| haystack.contains(&term.to_lowercase()))
}

/// Escapes the LIKE metacharacters `%` and `_`, plus the escape character
/// itself, so a user-supplied fragment is matched literally.
///
/// Without this, sea-orm's `contains`/`starts_with`/`ends_with` build
/// `format!("%{}%", value)` and hand the result straight to SQLite: a search for
/// `50%` becomes the pattern `%50%%`, which collapses to `%50%` and matches
/// `"500 Page Special"`.
pub fn escape_like_fragment(input: &str) -> String {
	let mut escaped = String::with_capacity(input.len());
	for ch in input.chars() {
		if ch == LIKE_ESCAPE_CHAR || ch == '%' || ch == '_' {
			escaped.push(LIKE_ESCAPE_CHAR);
		}
		escaped.push(ch);
	}
	escaped
}

/// `%value%`, with `value` escaped to be matched literally.
pub(crate) fn like_contains(value: &str) -> LikeExpr {
	LikeExpr::new(format!("%{}%", escape_like_fragment(value))).escape(LIKE_ESCAPE_CHAR)
}

/// `value%`, with `value` escaped to be matched literally.
pub(crate) fn like_starts_with(value: &str) -> LikeExpr {
	LikeExpr::new(format!("{}%", escape_like_fragment(value))).escape(LIKE_ESCAPE_CHAR)
}

/// `%value`, with `value` escaped to be matched literally.
pub(crate) fn like_ends_with(value: &str) -> LikeExpr {
	LikeExpr::new(format!("%{}", escape_like_fragment(value))).escape(LIKE_ESCAPE_CHAR)
}

#[cfg(test)]
mod tests {
	use super::*;
	use pretty_assertions::assert_eq;

	#[test]
	fn test_escapes_like_metacharacters() {
		assert_eq!(escape_like_fragment("50%"), r"50\%");
		assert_eq!(escape_like_fragment("file_name"), r"file\_name");
		assert_eq!(escape_like_fragment(r"back\slash"), r"back\\slash");
		assert_eq!(escape_like_fragment("plain"), "plain");
	}

	#[test]
	fn test_split_terms_collapses_whitespace_and_caps() {
		assert_eq!(
			split_terms("batman year one"),
			vec!["batman", "year", "one"]
		);
		assert_eq!(split_terms("  spaced   out \t"), vec!["spaced", "out"]);
		assert!(split_terms("   ").is_empty());
		assert_eq!(split_terms("a b c d e f g h i j").len(), MAX_TERMS);
	}

	#[test]
	fn test_matches_all_terms_ands_the_query() {
		// Same rule the SQL path applies, so a query means one thing regardless of
		// which entity answers it.
		assert!(matches_all_terms("grant morrison", "grant morrison"));
		assert!(matches_all_terms("grant morrison", "morrison grant"));
		assert!(matches_all_terms("grant morrison", "gra rison"));
		assert!(!matches_all_terms("grant morrison", "grant ellis"));
		// Callers lowercase their keys; the query is lowercased for them.
		assert!(matches_all_terms("grant morrison", "GRANT"));
		// A blank query filters nothing out rather than excluding everything.
		assert!(matches_all_terms("grant morrison", "   "));
	}

	#[test]
	fn test_multi_term_condition_is_none_for_blank_queries() {
		let build = |_: &str| Condition::all();
		assert!(multi_term_condition("", build).is_none());
		assert!(multi_term_condition("   \t ", build).is_none());
		assert!(multi_term_condition("batman", build).is_some());
	}

	#[test]
	fn test_multi_term_condition_ands_every_term() {
		use models::entity::media;
		use sea_orm::{prelude::*, sea_query::SqliteQueryBuilder, QueryTrait};

		let condition = multi_term_condition("batman year", |term| {
			Condition::any().add(media::Column::Name.like(like_contains(term)))
		})
		.expect("expected a condition");

		let sql = media::Entity::find()
			.filter(condition)
			.into_query()
			.to_string(SqliteQueryBuilder);

		// Each term gets its own OR-group, and the groups are AND-ed: a book
		// matching only "batman" must not come back for "batman year".
		assert!(sql.contains(r#""media"."name" LIKE '%batman%' ESCAPE '\'"#));
		assert!(sql.contains(r#""media"."name" LIKE '%year%' ESCAPE '\'"#));
		assert!(sql.contains("AND"));
	}
}
