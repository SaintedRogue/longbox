use async_graphql::{Context, Object, Result, ID};
use models::entity::{library, library_folder};
use sea_orm::{prelude::*, Condition, QueryOrder, QuerySelect, QueryTrait};

use crate::{
	data::{AuthContext, CoreContext},
	filter::keyword::{like_contains, multi_term_condition},
	object::library_folder::LibraryFolder,
};

/// Restrict folders to libraries the user can see.
///
/// Folders carry no age rating of their own, so visibility is inherited whole
/// from the owning library: a folder in a hidden library must not leak through
/// search any more than the series inside it do.
fn visible_to_user(
	query: Select<library_folder::Entity>,
	user: &models::entity::user::AuthUser,
) -> Select<library_folder::Entity> {
	query.filter(
		library_folder::Column::LibraryId.in_subquery(
			library::Entity::find_for_user(user)
				.select_only()
				.column(library::Column::Id)
				.into_query(),
		),
	)
}

#[derive(Default)]
pub struct LibraryFolderQuery;

#[Object]
impl LibraryFolderQuery {
	/// A single folder by id.
	async fn library_folder(
		&self,
		ctx: &Context<'_>,
		id: ID,
	) -> Result<Option<LibraryFolder>> {
		let AuthContext { user, .. } = ctx.data::<AuthContext>()?;
		let conn = ctx.data::<CoreContext>()?.conn.as_ref();

		Ok(
			visible_to_user(library_folder::Entity::find_by_id(id.to_string()), user)
				.one(conn)
				.await?
				.map(LibraryFolder::from),
		)
	}

	/// Browse or search folders.
	///
	/// With `parentId`, returns that folder's direct children. Without it, and
	/// with `libraryId`, returns the folders directly beneath that library's root.
	/// `search` matches folder names only -- never paths -- so a library mounted
	/// at `/mnt/comics` does not match every folder in it for the term "comics".
	async fn library_folders(
		&self,
		ctx: &Context<'_>,
		#[graphql(desc = "Restrict to one library.")] library_id: Option<ID>,
		#[graphql(
			desc = "Return the direct children of this folder. Without it, returns folders at the library root."
		)]
		parent_id: Option<ID>,
		#[graphql(desc = "Match against folder names. Terms are AND-ed.")] search: Option<
			String,
		>,
	) -> Result<Vec<LibraryFolder>> {
		let AuthContext { user, .. } = ctx.data::<AuthContext>()?;
		let conn = ctx.data::<CoreContext>()?.conn.as_ref();

		let mut query = visible_to_user(library_folder::Entity::find(), user).apply_if(
			library_id,
			|query, library_id| {
				query.filter(library_folder::Column::LibraryId.eq(library_id.to_string()))
			},
		);

		query = match (&parent_id, &search) {
			// Browsing into a folder.
			(Some(parent_id), _) => {
				query.filter(library_folder::Column::ParentId.eq(parent_id.to_string()))
			},
			// Searching is deliberately not scoped to a level -- a folder buried
			// three deep should still be findable by name.
			(None, Some(_)) => query,
			// Neither: the top level of the tree.
			(None, None) => query.filter(library_folder::Column::ParentId.is_null()),
		};

		let search_condition = search.as_deref().and_then(|search| {
			multi_term_condition(search, |term| {
				Condition::any()
					.add(library_folder::Column::Name.like(like_contains(term)))
			})
		});

		Ok(query
			.apply_if(search_condition, |query, condition| query.filter(condition))
			.order_by_asc(library_folder::Column::Name)
			.all(conn)
			.await?
			.into_iter()
			.map(LibraryFolder::from)
			.collect())
	}
}
