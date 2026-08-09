use async_graphql::{Context, Object, Result, ID};
use models::entity::{book_group, library};
use sea_orm::{prelude::*, QueryOrder};

use crate::data::{AuthContext, CoreContext};
use crate::object::book_group::BookGroup;

#[derive(Default)]
pub struct BookGroupQuery;

#[Object]
impl BookGroupQuery {
	/// The virtual shelves in a library, in name order.
	///
	/// Deliberately unpaginated. A shelf only exists for two or more books that share a
	/// series identity, so a library produces a handful of these, not hundreds — on the
	/// library this was built for, 139 loose books yielded 8 shelves.
	async fn book_groups(
		&self,
		ctx: &Context<'_>,
		library_id: ID,
	) -> Result<Vec<BookGroup>> {
		let AuthContext { user, .. } = ctx.data::<AuthContext>()?;
		let conn = ctx.data::<CoreContext>()?.conn.as_ref();

		// Scoped through the user's own library query so hidden libraries stay hidden.
		let library = library::Entity::find_for_user(user)
			.filter(library::Column::Id.eq(library_id.to_string()))
			.one(conn)
			.await?
			.ok_or("Library not found")?;

		let groups = book_group::Entity::find()
			.filter(book_group::Column::LibraryId.eq(library.id))
			.order_by_asc(book_group::Column::Name)
			.all(conn)
			.await?;

		Ok(groups.into_iter().map(BookGroup::from).collect())
	}

	async fn book_group_by_id(
		&self,
		ctx: &Context<'_>,
		id: ID,
	) -> Result<Option<BookGroup>> {
		let AuthContext { user, .. } = ctx.data::<AuthContext>()?;
		let conn = ctx.data::<CoreContext>()?.conn.as_ref();

		let Some(group) = book_group::Entity::find_by_id(id.to_string())
			.one(conn)
			.await?
		else {
			return Ok(None);
		};

		// Confirm the caller can see the owning library before handing the shelf over.
		let visible = library::Entity::find_for_user(user)
			.filter(library::Column::Id.eq(group.library_id.clone()))
			.one(conn)
			.await?
			.is_some();

		Ok(visible.then(|| BookGroup::from(group)))
	}
}
