use async_graphql::SimpleObject;
use sea_orm::{prelude::*, DeriveEntityModel};

/// One file Longbox has been asked to fetch.
///
/// Persisted rather than held in memory because downloads are long and a restart is
/// ordinary: a queue that lived in the process would lose its contents exactly when losing
/// them costs the most.
#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq, SimpleObject)]
#[graphql(name = "DownloadQueueModel")]
#[sea_orm(table_name = "download_queue")]
pub struct Model {
	#[sea_orm(primary_key, auto_increment = true)]
	pub id: i32,
	/// The series this is wanted for, when there is one. `None` covers the case that makes
	/// searching worth doing: a book the library does not have yet.
	pub series_id: Option<String>,
	/// Set once the finished file has been imported, so a queue row can be traced to the
	/// book it became.
	pub media_id: Option<String>,
	/// Which plugin offered this file.
	pub plugin_slug: String,
	/// That plugin's opaque handle for it. Never parsed here; only ever handed back.
	pub download_id: String,
	/// Display fields, captured at search time so the queue still reads sensibly when the
	/// plugin that produced it is disabled or removed.
	pub title: String,
	pub source: Option<String>,
	pub number: Option<String>,
	pub format: Option<String>,
	pub size_bytes: Option<i64>,
	pub status: String,
	pub progress_bytes: i64,
	/// Where the partial file is being written, so an interrupted download can be cleaned
	/// up rather than left occupying the disk.
	pub staging_path: Option<String>,
	pub error: Option<String>,
	#[sea_orm(column_type = "custom(\"DATETIME\")")]
	pub created_at: DateTimeWithTimeZone,
	#[sea_orm(column_type = "custom(\"DATETIME\")", nullable)]
	pub updated_at: Option<DateTimeWithTimeZone>,
}

/// Where a queued download has got to.
///
/// Text in the database rather than a closed enum, so a value written by a newer build
/// reads as "not a state this build acts on" instead of failing the query that loaded it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, async_graphql::Enum)]
pub enum DownloadStatus {
	/// Found and waiting for someone to approve it. The default, because choosing to
	/// download something is a decision; auto-grab is the opt-in that skips it.
	Pending,
	/// Approved and waiting for a worker.
	Approved,
	Downloading,
	Completed,
	Failed,
	Cancelled,
}

impl DownloadStatus {
	pub fn as_str(self) -> &'static str {
		match self {
			Self::Pending => "pending",
			Self::Approved => "approved",
			Self::Downloading => "downloading",
			Self::Completed => "completed",
			Self::Failed => "failed",
			Self::Cancelled => "cancelled",
		}
	}

	pub fn parse(raw: &str) -> Option<Self> {
		Some(match raw {
			"pending" => Self::Pending,
			"approved" => Self::Approved,
			"downloading" => Self::Downloading,
			"completed" => Self::Completed,
			"failed" => Self::Failed,
			"cancelled" => Self::Cancelled,
			_ => return None,
		})
	}

	/// Whether this state can still change on its own. Used to decide what a restart should
	/// clean up, and what the UI should keep polling.
	pub fn is_terminal(self) -> bool {
		matches!(self, Self::Completed | Self::Failed | Self::Cancelled)
	}
}

impl Model {
	pub fn download_status(&self) -> Option<DownloadStatus> {
		DownloadStatus::parse(&self.status)
	}
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
	#[sea_orm(
		belongs_to = "super::series::Entity",
		from = "Column::SeriesId",
		to = "super::series::Column::Id"
	)]
	Series,
	#[sea_orm(
		belongs_to = "super::media::Entity",
		from = "Column::MediaId",
		to = "super::media::Column::Id"
	)]
	Media,
}

impl ActiveModelBehavior for ActiveModel {}
