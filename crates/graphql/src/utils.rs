use models::entity::{series, user::AuthUser};
use sea_orm::{prelude::*, sea_query::Query};
use tower_sessions::Session;

pub async fn save_user_session(session: &Session, user: AuthUser) {
	if let Err(error) = session.insert("user", user).await {
		tracing::error!(?error, "Failed to save user session");
	}
}

/// Parses a comma-separated list (e.g. a CSV-style metadata field like `characters` or
/// `writers`) into individual, trimmed, non-empty entries.
///
/// This is basically the same as it has been for ages but it should go with another note
/// that this kind of parsing is super fragile. I wish metadata was WAY more standardized,
/// because "Last, First" will just break hard.
pub fn parse_comma_separated_list(value: &str) -> Vec<String> {
	value
		.split(',')
		.map(|s| s.trim().to_string())
		.filter(|s| !s.is_empty())
		.collect()
}

/// Helper to build a subquery for series IDs in a specific library
pub fn series_in_library_subquery(
	library_id: String,
) -> sea_orm::sea_query::SelectStatement {
	Query::select()
		.column(series::Column::Id)
		.from(series::Entity)
		.and_where(series::Column::LibraryId.eq(library_id))
		.to_owned()
}
