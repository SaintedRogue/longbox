use async_graphql::SimpleObject;
use sea_orm::{prelude::*, DeriveEntityModel};

/// A skeleton row for an issue a metadata provider says exists (or is upcoming) — the
/// release calendar's data. Deliberately NOT a media row: "in library" is computed at query
/// time by issue-number matching against the series' media, so nothing downstream ever
/// confuses an expectation with a file.
///
/// Rows are stored for every release a provider reports, whether or not it corresponds to
/// anything in this library; `series_id` is the enrichment that says it does.
#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq, SimpleObject)]
#[graphql(name = "ReleaseCalendarEntryModel")]
#[sea_orm(table_name = "release_calendar_entries")]
pub struct Model {
	#[sea_orm(primary_key, auto_increment = true)]
	pub id: i32,
	/// The library series this release belongs to, or `None` when nothing here
	/// corresponds to it — the ordinary case for most of what a provider reports.
	pub series_id: Option<String>,
	/// The provider's name for the series. What an unbound release is labelled with; once
	/// `series_id` is set the library's own name is preferred, since that is the name the
	/// user chose to file it under.
	pub series_name: Option<String>,
	/// The provider's id for the series, kept so a later sweep can bind this row once the
	/// series is matched, without re-fetching the window.
	pub series_external_id: Option<String>,
	/// Provider id string ("comicvine" | "metron") that supplied this row.
	pub provider: String,
	/// The provider's issue id — unique per provider, and the row's identity.
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
