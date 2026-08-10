use async_graphql::SimpleObject;
use chrono::Utc;
use sea_orm::{entity::prelude::*, prelude::async_trait::async_trait, ActiveValue};

use super::library;

/// A directory in a library that groups other directories rather than holding
/// books of its own.
///
/// The scanner already visits every directory and splits them into "becomes a
/// series" and "everything else"; the grouping directories -- `Marvel/`,
/// `Publisher/`, the organisational layers of a tidy collection -- land in the
/// second bucket and were previously discarded. Storing them is what lets a
/// series say where it sits, and what makes `Marvel/Hulk` distinguishable from
/// `DC/Hulk` when both series rows are named "Hulk".
///
/// Rows are reconciled on every library scan: upserted on `(library_id, path)`
/// and pruned when the directory no longer exists on disk. Nothing else writes
/// to this table.
#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq, SimpleObject)]
#[graphql(name = "LibraryFolderModel")]
#[sea_orm(table_name = "library_folders")]
pub struct Model {
	#[sea_orm(primary_key, auto_increment = false, column_type = "Text")]
	pub id: String,
	#[sea_orm(column_type = "Text")]
	pub library_id: String,
	/// `None` for a folder directly beneath the library root.
	#[sea_orm(column_type = "Text", nullable)]
	pub parent_id: Option<String>,
	/// The leaf directory name only. Deliberately not the accumulated path: a
	/// substring match against this cannot hit a library's mount point, which is
	/// exactly the failure mode that makes `series.path` unusable for folder
	/// search.
	#[sea_orm(column_type = "Text")]
	pub name: String,
	/// Absolute, and byte-identical to the string the walker produced, so it
	/// compares directly against `series.path`.
	#[sea_orm(column_type = "Text")]
	pub path: String,
	/// 0 for a direct child of the library root.
	pub depth: i32,
	#[sea_orm(column_type = "custom(\"DATETIME\")")]
	pub created_at: DateTimeWithTimeZone,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
	#[sea_orm(
		belongs_to = "library::Entity",
		from = "Column::LibraryId",
		to = "library::Column::Id",
		on_delete = "Cascade"
	)]
	Library,
	#[sea_orm(
		belongs_to = "Entity",
		from = "Column::ParentId",
		to = "Column::Id",
		on_delete = "Cascade"
	)]
	Parent,
}

impl Related<library::Entity> for Entity {
	fn to() -> RelationDef {
		Relation::Library.def()
	}
}

#[async_trait]
impl ActiveModelBehavior for ActiveModel {
	async fn before_save<C>(mut self, _db: &C, insert: bool) -> Result<Self, DbErr>
	where
		C: ConnectionTrait,
	{
		if insert {
			if self.id.is_not_set() {
				self.id = ActiveValue::Set(Uuid::new_v4().to_string());
			}
			self.created_at = ActiveValue::Set(Utc::now().into());
		}

		Ok(self)
	}
}

impl Entity {
	/// Folders directly beneath a library's root.
	pub fn find_roots(library_id: &str) -> Select<Entity> {
		Entity::find()
			.filter(Column::LibraryId.eq(library_id))
			.filter(Column::ParentId.is_null())
	}

	/// Folders directly beneath another folder.
	pub fn find_children(parent_id: &str) -> Select<Entity> {
		Entity::find().filter(Column::ParentId.eq(parent_id))
	}
}
