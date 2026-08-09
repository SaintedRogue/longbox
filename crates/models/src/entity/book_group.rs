use async_graphql::SimpleObject;
use async_trait::async_trait;
use chrono::Utc;
use sea_orm::{entity::prelude::*, ActiveValue::Set, ConnectionTrait, DbErr};

use crate::shared::enums::BookGroupSource;

/// A virtual shelf for books that belong together but do not share a folder.
///
/// Longbox derives series from directories, so books sitting loose in a library root
/// all collapse into one bucket series named after that directory. A book group is the
/// grouping those books should have had, recorded in the database instead of on disk —
/// nothing here corresponds to a real directory, and deliberately so. `series.path` is
/// filesystem truth that the scanner reconciles on every pass; a group with a made-up
/// path would be flagged missing on the next scan and take its books with it.
///
/// Membership lives on `media.book_group_id`, alongside `media.book_group_locked`,
/// which marks a row a person has decided about so detection leaves it alone.
#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq, SimpleObject)]
#[graphql(name = "BookGroupModel")]
#[sea_orm(table_name = "book_groups")]
pub struct Model {
	#[sea_orm(primary_key, auto_increment = false, column_type = "Text")]
	pub id: String,
	#[sea_orm(column_type = "Text")]
	pub library_id: String,
	#[sea_orm(column_type = "Text")]
	pub name: String,
	/// Where this group's identity came from.
	#[sea_orm(column_type = "Text")]
	pub source: BookGroupSource,
	/// The normalized key detection used to form this group, so a re-run matches it
	/// rather than creating a duplicate. `None` for manually created groups.
	#[sea_orm(column_type = "Text", nullable)]
	pub source_key: Option<String>,
	#[sea_orm(column_type = "custom(\"DATETIME\")")]
	pub created_at: DateTimeWithTimeZone,
	#[sea_orm(column_type = "custom(\"DATETIME\")")]
	pub updated_at: DateTimeWithTimeZone,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
	#[sea_orm(
		belongs_to = "super::library::Entity",
		from = "Column::LibraryId",
		to = "super::library::Column::Id",
		on_delete = "Cascade"
	)]
	Library,
	#[sea_orm(has_many = "super::media::Entity")]
	Media,
}

impl Related<super::library::Entity> for Entity {
	fn to() -> RelationDef {
		Relation::Library.def()
	}
}

impl Related<super::media::Entity> for Entity {
	fn to() -> RelationDef {
		Relation::Media.def()
	}
}

#[async_trait]
impl ActiveModelBehavior for ActiveModel {
	async fn before_save<C>(mut self, _db: &C, insert: bool) -> Result<Self, DbErr>
	where
		C: ConnectionTrait,
	{
		let now = DateTimeWithTimeZone::from(Utc::now());
		if insert {
			if self.id.is_not_set() {
				self.id = Set(Uuid::new_v4().to_string());
			}
			self.created_at = Set(now);
		}
		self.updated_at = Set(now);
		Ok(self)
	}
}
