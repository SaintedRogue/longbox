use async_graphql::{Context, Object, Result, ID};

use longbox_core::filesystem::organizer::OrganizeMode;
use longbox_core::job::longbox_job::LongboxJob;

use crate::data::{AuthContext, CoreContext};
use crate::guard::PermissionGuard;
use crate::input::organize::OrganizeDecisionInput;
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
		let _auth = ctx.data::<AuthContext>()?;
		let core = ctx.data::<CoreContext>()?;
		core.enqueue(LongboxJob::organize_loose_files(
			library_id.to_string(),
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
		let _auth = ctx.data::<AuthContext>()?;
		let core = ctx.data::<CoreContext>()?;
		let decisions = decisions.into_iter().map(Into::into).collect();
		core.enqueue(LongboxJob::organize_loose_files(
			library_id.to_string(),
			OrganizeMode::Apply { decisions },
		))
		.await?;
		Ok(true)
	}
}
