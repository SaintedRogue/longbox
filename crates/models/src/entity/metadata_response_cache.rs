use sea_orm::{prelude::*, DeriveEntityModel};

/// A cached metadata-provider HTTP response. Rows are keyed by the SHA-256 of the
/// normalized request URL and classified as `detail` or `list`; freshness is decided
/// at read time from the row's age, so there is deliberately no expiry column.
#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
#[sea_orm(table_name = "metadata_response_cache")]
pub struct Model {
	#[sea_orm(primary_key, auto_increment = true)]
	pub id: i32,
	pub provider: String,
	pub cache_key: String,
	pub kind: String,
	pub body: String,
	#[sea_orm(column_type = "custom(\"DATETIME\")")]
	pub created_at: DateTimeWithTimeZone,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
