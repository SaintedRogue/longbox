use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

use crate::shared::enums::{MetadataFetchStatus, ScheduledJobKind};

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq, Serialize, Deserialize)]
#[sea_orm(table_name = "scheduled_jobs")]
pub struct Model {
	#[sea_orm(primary_key, auto_increment = true)]
	pub id: i32,
	#[sea_orm(column_type = "Text")]
	pub name: String,
	pub kind: ScheduledJobKind,
	/// A cron expression (e.g. "0 0 * * *" for daily at midnight)
	#[sea_orm(column_type = "Text")]
	pub schedule: String,
	#[sea_orm(column_type = "Json", nullable)]
	pub config: Option<serde_json::Value>,
	pub enabled: bool,
	pub created_at: DateTimeUtc,
	pub last_run_at: Option<DateTimeUtc>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}

/// Configuration for a library scan scheduled job
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryScanConfig {
	/// The library IDs to scan. An empty vec is treated as "all libraries"
	pub library_ids: Vec<String>,
}

/// Configuration for a metadata retry scheduled job
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MetadataRetryConfig {
	/// Which statuses to retry
	pub statuses: Vec<MetadataFetchStatus>,
}

/// Configuration for a release-calendar sync scheduled job
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseCalendarConfig {
	/// Sweep ComicVine's store-date window (default on).
	#[serde(default = "default_true")]
	pub comicvine_enabled: bool,
	/// Sweep Metron's store-date window. Default OFF: the endpoint shape is
	/// unverified from this deployment's egress (firewall ban) — enable only
	/// after a live test.
	#[serde(default)]
	pub metron_enabled: bool,
	/// Sweep League of Comic Geeks' weekly release lists. Default OFF: LOCG is an
	/// unofficial provider gated behind
	/// `server_config.unofficial_providers_acknowledged_at`, so sweeping it is
	/// always an explicit opt-in.
	#[serde(default)]
	pub locg_enabled: bool,
}

/// Configuration for the pull-list download sweep
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadSweepConfig {
	/// Queue findings already approved instead of holding them for review.
	///
	/// Default OFF, and deliberately so: a confident wrong match that downloads on its own
	/// is far more annoying to undo than one that waits to be looked at. This mirrors the
	/// metadata auto-apply threshold — something you turn on once you trust the results.
	#[serde(default)]
	pub auto_approve: bool,
	/// Upper bound on how many issues one pass will search for.
	///
	/// A first run against a large pull list would otherwise ask every enabled plugin
	/// about hundreds of issues at once, which is slow for us and rude to whatever the
	/// plugin talks to. The remainder is picked up by the next run.
	#[serde(default = "default_sweep_limit")]
	pub max_per_run: usize,
}

fn default_sweep_limit() -> usize {
	25
}

impl Default for DownloadSweepConfig {
	fn default() -> Self {
		Self {
			auto_approve: false,
			max_per_run: default_sweep_limit(),
		}
	}
}

fn default_true() -> bool {
	true
}

impl Default for ReleaseCalendarConfig {
	fn default() -> Self {
		Self {
			comicvine_enabled: true,
			metron_enabled: false,
			locg_enabled: false,
		}
	}
}

impl Model {
	pub fn library_scan_config(&self) -> Option<LibraryScanConfig> {
		self.config
			.as_ref()
			.and_then(|v| serde_json::from_value(v.clone()).ok())
	}

	pub fn metadata_retry_config(&self) -> Option<MetadataRetryConfig> {
		self.config
			.as_ref()
			.and_then(|v| serde_json::from_value(v.clone()).ok())
	}

	/// Missing/invalid config falls back to the safe default (CV on, Metron off).
	pub fn release_calendar_config(&self) -> ReleaseCalendarConfig {
		self.config
			.as_ref()
			.and_then(|v| serde_json::from_value(v.clone()).ok())
			.unwrap_or_default()
	}

	/// Missing or unreadable config falls back to the cautious default: find things, but
	/// do not download them without being asked.
	pub fn download_sweep_config(&self) -> DownloadSweepConfig {
		self.config
			.as_ref()
			.and_then(|v| serde_json::from_value(v.clone()).ok())
			.unwrap_or_default()
	}
}
