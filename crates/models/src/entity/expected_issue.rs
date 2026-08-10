use async_graphql::SimpleObject;
use sea_orm::{prelude::*, DeriveEntityModel};

/// A skeleton row for an issue a metadata provider says exists (or is
/// upcoming) in one of our series — the release calendar's data. Deliberately
/// NOT a media row: "in library" is computed at query time by issue-number
/// matching against the series' media, so nothing downstream ever confuses an
/// expectation with a file.
#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq, SimpleObject)]
#[graphql(name = "ExpectedIssueModel")]
#[sea_orm(table_name = "expected_issues")]
pub struct Model {
	#[sea_orm(primary_key, auto_increment = true)]
	pub id: i32,
	pub series_id: String,
	/// Provider id string ("comicvine" | "metron") that supplied this row.
	pub provider: String,
	/// The provider's issue id — unique per (series, provider).
	pub external_id: String,
	pub number: Option<String>,
	pub title: Option<String>,
	pub cover_url: Option<String>,
	/// ISO `YYYY-MM-DD`; NULL when the provider hasn't dated the issue yet.
	pub release_date: Option<String>,
	#[sea_orm(column_type = "custom(\"DATETIME\")")]
	pub created_at: DateTimeWithTimeZone,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
	#[sea_orm(
		belongs_to = "super::series::Entity",
		from = "Column::SeriesId",
		to = "super::series::Column::Id"
	)]
	Series,
}

impl Related<super::series::Entity> for Entity {
	fn to() -> RelationDef {
		Relation::Series.def()
	}
}

impl ActiveModelBehavior for ActiveModel {}
