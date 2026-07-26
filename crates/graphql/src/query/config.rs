use async_graphql::{Context, Object, Result, SimpleObject};
use longbox_core::config::LongboxConfig;
use models::shared::enums::UserPermission;

use crate::{data::CoreContext, guard::PermissionGuard};

/// The upload-related slice of the server configuration. This exists so clients can
/// render an accurate upload control -- whether uploads are permitted at all, and how
/// large a file may be -- instead of discovering both by way of a failed mutation.
#[derive(Default, SimpleObject)]
pub struct UploadConfig {
	/// Whether `enable_upload` is set on the server. When false, every upload mutation
	/// is rejected by [`crate::guard::OptionalFeatureGuard`].
	enabled: bool,
	/// The maximum size, in bytes, of a single uploaded file.
	///
	/// Deliberately a GraphQL `Float` (f64) rather than an `Int`. `Int` is a *signed
	/// 32-bit* value per the GraphQL spec, so it tops out at ~2.1 GB, and deployments
	/// routinely configure a larger ceiling (5 GB on ours). `f64` represents every
	/// integer up to 2^53 exactly, so a byte count is lossless well past any plausible
	/// upload limit, and it maps to a plain `number` in the generated TS client.
	max_file_upload_size: f64,
}

#[derive(Default)]
pub struct ConfigQuery;

#[Object]
impl ConfigQuery {
	#[graphql(guard = "PermissionGuard::one(UserPermission::ManageServer)")]
	async fn longbox_config(&self, ctx: &Context<'_>) -> Result<LongboxConfig> {
		let config = ctx.data::<CoreContext>()?.config.as_ref();

		Ok(config.clone())
	}

	#[graphql(guard = "PermissionGuard::one(UserPermission::UploadFile)")]
	async fn upload_config(&self, ctx: &Context<'_>) -> Result<UploadConfig> {
		let config = ctx.data::<CoreContext>()?.config.as_ref();
		Ok(UploadConfig {
			enabled: config.enable_upload,
			max_file_upload_size: config.max_file_upload_size as f64,
		})
	}
}
