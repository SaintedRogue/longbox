use async_graphql::{Context, Object, Result, SimpleObject, ID};
use longbox_core::filesystem::grouping::{detect_book_groups, DetectBookGroupsOutput};
use models::{
	entity::{book_group, library, media},
	shared::enums::{BookGroupSource, UserPermission},
};
use sea_orm::{prelude::*, ActiveValue::Set};

use crate::data::{AuthContext, CoreContext};
use crate::guard::PermissionGuard;
use crate::object::book_group::BookGroup;

/// What a detection run did.
#[derive(Debug, Default, Clone, SimpleObject)]
pub struct DetectBookGroupsResult {
	pub groups_created: u32,
	pub groups_matched: u32,
	pub groups_pruned: u32,
	pub books_grouped: u32,
	pub books_standalone: u32,
	pub books_locked: u32,
}

impl From<DetectBookGroupsOutput> for DetectBookGroupsResult {
	fn from(output: DetectBookGroupsOutput) -> Self {
		Self {
			groups_created: output.groups_created,
			groups_matched: output.groups_matched,
			groups_pruned: output.groups_pruned,
			books_grouped: output.books_grouped,
			books_standalone: output.books_standalone,
			books_locked: output.books_locked,
		}
	}
}

#[derive(Default)]
pub struct BookGroupMutation;

impl BookGroupMutation {
	/// Resolve a library the caller is allowed to see, or fail.
	async fn library_for_user(
		ctx: &Context<'_>,
		library_id: &str,
	) -> Result<library::Model> {
		let AuthContext { user, .. } = ctx.data::<AuthContext>()?;
		let conn = ctx.data::<CoreContext>()?.conn.as_ref();

		library::Entity::find_for_user(user)
			.filter(library::Column::Id.eq(library_id))
			.one(conn)
			.await?
			.ok_or_else(|| "Library not found".into())
	}

	/// Resolve a shelf, confirming the caller can see the library that owns it.
	async fn group_for_user(ctx: &Context<'_>, id: &str) -> Result<book_group::Model> {
		let conn = ctx.data::<CoreContext>()?.conn.as_ref();

		let group = book_group::Entity::find_by_id(id.to_string())
			.one(conn)
			.await?
			.ok_or("Book group not found")?;

		Self::library_for_user(ctx, &group.library_id).await?;
		Ok(group)
	}
}

#[Object]
impl BookGroupMutation {
	/// Group a library's loose books into virtual shelves.
	///
	/// Runs inline rather than as a queued job: it is pure string work over embedded
	/// metadata and filenames, with no network calls, so it finishes in milliseconds.
	/// That is deliberate — the provider-confirmed organize job this sits beside once ran
	/// for 917 seconds against the same library before failing.
	///
	/// Idempotent. Books whose grouping a person has already decided are left untouched.
	#[graphql(guard = "PermissionGuard::one(UserPermission::ScanLibrary)")]
	async fn detect_book_groups(
		&self,
		ctx: &Context<'_>,
		library_id: ID,
	) -> Result<DetectBookGroupsResult> {
		let library = Self::library_for_user(ctx, library_id.as_ref()).await?;
		let conn = ctx.data::<CoreContext>()?.conn.as_ref();

		let output = detect_book_groups(conn, &library.id).await?;
		Ok(output.into())
	}

	/// Move a book onto a shelf, or off every shelf when `bookGroupId` is null.
	///
	/// Either way the book is locked, so later detection runs leave it exactly where the
	/// person put it. This is what makes a correction stick across rescans.
	#[graphql(guard = "PermissionGuard::one(UserPermission::ScanLibrary)")]
	async fn assign_book_group(
		&self,
		ctx: &Context<'_>,
		media_id: ID,
		book_group_id: Option<ID>,
	) -> Result<bool> {
		let AuthContext { user, .. } = ctx.data::<AuthContext>()?;
		let conn = ctx.data::<CoreContext>()?.conn.as_ref();

		let book = media::Entity::find_for_user(user)
			.filter(media::Column::Id.eq(media_id.to_string()))
			.one(conn)
			.await?
			.ok_or("Book not found")?;

		let target = match &book_group_id {
			Some(id) => Some(Self::group_for_user(ctx, id.as_ref()).await?.id),
			None => None,
		};

		media::ActiveModel {
			id: Set(book.id),
			book_group_id: Set(target),
			book_group_locked: Set(true),
			..Default::default()
		}
		.update(conn)
		.await?;

		Ok(true)
	}

	/// Create a shelf by hand and put the given books on it.
	///
	/// Manual shelves carry no `source_key`, so detection never matches, renames, or
	/// prunes them.
	#[graphql(guard = "PermissionGuard::one(UserPermission::ScanLibrary)")]
	async fn create_book_group(
		&self,
		ctx: &Context<'_>,
		library_id: ID,
		name: String,
		media_ids: Vec<ID>,
	) -> Result<BookGroup> {
		let library = Self::library_for_user(ctx, library_id.as_ref()).await?;
		let conn = ctx.data::<CoreContext>()?.conn.as_ref();

		let name = name.trim().to_string();
		if name.is_empty() {
			return Err("A book group needs a name".into());
		}

		let group = book_group::ActiveModel {
			library_id: Set(library.id),
			name: Set(name),
			source: Set(BookGroupSource::Manual),
			source_key: Set(None),
			..Default::default()
		}
		.insert(conn)
		.await?;

		if !media_ids.is_empty() {
			media::Entity::update_many()
				.col_expr(
					media::Column::BookGroupId,
					Expr::value(Some(group.id.clone())),
				)
				.col_expr(media::Column::BookGroupLocked, Expr::value(true))
				.filter(
					media::Column::Id.is_in(media_ids.iter().map(|id| id.to_string())),
				)
				.exec(conn)
				.await?;
		}

		Ok(BookGroup::from(group))
	}

	#[graphql(guard = "PermissionGuard::one(UserPermission::ScanLibrary)")]
	async fn rename_book_group(
		&self,
		ctx: &Context<'_>,
		id: ID,
		name: String,
	) -> Result<BookGroup> {
		let group = Self::group_for_user(ctx, id.as_ref()).await?;
		let conn = ctx.data::<CoreContext>()?.conn.as_ref();

		let name = name.trim().to_string();
		if name.is_empty() {
			return Err("A book group needs a name".into());
		}

		let updated = book_group::ActiveModel {
			id: Set(group.id),
			name: Set(name),
			..Default::default()
		}
		.update(conn)
		.await?;

		Ok(BookGroup::from(updated))
	}

	/// Delete a shelf. Its books stay exactly where they are on disk and in the library —
	/// they simply become standalone again, and stay locked so detection does not
	/// immediately rebuild the shelf someone just dismantled.
	#[graphql(guard = "PermissionGuard::one(UserPermission::ScanLibrary)")]
	async fn delete_book_group(&self, ctx: &Context<'_>, id: ID) -> Result<bool> {
		let group = Self::group_for_user(ctx, id.as_ref()).await?;
		let conn = ctx.data::<CoreContext>()?.conn.as_ref();

		media::Entity::update_many()
			.col_expr(media::Column::BookGroupId, Expr::value(None::<String>))
			.col_expr(media::Column::BookGroupLocked, Expr::value(true))
			.filter(media::Column::BookGroupId.eq(group.id.clone()))
			.exec(conn)
			.await?;

		book_group::Entity::delete_by_id(group.id)
			.exec(conn)
			.await?;

		Ok(true)
	}
}
