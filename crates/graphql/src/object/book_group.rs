use async_graphql::{ComplexObject, Context, Result, SimpleObject};
use models::entity::{book_group, media};
use sea_orm::{prelude::*, QueryOrder};

use crate::data::CoreContext;

use super::media::Media;

/// A virtual shelf of books that belong together but do not share a folder.
///
/// Unlike a `Series`, this has no path and no directory behind it — it exists so books
/// left loose in a library root can be browsed sensibly without anything moving on disk.
#[derive(Clone, Debug, SimpleObject)]
#[graphql(complex)]
pub struct BookGroup {
	#[graphql(flatten)]
	pub model: book_group::Model,
}

impl From<book_group::Model> for BookGroup {
	fn from(model: book_group::Model) -> Self {
		Self { model }
	}
}

#[ComplexObject]
impl BookGroup {
	/// The books on this shelf, in name order.
	async fn books(&self, ctx: &Context<'_>) -> Result<Vec<Media>> {
		let conn = ctx.data::<CoreContext>()?.conn.as_ref();

		let books = media::ModelWithMetadata::find()
			.filter(media::Column::BookGroupId.eq(self.model.id.clone()))
			.filter(media::Column::DeletedAt.is_null())
			.order_by_asc(media::Column::Name)
			.into_model::<media::ModelWithMetadata>()
			.all(conn)
			.await?;

		Ok(books.into_iter().map(Media::from).collect())
	}

	async fn book_count(&self, ctx: &Context<'_>) -> Result<u64> {
		let conn = ctx.data::<CoreContext>()?.conn.as_ref();

		let count = media::Entity::find()
			.filter(media::Column::BookGroupId.eq(self.model.id.clone()))
			.filter(media::Column::DeletedAt.is_null())
			.count(conn)
			.await?;

		Ok(count)
	}
}
