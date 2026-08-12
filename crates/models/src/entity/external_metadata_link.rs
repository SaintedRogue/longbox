use async_graphql::SimpleObject;
use sea_orm::{entity::prelude::*, DeriveEntityModel};

/// One row per (entity, provider): what a provider knows about a book or series.
///
/// This is the enrichment pool. Unlike `media_metadata.metadata_source` — a single slot
/// that the first matching provider claimed — several providers coexist here, so LOCG
/// can fill in a page count and full editorial credits on a book ComicVine already
/// matched instead of having to displace it.
///
/// It is also the link table: `(provider, external_id)` is how the release calendar
/// resolves a provider's id back to our entity, and how a future sync will know what to
/// push.
// No `Eq`: `confidence` is a float, and the sibling entities only derive it because
// none of them carry one. `PartialEq` is what the comparisons here actually need.
#[derive(Clone, Debug, PartialEq, DeriveEntityModel, SimpleObject)]
#[graphql(name = "ExternalMetadataLinkModel")]
#[sea_orm(table_name = "external_metadata_link")]
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
	/// The provider's lowercase trait id (`comicvine`, `metron`, `locg`), or
	/// [`MANUAL_PROVIDER`] for values the operator entered themselves.
	#[sea_orm(column_type = "Text")]
	pub provider: String,
	/// The provider's own id. `None` for manual entries, which have no upstream record.
	#[sea_orm(column_type = "Text", nullable)]
	pub external_id: Option<String>,
	#[sea_orm(column_type = "Text", nullable)]
	pub provider_url: Option<String>,
	/// The provider's full field bag, serialized from `ExternalMediaMetadata` or
	/// `ExternalSeriesMetadata`.
	///
	/// `None` is meaningful rather than missing: a row recovered by the Phase 2
	/// migration records that a link exists without pretending to hold the data, because
	/// the original response was never kept. Such a row needs a re-fetch before it can
	/// contribute to a comparison.
	#[sea_orm(column_type = "Text", nullable)]
	#[graphql(skip)]
	pub payload: Option<String>,
	/// Confidence as scored when the row was written, for ranking in the review grid.
	pub confidence: Option<f64>,
	/// See [`LinkState`].
	#[sea_orm(column_type = "Text")]
	pub state: String,
	/// See [`ChosenBy`]. `None` while the row is only a candidate.
	#[sea_orm(column_type = "Text", nullable)]
	pub chosen_by: Option<String>,
	#[sea_orm(column_type = "custom(\"TIMESTAMP\")")]
	pub fetched_at: DateTimeUtc,
	#[sea_orm(column_type = "custom(\"TIMESTAMP\")", nullable)]
	pub refreshed_at: Option<DateTimeUtc>,
}

/// The provider id used for values the operator typed themselves.
///
/// Manual edits are a first-class source: they sit in the same pool, are attributed the
/// same way, and are protected from being overwritten by the same mechanism.
pub const MANUAL_PROVIDER: &str = "manual";

/// Where a link sits between "we saw this" and "this is the truth".
///
/// Stored as a string rather than a DB enum so adding a state is not a migration, and so
/// a row written by an older build never fails to deserialize.
pub struct LinkState;

impl LinkState {
	/// Stored so it can be compared in the review grid; not applied to the entity.
	pub const CANDIDATE: &'static str = "candidate";
	/// The accepted match for this provider.
	pub const LINKED: &'static str = "linked";
	/// The operator rejected it. Kept so it is not offered again.
	pub const REJECTED: &'static str = "rejected";
}

/// Who decided a link was the right one.
pub struct ChosenBy;

impl ChosenBy {
	/// Applied by the auto-apply path, above its confidence threshold.
	pub const AUTO: &'static str = "auto";
	/// The operator picked it.
	pub const USER: &'static str = "user";
	/// Recovered by the Phase 2 migration from the old single-source columns, where who
	/// chose it was never recorded.
	pub const BACKFILL: &'static str = "backfill";
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
