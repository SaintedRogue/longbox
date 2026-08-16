use async_graphql::{Context, Object, Result, SimpleObject, ID};
use models::entity::download_queue::{self, DownloadStatus};
use sea_orm::{prelude::*, QueryOrder};

use crate::{data::CoreContext, guard::ServerOwnerGuard};

/// One entry in the download queue, as the UI sees it.
///
/// A shaped object rather than the raw model: `status` is exposed as an enum so a client
/// cannot receive a string it has no case for, and the internal staging path stays server
/// side, since it names a location on the host that no browser has any use for.
#[derive(SimpleObject)]
pub struct DownloadQueueEntry {
	pub id: i32,
	pub series_id: Option<ID>,
	pub media_id: Option<ID>,
	/// Which plugin offered this file. Shown so a queue with several sources is legible.
	pub plugin_slug: String,
	pub title: String,
	pub source: Option<String>,
	pub number: Option<String>,
	/// `None` when the stored value is one this build does not recognise — a row written by
	/// a newer version is displayed rather than hidden.
	pub status: Option<DownloadStatus>,
	/// Total size when the source declared one. Absent is common and not an error.
	pub size_bytes: Option<i64>,
	pub progress_bytes: i64,
	pub error: Option<String>,
	pub created_at: String,
}

impl From<download_queue::Model> for DownloadQueueEntry {
	fn from(row: download_queue::Model) -> Self {
		Self {
			id: row.id,
			status: row.download_status(),
			series_id: row.series_id.map(ID::from),
			media_id: row.media_id.map(ID::from),
			plugin_slug: row.plugin_slug,
			title: row.title,
			source: row.source,
			number: row.number,
			size_bytes: row.size_bytes,
			progress_bytes: row.progress_bytes,
			error: row.error,
			created_at: row.created_at.to_rfc3339(),
		}
	}
}

#[derive(Default)]
pub struct DownloadQuery;

#[Object]
impl DownloadQuery {
	/// The download queue, newest first.
	///
	/// Server-owner only for the same reason plugins are: a download writes a file into a
	/// library from a source the operator chose, so who may see and drive that set is the
	/// same question as who may administer the server.
	#[graphql(guard = "ServerOwnerGuard")]
	async fn download_queue(
		&self,
		ctx: &Context<'_>,
		#[graphql(desc = "Restrict to these states. Omitted returns everything.")]
		status: Option<Vec<DownloadStatus>>,
	) -> Result<Vec<DownloadQueueEntry>> {
		let core = ctx.data::<CoreContext>()?;

		let mut query = download_queue::Entity::find();
		if let Some(wanted) = status.filter(|s| !s.is_empty()) {
			let values: Vec<String> =
				wanted.into_iter().map(|s| s.as_str().to_string()).collect();
			query = query.filter(download_queue::Column::Status.is_in(values));
		}

		Ok(query
			.order_by_desc(download_queue::Column::CreatedAt)
			.order_by_desc(download_queue::Column::Id)
			.all(core.conn.as_ref())
			.await?
			.into_iter()
			.map(DownloadQueueEntry::from)
			.collect())
	}
}
