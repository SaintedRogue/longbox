use async_graphql::{Context, Object, Result, ID};
use sea_orm::{prelude::*, QueryOrder};

use longbox_core::filesystem::metadata::ProviderClientCache;
use longbox_core::filesystem::organizer::plan::{build_plan_scoped, OrganizePlan};
use models::entity::{library, library_config, organize_plan_record};
use models::shared::enums::UserPermission;

use crate::data::{AuthContext, CoreContext};
use crate::guard::PermissionGuard;
use crate::object::organize::OrganizePreview;

#[derive(Default)]
pub struct OrganizeQuery;

#[Object]
impl OrganizeQuery {
	/// The latest computed organize preview for a library, if any.
	async fn organize_preview(
		&self,
		ctx: &Context<'_>,
		library_id: ID,
	) -> Result<Option<OrganizePreview>> {
		let AuthContext { user, .. } = ctx.data::<AuthContext>()?;
		let conn = ctx.data::<CoreContext>()?.conn.as_ref();

		let library = library::Entity::find_for_user(user)
			.filter(library::Column::Id.eq(library_id.to_string()))
			.one(conn)
			.await?
			.ok_or("Library not found")?;

		let record = organize_plan_record::Entity::find()
			.filter(organize_plan_record::Column::LibraryId.eq(library.id))
			.order_by_desc(organize_plan_record::Column::UpdatedAt)
			.one(conn)
			.await?;

		match record {
			Some(record) => {
				let plan: OrganizePlan = serde_json::from_str(&record.plan_json)
					.map_err(|e| format!("Corrupt organize plan record: {e}"))?;
				Ok(Some(plan.into()))
			},
			None => Ok(None),
		}
	}

	/// Compute an organize preview scoped to a single file or folder under the library.
	/// Runs synchronously (live provider lookups) and is NOT persisted, so it never
	/// disturbs the library-wide plan. `path` must resolve to a real location inside the
	/// library root.
	#[graphql(guard = "PermissionGuard::one(UserPermission::ScanLibrary)")]
	async fn organize_preview_for_path(
		&self,
		ctx: &Context<'_>,
		library_id: ID,
		path: String,
	) -> Result<OrganizePreview> {
		let AuthContext { user, .. } = ctx.data::<AuthContext>()?;
		let core = ctx.data::<CoreContext>()?;
		let conn = core.conn.as_ref();

		let library = library::Entity::find_for_user(user)
			.filter(library::Column::Id.eq(library_id.to_string()))
			.one(conn)
			.await?
			.ok_or("Library not found")?;

		// Security: the client-supplied path must resolve to a real location inside the
		// library root — reject `..`, symlinks that escape, and anything out of tree.
		let root_canon = std::fs::canonicalize(&library.path)
			.map_err(|_| async_graphql::Error::new("Library path is not accessible"))?;
		let target_canon = std::fs::canonicalize(&path)
			.map_err(|_| async_graphql::Error::new("Target path not found"))?;
		if !target_canon.starts_with(&root_canon) {
			return Err(async_graphql::Error::new(
				"Target path is outside the library",
			));
		}

		let config = library_config::Entity::find()
			.filter(library_config::Column::LibraryId.eq(library.id.clone()))
			.one(conn)
			.await?
			.ok_or("Library config not found")?;

		let encryption_key = core.get_encryption_key().await?;
		let provider_cache = ProviderClientCache::new(encryption_key);

		let plan = build_plan_scoped(
			conn,
			&library.id,
			&library.path,
			&target_canon.to_string_lossy(),
			&config,
			&provider_cache,
		)
		.await
		.map_err(|e| async_graphql::Error::new(e.to_string()))?;

		Ok(plan.into())
	}
}
