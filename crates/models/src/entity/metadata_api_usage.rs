use sea_orm::{prelude::*, DeriveEntityModel};

/// One real (non-cached) metadata-provider API call, for rolling-window budget
/// accounting. `called_at` is epoch milliseconds; writes prune rows older than the
/// provider's window, so the table stays bounded at roughly one window of traffic.
#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
#[sea_orm(table_name = "metadata_api_usage")]
pub struct Model {
	#[sea_orm(primary_key, auto_increment = true)]
	pub id: i32,
	pub provider: String,
	/// URL path with numeric segments folded to `{id}` — diagnostics only.
	pub endpoint_key: String,
	pub called_at: i64,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
