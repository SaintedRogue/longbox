use std::{collections::HashMap, sync::Arc};

use async_graphql::dataloader::Loader;
use models::entity::{library, series};
use sea_orm::{prelude::*, sea_query::Expr, DatabaseConnection, QuerySelect};

/// Resolves whether a given series is its library's loose-file bucket — the row the
/// scanner creates at the library root when books sit loose in it (a library at
/// `/data` grows a series named `data`).
///
/// The check is structural: a bucket's path equals its own library's path. At most one
/// such row exists per library, so this batches to a single small query.
pub struct LooseRootLoader {
	conn: Arc<DatabaseConnection>,
}

impl LooseRootLoader {
	pub fn new(conn: Arc<DatabaseConnection>) -> Self {
		Self { conn }
	}
}

/// The series ID being tested.
pub type LooseRootLoaderKey = String;

impl Loader<LooseRootLoaderKey> for LooseRootLoader {
	type Value = bool;
	type Error = Arc<sea_orm::error::DbErr>;

	async fn load(
		&self,
		keys: &[LooseRootLoaderKey],
	) -> Result<HashMap<LooseRootLoaderKey, Self::Value>, Self::Error> {
		let loose_root_ids = series::Entity::find()
			.filter(series::Column::Id.is_in(keys.to_vec()))
			.inner_join(library::Entity)
			.filter(
				Expr::col((series::Entity, series::Column::Path))
					.equals((library::Entity, library::Column::Path)),
			)
			.select_only()
			.column(series::Column::Id)
			.into_tuple::<String>()
			.all(self.conn.as_ref())
			.await?;

		// Only positives are inserted; callers treat a missing key as `false`, matching
		// the idiom used by `FavoritesLoader`.
		Ok(loose_root_ids.into_iter().map(|id| (id, true)).collect())
	}
}
