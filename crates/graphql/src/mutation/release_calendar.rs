use async_graphql::{Context, Object, Result};
use longbox_core::filesystem::metadata::{sweep_in_flight, sync_release_calendar};
use models::{
	entity::{scheduled_job, server_config},
	shared::enums::{ScheduledJobKind, UserPermission},
};
use sea_orm::prelude::*;

use crate::{
	data::CoreContext, guard::PermissionGuard,
	query::release_calendar::ReleaseCalendarStatus,
};

#[derive(Default)]
pub struct ReleaseCalendarMutation;

#[Object]
impl ReleaseCalendarMutation {
	/// Pull the release calendar now, without waiting for the schedule.
	///
	/// Returns as soon as the sweep has *started*, not when it finishes: a sweep talks to
	/// external providers and can run for minutes, which is far longer than a request
	/// should be held open. The UI polls `releaseCalendarStatus` for the rest.
	///
	/// Gated on `ManageServer` because a sweep spends the server's shared provider API
	/// budget — this is not a per-viewer refresh.
	#[graphql(guard = "PermissionGuard::one(UserPermission::ManageServer)")]
	async fn sync_release_calendar(
		&self,
		ctx: &Context<'_>,
	) -> Result<ReleaseCalendarStatus> {
		let core = ctx.data::<CoreContext>()?;
		let conn = core.conn.as_ref();

		let schedule = scheduled_job::Entity::find()
			.filter(scheduled_job::Column::Kind.eq(ScheduledJobKind::ReleaseCalendarSync))
			.one(conn)
			.await?;

		// Falls back to the default config so a manual pull works on a server that has
		// never set up a schedule. Insisting on a cron expression before you may press
		// "sync now" would be a strange thing to require.
		let config = schedule
			.as_ref()
			.map(|job| job.release_calendar_config())
			.unwrap_or_default();

		let already_running = sweep_in_flight();
		if !already_running {
			// Owned clone so the sweep outlives this request.
			let spawned = core.clone();
			tokio::spawn(async move {
				match sync_release_calendar(config, &spawned).await {
					Ok(summary) => tracing::info!(
						providers = summary.providers_swept,
						plugins = summary.plugins_swept,
						matched = summary.matched,
						"Manual release-calendar sync complete"
					),
					Err(error) => {
						tracing::error!(%error, "Manual release-calendar sync failed")
					},
				}
			});
		}

		let last_synced_at = server_config::Entity::find()
			.one(conn)
			.await?
			.and_then(|config| config.last_release_calendar_sync_at)
			.map(|t| t.to_rfc3339());

		Ok(ReleaseCalendarStatus {
			// True either way: either it already was, or it is now because of this call.
			is_running: true,
			last_synced_at,
			is_scheduled: schedule.is_some_and(|job| job.enabled),
		})
	}
}
