use async_graphql::{Context, Object, Result, ID};
use sea_orm::prelude::*;

use longbox_core::filesystem::organizer::OrganizeMode;
use longbox_core::job::longbox_job::LongboxJob;

use crate::data::{AuthContext, CoreContext};
use crate::guard::PermissionGuard;
use crate::input::organize::OrganizeDecisionInput;
use models::entity::library;
use models::shared::enums::UserPermission;

#[derive(Default)]
pub struct OrganizeMutation;

#[Object]
impl OrganizeMutation {
	/// Enqueue a job that scans for loose files and builds an organize preview.
	#[graphql(guard = "PermissionGuard::one(UserPermission::ScanLibrary)")]
	async fn plan_organize_loose_files(
		&self,
		ctx: &Context<'_>,
		library_id: ID,
	) -> Result<bool> {
		let AuthContext { user, .. } = ctx.data::<AuthContext>()?;
		let core = ctx.data::<CoreContext>()?;
		let library = library::Entity::find_for_user(user)
			.filter(library::Column::Id.eq(library_id.to_string()))
			.one(core.conn.as_ref())
			.await?
			.ok_or("Library not found")?;
		core.enqueue(LongboxJob::organize_loose_files(
			library.id,
			OrganizeMode::Plan,
		))
		.await?;
		Ok(true)
	}

	/// Enqueue a job that applies the given organize decisions (moves files).
	#[graphql(guard = "PermissionGuard::one(UserPermission::ScanLibrary)")]
	async fn apply_organize_loose_files(
		&self,
		ctx: &Context<'_>,
		library_id: ID,
		decisions: Vec<OrganizeDecisionInput>,
	) -> Result<bool> {
		let AuthContext { user, .. } = ctx.data::<AuthContext>()?;
		let core = ctx.data::<CoreContext>()?;
		let library = library::Entity::find_for_user(user)
			.filter(library::Column::Id.eq(library_id.to_string()))
			.one(core.conn.as_ref())
			.await?
			.ok_or("Library not found")?;
		let decisions = decisions.into_iter().map(Into::into).collect();
		core.enqueue(LongboxJob::organize_loose_files(
			library.id,
			OrganizeMode::Apply { decisions },
		))
		.await?;
		Ok(true)
	}
}
