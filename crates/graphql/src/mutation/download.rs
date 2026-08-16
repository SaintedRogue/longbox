use async_graphql::{Context, InputObject, Object, Result, SimpleObject, ID};
use chrono::Utc;
use longbox_core::{job::longbox_job::LongboxJob, plugin::search_downloads};
use models::entity::{
	download_queue::{self, DownloadStatus},
	series,
};
use plugin_integrations::{DownloadQuery, ReleaseFormat};
use sea_orm::{prelude::*, sea_query::OnConflict, ActiveValue::Set};

use crate::{
	data::CoreContext, guard::ServerOwnerGuard, query::download::DownloadQueueEntry,
};

/// A candidate offered by a plugin, with the plugin that offered it.
///
/// The origin travels with the candidate because a `downloadId` is opaque and only means
/// something to its author — enqueuing has to name both.
#[derive(SimpleObject)]
pub struct DownloadCandidateResult {
	pub plugin_slug: String,
	pub plugin_name: String,
	pub download_id: String,
	pub title: String,
	pub source: Option<String>,
	pub size_bytes: Option<i64>,
	pub confidence: Option<f64>,
}

#[derive(InputObject)]
pub struct EnqueueDownloadInput {
	pub plugin_slug: String,
	pub download_id: String,
	pub title: String,
	pub series_id: Option<ID>,
	pub source: Option<String>,
	pub number: Option<String>,
	pub size_bytes: Option<i64>,
	/// Queue it already approved, skipping the review step. The pull-list pass uses this
	/// when auto-grab is on; a person choosing from search results does not need to.
	#[graphql(default = false)]
	pub approve: bool,
}

#[derive(Default)]
pub struct DownloadMutation;

#[Object]
impl DownloadMutation {
	/// Ask every enabled download-source plugin what would satisfy a wanted issue.
	///
	/// Read-only: nothing is queued by searching. Results carry an opaque handle that
	/// `enqueueDownload` takes back, so a candidate can be considered without committing
	/// to it and without resolving an address that may be single-use.
	#[graphql(guard = "ServerOwnerGuard")]
	async fn search_downloads(
		&self,
		ctx: &Context<'_>,
		series_id: ID,
		number: Option<String>,
		#[graphql(default_with = "ReleaseFormat::Issue")] format: ReleaseFormat,
	) -> Result<Vec<DownloadCandidateResult>> {
		let core = ctx.data::<CoreContext>()?;

		let series = series::Entity::find_by_id(series_id.to_string())
			.one(core.conn.as_ref())
			.await?
			.ok_or_else(|| async_graphql::Error::new("Series not found"))?;

		let query = DownloadQuery {
			series_name: series.name.clone(),
			series_year: None,
			number,
			format,
			series_id: series.id.clone(),
		};

		Ok(search_downloads(core, &query)
			.await
			.map_err(|e| async_graphql::Error::new(e.to_string()))?
			.into_iter()
			.map(|found| DownloadCandidateResult {
				plugin_slug: found.plugin_slug,
				plugin_name: found.plugin_name,
				download_id: found.candidate.download_id,
				title: found.candidate.title,
				source: found.candidate.source,
				size_bytes: found.candidate.size_bytes.map(|b| b as i64),
				confidence: found.candidate.confidence.map(f64::from),
			})
			.collect())
	}

	/// Put a candidate on the queue.
	///
	/// Upserts on (plugin, download id) so offering the same file twice updates what is
	/// known about it rather than stacking duplicates — re-running a search is ordinary.
	#[graphql(guard = "ServerOwnerGuard")]
	async fn enqueue_download(
		&self,
		ctx: &Context<'_>,
		input: EnqueueDownloadInput,
	) -> Result<DownloadQueueEntry> {
		let core = ctx.data::<CoreContext>()?;
		let conn = core.conn.as_ref();

		let status = if input.approve {
			DownloadStatus::Approved
		} else {
			DownloadStatus::Pending
		};

		let active = download_queue::ActiveModel {
			series_id: Set(input.series_id.map(|id| id.to_string())),
			plugin_slug: Set(input.plugin_slug.clone()),
			download_id: Set(input.download_id.clone()),
			title: Set(input.title),
			source: Set(input.source),
			number: Set(input.number),
			size_bytes: Set(input.size_bytes),
			status: Set(status.as_str().to_string()),
			progress_bytes: Set(0),
			created_at: Set(Utc::now().into()),
			..Default::default()
		};

		download_queue::Entity::insert(active)
			.on_conflict(
				OnConflict::columns([
					download_queue::Column::PluginSlug,
					download_queue::Column::DownloadId,
				])
				.update_columns([
					download_queue::Column::Title,
					download_queue::Column::Source,
					download_queue::Column::Number,
					download_queue::Column::SizeBytes,
					download_queue::Column::SeriesId,
					download_queue::Column::Status,
				])
				.to_owned(),
			)
			.exec(conn)
			.await?;

		let row = download_queue::Entity::find()
			.filter(download_queue::Column::PluginSlug.eq(input.plugin_slug))
			.filter(download_queue::Column::DownloadId.eq(input.download_id))
			.one(conn)
			.await?
			.ok_or_else(|| {
				async_graphql::Error::new("Queue row vanished after insert")
			})?;

		Ok(DownloadQueueEntry::from(row))
	}

	/// Move a queue entry to a new state: approve it, cancel it, or send a failed one back
	/// to be retried.
	///
	/// Only states a person can meaningfully choose are accepted. `downloading` and
	/// `completed` are outcomes the worker reports, and letting them be set by hand would
	/// mean the queue could claim something happened that did not.
	#[graphql(guard = "ServerOwnerGuard")]
	async fn set_download_status(
		&self,
		ctx: &Context<'_>,
		id: i32,
		status: DownloadStatus,
	) -> Result<DownloadQueueEntry> {
		if !matches!(
			status,
			DownloadStatus::Approved
				| DownloadStatus::Cancelled
				| DownloadStatus::Pending
		) {
			return Err(async_graphql::Error::new(
				"Only approved, pending and cancelled can be set directly",
			));
		}

		let core = ctx.data::<CoreContext>()?;
		let conn = core.conn.as_ref();

		let row = download_queue::Entity::find_by_id(id)
			.one(conn)
			.await?
			.ok_or_else(|| async_graphql::Error::new("Download not found"))?;

		let updated = download_queue::ActiveModel {
			id: sea_orm::ActiveValue::Unchanged(row.id),
			status: Set(status.as_str().to_string()),
			// Re-approving after a failure should not keep showing why it failed last time.
			error: Set(None),
			updated_at: Set(Some(Utc::now().into())),
			..Default::default()
		}
		.update(conn)
		.await?;

		Ok(DownloadQueueEntry::from(updated))
	}

	/// Start a pass over everything approved.
	#[graphql(guard = "ServerOwnerGuard")]
	async fn run_download_queue(&self, ctx: &Context<'_>) -> Result<bool> {
		let core = ctx.data::<CoreContext>()?;
		core.enqueue(LongboxJob::download_queue()).await?;
		Ok(true)
	}

	/// Clear finished entries. Anything still in flight is left alone.
	#[graphql(guard = "ServerOwnerGuard")]
	async fn clear_finished_downloads(&self, ctx: &Context<'_>) -> Result<u64> {
		let core = ctx.data::<CoreContext>()?;
		let deleted = download_queue::Entity::delete_many()
			.filter(download_queue::Column::Status.is_in([
				DownloadStatus::Completed.as_str(),
				DownloadStatus::Failed.as_str(),
				DownloadStatus::Cancelled.as_str(),
			]))
			.exec(core.conn.as_ref())
			.await?;
		Ok(deleted.rows_affected)
	}
}
