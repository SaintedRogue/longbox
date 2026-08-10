use async_graphql::{ComplexObject, Context, Result, SimpleObject};
use models::entity::{library_folder, series};
use sea_orm::{prelude::*, QueryOrder};

use crate::{
	data::{AuthContext, CoreContext},
	object::series::Series,
};

/// A grouping directory inside a library - the levels between the library root
/// and the folders that actually hold books.
#[derive(Clone, Debug, SimpleObject)]
#[graphql(complex)]
pub struct LibraryFolder {
	#[graphql(flatten)]
	pub model: library_folder::Model,
}

impl From<library_folder::Model> for LibraryFolder {
	fn from(model: library_folder::Model) -> Self {
		Self { model }
	}
}

#[ComplexObject]
impl LibraryFolder {
	/// The folders directly inside this one.
	async fn children(&self, ctx: &Context<'_>) -> Result<Vec<LibraryFolder>> {
		let conn = ctx.data::<CoreContext>()?.conn.as_ref();

		Ok(library_folder::Entity::find_children(&self.model.id)
			.order_by_asc(library_folder::Column::Name)
			.all(conn)
			.await?
			.into_iter()
			.map(LibraryFolder::from)
			.collect())
	}

	/// The series directly inside this folder, scoped to what the user may see.
	async fn series(&self, ctx: &Context<'_>) -> Result<Vec<Series>> {
		let AuthContext { user, .. } = ctx.data::<AuthContext>()?;
		let conn = ctx.data::<CoreContext>()?.conn.as_ref();

		Ok(series::ModelWithMetadata::find_for_user(user)
			.filter(series::Column::FolderId.eq(self.model.id.clone()))
			.order_by_asc(series::Column::Name)
			.into_model::<series::ModelWithMetadata>()
			.all(conn)
			.await?
			.into_iter()
			.map(Series::from)
			.collect())
	}

	/// This folder's ancestors, outermost first, excluding the folder itself.
	///
	/// Walks the `parent_id` chain rather than issuing a recursive CTE: chains are
	/// a handful of hops in practice, and nothing else in this schema uses
	/// `WITH RECURSIVE`.
	async fn ancestors(&self, ctx: &Context<'_>) -> Result<Vec<LibraryFolder>> {
		let conn = ctx.data::<CoreContext>()?.conn.as_ref();
		Ok(collect_ancestors(conn, self.model.parent_id.clone())
			.await?
			.into_iter()
			.map(LibraryFolder::from)
			.collect())
	}
}

/// Walks a `parent_id` chain to the root, returning ancestors outermost first.
///
/// Depth-bounded so a cycle - which the schema should prevent, but which a
/// hand-edited database could still contain - degrades to a short breadcrumb
/// rather than an infinite loop.
pub(crate) async fn collect_ancestors(
	conn: &DatabaseConnection,
	mut parent_id: Option<String>,
) -> Result<Vec<library_folder::Model>> {
	const MAX_DEPTH: usize = 32;

	let mut chain = Vec::new();
	while let Some(id) = parent_id {
		if chain.len() >= MAX_DEPTH {
			tracing::warn!(
				folder_id = %id,
				"Folder ancestry exceeded the maximum depth; truncating"
			);
			break;
		}

		let Some(folder) = library_folder::Entity::find_by_id(id).one(conn).await? else {
			// A dangling parent means the prune step removed it between reads. The
			// chain we have is still a correct suffix of the real one.
			break;
		};

		parent_id = folder.parent_id.clone();
		chain.push(folder);
	}

	chain.reverse();
	Ok(chain)
}
