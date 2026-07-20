//! Background job that plans and/or applies loose-file organization.

use std::sync::Arc;

use async_graphql::SimpleObject;
use models::entity::{library, library_config, organize_plan_record};
use sea_orm::{prelude::*, ActiveValue::Set};
use serde::{Deserialize, Serialize};

use crate::filesystem::metadata::ProviderClientCache;
use crate::job::{
	error::JobError, JobContext, JobLifecycle, JobOutputExt, JobProgress, WorkingState,
};

use super::apply::{apply_plan, DecisionAction, OrganizeDecision};
use super::confirm::OrganizeBucket;
use super::plan::{build_plan, OrganizePlan};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum OrganizeMode {
	/// Build a preview and persist it; move nothing.
	Plan,
	/// Apply the given decisions.
	Apply { decisions: Vec<OrganizeDecision> },
	/// Cached-only plan + auto-apply of the Confident bucket (post-scan path).
	AutoScan,
}

#[derive(Clone, Serialize, Deserialize, Default, Debug, SimpleObject)]
#[serde(rename_all = "camelCase")]
pub struct OrganizeLooseFilesOutput {
	pub proposed_moves: u64,
	pub unmatched: u64,
	pub moved: u64,
	pub skipped: u64,
	pub failed: u64,
}

impl JobOutputExt for OrganizeLooseFilesOutput {}

pub struct OrganizeLooseFilesJob {
	pub library_id: String,
	pub mode: OrganizeMode,
	pub provider_cache: Option<Arc<ProviderClientCache>>,
}

impl OrganizeLooseFilesJob {
	pub fn new(library_id: String, mode: OrganizeMode) -> Self {
		Self {
			library_id,
			mode,
			provider_cache: None,
		}
	}

	async fn cache(
		&mut self,
		ctx: &JobContext,
	) -> Result<Arc<ProviderClientCache>, JobError> {
		if let Some(cache) = &self.provider_cache {
			return Ok(Arc::clone(cache));
		}
		let key = ctx.get_encryption_key().await?;
		let cache = Arc::new(ProviderClientCache::new(key));
		self.provider_cache = Some(Arc::clone(&cache));
		Ok(cache)
	}
}

async fn load_library(
	conn: &DatabaseConnection,
	library_id: &str,
) -> Result<(library::Model, library_config::Model), JobError> {
	let lib = library::Entity::find_by_id(library_id.to_owned())
		.one(conn)
		.await?
		.ok_or_else(|| JobError::Unknown("Library not found".to_string()))?;
	let config = library_config::Entity::find()
		.filter(library_config::Column::LibraryId.eq(library_id.to_owned()))
		.one(conn)
		.await?
		.ok_or_else(|| JobError::Unknown("Library config not found".to_string()))?;
	Ok((lib, config))
}

async fn persist_plan(
	conn: &DatabaseConnection,
	library_id: &str,
	status: &str,
	plan: &OrganizePlan,
) -> Result<(), JobError> {
	let plan_json = serde_json::to_string(plan)
		.map_err(|e| JobError::Unknown(format!("Failed to serialize plan: {e}")))?;
	// Replace any prior record for this library (latest-wins).
	organize_plan_record::Entity::delete_many()
		.filter(organize_plan_record::Column::LibraryId.eq(library_id.to_owned()))
		.exec(conn)
		.await?;
	organize_plan_record::ActiveModel {
		library_id: Set(library_id.to_owned()),
		status: Set(status.to_owned()),
		plan_json: Set(plan_json),
		..Default::default()
	}
	.insert(conn)
	.await?;
	Ok(())
}

#[async_trait::async_trait]
impl JobLifecycle for OrganizeLooseFilesJob {
	const NAME: &'static str = "organize_loose_files";
	type Output = OrganizeLooseFilesOutput;
	type Task = ();

	fn description(&self) -> Option<String> {
		Some(format!("Organize loose files: {}", self.library_id))
	}

	async fn init(
		&mut self,
		ctx: &JobContext,
	) -> Result<WorkingState<Self::Output, Self::Task>, JobError> {
		let conn = ctx.conn();
		let (lib, config) = load_library(conn, &self.library_id).await?;
		let cache = self.cache(ctx).await?;
		let mut output = OrganizeLooseFilesOutput::default();

		match self.mode.clone() {
			OrganizeMode::Plan => {
				ctx.report_progress(JobProgress::msg("Scanning for loose files"));
				let plan =
					build_plan(conn, &lib.id, &lib.path, &config, &cache, false).await?;
				output.proposed_moves = plan.proposed_moves.len() as u64;
				output.unmatched = plan.unmatched.len() as u64;
				persist_plan(conn, &lib.id, "AWAITING_REVIEW", &plan).await?;
			},
			OrganizeMode::AutoScan => {
				ctx.report_progress(JobProgress::msg(
					"Auto-organizing confident matches",
				));
				let plan =
					build_plan(conn, &lib.id, &lib.path, &config, &cache, true).await?;
				output.proposed_moves = plan.proposed_moves.len() as u64;
				output.unmatched = plan.unmatched.len() as u64;
				let decisions = plan
					.proposed_moves
					.iter()
					.filter(|m| m.bucket == OrganizeBucket::Confident)
					.map(|m| OrganizeDecision {
						src: m.src.clone(),
						action: DecisionAction::Move {
							series_id: m.existing_series_id.clone(),
							canonical_name: m.canonical_name.clone(),
							year: m.year,
							external_id: Some(m.external_id.clone()),
							provider: Some(m.provider.clone()),
						},
					})
					.collect::<Vec<_>>();
				let applied = apply_plan(conn, &lib.id, &lib.path, decisions).await?;
				output.moved = applied.moved;
				output.skipped = applied.skipped;
				output.failed = applied.failed;
				persist_plan(conn, &lib.id, "APPLIED", &plan).await?;
			},
			OrganizeMode::Apply { decisions } => {
				ctx.report_progress(JobProgress::msg("Applying organize decisions"));
				let applied = apply_plan(conn, &lib.id, &lib.path, decisions).await?;
				output.moved = applied.moved;
				output.skipped = applied.skipped;
				output.failed = applied.failed;
			},
		}

		Ok(WorkingState {
			output: Some(output),
			tasks: Default::default(),
			logs: vec![],
		})
	}

	async fn execute_task(
		&self,
		_ctx: &JobContext,
		_task: Self::Task,
	) -> Result<crate::job::JobTaskOutput<Self>, JobError> {
		// All work happens in init (Task = ()).
		Ok(crate::job::JobTaskOutput {
			output: OrganizeLooseFilesOutput::default(),
			subtasks: vec![],
			logs: vec![],
		})
	}
}
