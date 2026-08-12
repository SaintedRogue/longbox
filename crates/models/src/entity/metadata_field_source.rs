use async_graphql::SimpleObject;
use sea_orm::{entity::prelude::*, DeriveEntityModel};

/// One row per (entity, field): which source won that field.
///
/// This is what makes picking fields across providers legible after the fact — "where
/// did this page count come from?" — and auditable in aggregate: "what has LOCG actually
/// contributed to the library?" is a query rather than a scan of every book's JSON.
///
/// It records the *decision*, not the value. The value lives in `media_metadata` /
/// `series_metadata`, which stay the single resolved record and the only thing library
/// views read. A field chosen by the operator is additionally added to
/// `locked_fields` on that record, which is the mechanism that stops a later fetch
/// overwriting it — this table explains the choice, `locked_fields` enforces it.
#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq, SimpleObject)]
#[graphql(name = "MetadataFieldSourceModel")]
#[sea_orm(table_name = "metadata_field_source")]
pub struct Model {
	#[sea_orm(primary_key, auto_increment = true)]
	pub id: i32,
	/// Set for a book. Exactly one of this and `series_id` is non-null, enforced by a
	/// table CHECK.
	#[sea_orm(column_type = "Text", nullable)]
	pub media_id: Option<String>,
	/// Set for a series.
	#[sea_orm(column_type = "Text", nullable)]
	pub series_id: Option<String>,
	/// A `MetadataField` in its serde form, e.g. `PAGE_COUNT` — the same spelling
	/// `locked_fields` stores, so the two are directly comparable.
	///
	/// Stored as the variant's string form rather than a DB enum: the field vocabulary
	/// grows, and a provenance row written before a rename should not break the load.
	#[sea_orm(column_type = "Text")]
	pub field: String,
	/// Provider trait id, or `manual`.
	#[sea_orm(column_type = "Text")]
	pub source_provider: String,
	/// The provider's id for the record this value came from, so the exact source can be
	/// reopened. `None` for manual entries.
	#[sea_orm(column_type = "Text", nullable)]
	pub source_external_id: Option<String>,
	/// `auto` or `user` — see `ChosenBy` on
	/// [`external_metadata_link`](super::external_metadata_link).
	#[sea_orm(column_type = "Text")]
	pub chosen_by: String,
	#[sea_orm(column_type = "custom(\"TIMESTAMP\")")]
	pub applied_at: DateTimeUtc,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
	#[sea_orm(
		belongs_to = "super::media::Entity",
		from = "Column::MediaId",
		to = "super::media::Column::Id",
		on_delete = "Cascade"
	)]
	Media,
	#[sea_orm(
		belongs_to = "super::series::Entity",
		from = "Column::SeriesId",
		to = "super::series::Column::Id",
		on_delete = "Cascade"
	)]
	Series,
}

impl Related<super::media::Entity> for Entity {
	fn to() -> RelationDef {
		Relation::Media.def()
	}
}

impl Related<super::series::Entity> for Entity {
	fn to() -> RelationDef {
		Relation::Series.def()
	}
}

impl ActiveModelBehavior for ActiveModel {}
