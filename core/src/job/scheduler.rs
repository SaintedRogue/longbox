use std::str::FromStr;
use std::sync::Arc;

use chrono::Utc;
use cron::Schedule;
use models::entity::{library, metadata_fetch_record, scheduled_job};
use models::shared::enums::{MetadataFetchStatus, ScheduledJobKind};
use sea_orm::{prelude::*, EntityTrait, QueryFilter};

use crate::filesystem::metadata::MetadataFetchJobParams;
use crate::job::longbox_job::LongboxJob;
use crate::{CoreError, CoreResult, Ctx};

/// A scheduler that loads cron-based jobs and spawns them accordingly.
///
/// The instance owns its spawned cron loops: dropping it aborts them all, so it
/// must be held for as long as scheduled jobs should keep firing.
#[must_use = "dropping the JobScheduler aborts all scheduled job loops"]
pub struct JobScheduler {
	handles: Vec<tokio::task::JoinHandle<()>>,
}

impl JobScheduler {
	pub async fn init(ctx: Arc<Ctx>) -> CoreResult<Self> {
		let jobs = scheduled_job::Entity::find()
			.filter(scheduled_job::Column::Enabled.eq(true))
			.all(ctx.conn.as_ref())
			.await?;

		let mut scheduler = Self {
			handles: Vec::with_capacity(jobs.len()),
		};

		for job in jobs {
			match Schedule::from_str(&job.schedule) {
				Ok(schedule) => {
					tracing::info!(
						id = job.id,
						name = %job.name,
						kind = ?job.kind,
						schedule = %job.schedule,
						"Starting scheduled job"
					);
					let ctx = Arc::clone(&ctx);
					let handle = tokio::spawn(cron_loop(job, schedule, ctx));
					scheduler.handles.push(handle);
				},
				Err(error) => {
					// TODO: Persisted log for UI to see
					tracing::error!(
						id = job.id,
						name = %job.name,
						schedule = %job.schedule,
						?error,
						"Invalid cron expression, skipping scheduled job"
					);
				},
			}
		}

		tracing::info!(job_count = scheduler.handles.len(), "Scheduler initialized");

		Ok(scheduler)
	}

	pub fn job_count(&self) -> usize {
		self.handles.len()
	}
}

impl Drop for JobScheduler {
	fn drop(&mut self) {
		for handle in &self.handles {
			handle.abort();
		}
	}
}

/// The main loop for a single scheduled job based on its cron expression
#[tracing::instrument(fields(job_id = %job.id, job_name = %job.name), skip(ctx))]
async fn cron_loop(job: scheduled_job::Model, schedule: Schedule, ctx: Arc<Ctx>) {
	loop {
		let now = Utc::now();
		let next = match schedule.upcoming(Utc).next() {
			Some(t) => t,
			None => {
				tracing::warn!("No upcoming fire time for cron schedule, stopping");
				return;
			},
		};

		let duration = (next - now).to_std().unwrap_or_default();
		tracing::debug!(
			next = %next,
			secs_until = duration.as_secs(),
			"Sleeping until next fire"
		);

		tokio::time::sleep(duration).await;

		tracing::info!("Firing scheduled job");

		if let Err(error) = dispatch(&job, &ctx).await {
			tracing::error!(
				id = job.id,
				name = %job.name,
				?error,
				"Scheduled job dispatch failed"
			);
		}

		if let Err(error) = scheduled_job::Entity::update_many()
			.col_expr(
				scheduled_job::Column::LastRunAt,
				sea_orm::sea_query::Expr::value(Utc::now()),
			)
			.filter(scheduled_job::Column::Id.eq(job.id))
			.exec(ctx.conn.as_ref())
			.await
		{
			tracing::error!(
				id = job.id,
				name = %job.name,
				?error,
				"Failed to update last_run_at"
			);
		}
	}
}

/// Dispatch a scheduled job based on its kind
async fn dispatch(job: &scheduled_job::Model, ctx: &Ctx) -> CoreResult<()> {
	match job.kind {
		ScheduledJobKind::LibraryScan => dispatch_library_scan(job, ctx).await,
		ScheduledJobKind::MetadataRetry => dispatch_metadata_retry(job, ctx).await,
		ScheduledJobKind::ReleaseCalendarSync => {
			crate::filesystem::metadata::run_release_calendar_sync(job, ctx).await
		},
	}
}

async fn dispatch_library_scan(job: &scheduled_job::Model, ctx: &Ctx) -> CoreResult<()> {
	let config = job.library_scan_config().ok_or(CoreError::InternalError(
		"Invalid scheduled scan config".to_string(),
	))?;

	let libraries = if config.library_ids.is_empty() {
		library::Entity::find().all(ctx.conn.as_ref()).await?
	} else {
		library::Entity::find()
			.filter(library::Column::Id.is_in(config.library_ids.clone()))
			.all(ctx.conn.as_ref())
			.await?
	};

	if libraries.is_empty() {
		tracing::warn!("No libraries found for scheduled scan");
		return Ok(());
	}

	for lib in libraries {
		tracing::info!(
			library_name = %lib.name,
			"Enqueuing library scan from scheduler"
		);
		ctx.enqueue(LongboxJob::library_scan(
			lib.id.clone(),
			lib.path.clone(),
			None,
		))
		.await
		.map_err(|e| CoreError::InternalError(e.to_string()))?;
	}

	Ok(())
}

/// Statuses the retry job targets when a scheduled job carries no explicit config.
///
/// Every entry here is also in [`SKIP_STATUSES`], which is exactly why the retry has to
/// force the re-fetch — see `default_retry_statuses_require_forcing`.
const DEFAULT_RETRY_STATUSES: [MetadataFetchStatus; 1] =
	[MetadataFetchStatus::RateLimited];

async fn dispatch_metadata_retry(
	job: &scheduled_job::Model,
	ctx: &Ctx,
) -> CoreResult<()> {
	let config = job.metadata_retry_config();

	let statuses = config
		.as_ref()
		.map(|c| c.statuses.clone())
		.unwrap_or_else(|| DEFAULT_RETRY_STATUSES.to_vec());

	let records = metadata_fetch_record::Entity::find()
		.filter(metadata_fetch_record::Column::Status.is_in(statuses))
		.all(ctx.conn.as_ref())
		.await?;

	if records.is_empty() {
		tracing::debug!(
			id = job.id,
			name = %job.name,
			"No records to retry"
		);
		return Ok(());
	}

	let series_ids: Vec<String> =
		records.iter().filter_map(|r| r.series_id.clone()).collect();
	let media_ids: Vec<String> =
		records.iter().filter_map(|r| r.media_id.clone()).collect();

	if !series_ids.is_empty() {
		tracing::info!(
			count = series_ids.len(),
			"Enqueuing metadata retry for series"
		);
		// `retry_*`, not the plain constructor: these records were selected *because*
		// of their status, and those statuses are in `SKIP_STATUSES`.
		let params = MetadataFetchJobParams::retry_series(series_ids);
		ctx.enqueue(LongboxJob::metadata_fetch(params))
			.await
			.map_err(|e| CoreError::InternalError(e.to_string()))?;
	}

	if !media_ids.is_empty() {
		tracing::info!(
			count = media_ids.len(),
			"Enqueuing metadata retry for media"
		);
		let params = MetadataFetchJobParams::retry_media(media_ids);
		ctx.enqueue(LongboxJob::metadata_fetch(params))
			.await
			.map_err(|e| CoreError::InternalError(e.to_string()))?;
	}

	Ok(())
}

#[cfg(test)]
mod tests {
	use migrations::{Migrator, MigratorTrait};
	use sea_orm::{ActiveModelTrait, Database, Set};

	use super::*;
	// Only the tests need this: they assert the overlap between what a retry targets
	// and what the fetch job skips.
	use crate::filesystem::metadata::SKIP_STATUSES;

	/// Regression test for the retry-that-never-retried bug.
	///
	/// `dispatch_metadata_retry` selects fetch records *by status* and hands the ids to
	/// the fetch job. The job, when not forced, skips any entity whose record status is
	/// in `SKIP_STATUSES` — and every status worth retrying is in that list. So the
	/// retry was skipping precisely the records it had just selected: a no-op in its
	/// default configuration, invisible until scheduled jobs started firing at all.
	///
	/// This asserts the overlap that makes forcing mandatory. If someone widens
	/// `DEFAULT_RETRY_STATUSES` to something outside `SKIP_STATUSES` the assert simply
	/// stops applying to that entry; if someone drops the forcing, the two asserts below
	/// fail and point at this explanation.
	#[test]
	fn default_retry_statuses_require_forcing() {
		let overlapping = DEFAULT_RETRY_STATUSES
			.iter()
			.filter(|status| SKIP_STATUSES.contains(status))
			.count();
		assert_eq!(
			overlapping,
			DEFAULT_RETRY_STATUSES.len(),
			"every default retry status is one the fetch job skips, so the retry must \
			 force the re-fetch to have any effect"
		);

		assert!(
			MetadataFetchJobParams::retry_media(vec!["media-1".to_string()])
				.force_refetch,
			"a media retry that does not force is a no-op"
		);
		assert!(
			MetadataFetchJobParams::retry_series(vec!["series-1".to_string()])
				.force_refetch,
			"a series retry that does not force is a no-op"
		);
	}

	/// The non-retry constructors must keep respecting existing outcomes: a scan-driven
	/// fetch is not allowed to re-search a book that already has a match.
	#[test]
	fn ordinary_scopes_do_not_force() {
		assert!(!MetadataFetchJobParams::media(vec!["m".to_string()]).force_refetch);
		assert!(!MetadataFetchJobParams::series(vec!["s".to_string()]).force_refetch);
		assert!(
			!MetadataFetchJobParams::media_in_library("lib".to_string()).force_refetch
		);
		assert!(
			!MetadataFetchJobParams::series_in_library("lib".to_string()).force_refetch
		);
		assert!(
			!MetadataFetchJobParams::media_in_series("ser".to_string()).force_refetch
		);
	}

	/// Regression test for the drop-abort bug: `JobScheduler`'s `Drop` aborts
	/// every cron loop, so a caller that discards the handle (as the server once
	/// did) kills all scheduled jobs microseconds after boot. This proves a held
	/// scheduler actually fires.
	#[tokio::test]
	async fn held_scheduler_fires_scheduled_jobs() {
		let conn = Database::connect("sqlite::memory:")
			.await
			.expect("connects");
		Migrator::up(&conn, None).await.expect("migrates");

		scheduled_job::ActiveModel {
			name: Set("test calendar sync".to_string()),
			kind: Set(ScheduledJobKind::ReleaseCalendarSync),
			schedule: Set("* * * * * *".to_string()),
			enabled: Set(true),
			..Default::default()
		}
		.insert(&conn)
		.await
		.expect("job inserts");

		let ctx = Arc::new(crate::Ctx::for_testing(conn));
		let scheduler = JobScheduler::init(ctx.clone()).await.expect("inits");
		assert_eq!(scheduler.job_count(), 1);

		// The every-second cron fires within ~1s and the sweep is a no-op (no
		// provider configs), so `last_run_at` lands right after. Poll up to 5s.
		let mut fired = false;
		for _ in 0..50 {
			tokio::time::sleep(std::time::Duration::from_millis(100)).await;
			let job = scheduled_job::Entity::find()
				.one(ctx.conn.as_ref())
				.await
				.expect("queries")
				.expect("job exists");
			if job.last_run_at.is_some() {
				fired = true;
				break;
			}
		}
		drop(scheduler);

		assert!(fired, "cron loop never fired while the scheduler was held");
	}
}
