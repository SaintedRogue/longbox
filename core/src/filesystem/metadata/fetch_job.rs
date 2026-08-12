use std::collections::{HashMap, VecDeque};
use std::sync::Arc;

use async_graphql::SimpleObject;
use metadata_integrations::{MatchCandidate, SearchQuery};
use models::{
	entity::{
		library_config, media, media_metadata, metadata_fetch_record,
		metadata_provider_config, series, series_metadata,
	},
	shared::enums::{LibraryType, MetadataFetchStatus},
};
use sea_orm::QuerySelect;
use sea_orm::{
	prelude::*,
	sea_query::{OnConflict, Query},
	Set,
};
use serde::{Deserialize, Serialize};

use crate::job::{
	error::JobError, JobContext, JobExecuteLog, JobLifecycle, JobOutputExt, JobProgress,
	JobTaskOutput, WorkingState,
};

use super::enrichment::{self, ApplyActor};
use super::{apply, ProviderClientCache};

type Id = String;

/// The scope of entities to fetch metadata for
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum MetadataFetchScope {
	MediaInLibrary(Id),
	/// Fetch metadata for specific series by ID
	Series(Vec<Id>),
	/// Fetch metadata for all series in a library
	SeriesInLibrary(Id),
	/// Fetch metadata for specific media items by ID
	Media(Vec<Id>),
	/// Fetch metadata for all media in a series
	MediaInSeries(Id),
}

/// Fetch-record statuses that mean "this entity already has an outcome", so a
/// non-forced job leaves it alone. **This list is the re-fetch policy** — there is no
/// other configuration for it, and every scope inherits it.
///
/// The consequence that is easy to miss: a job which deliberately *targets* one of
/// these statuses — the scheduled metadata retry does exactly that — must set
/// `force_refetch`, or it will skip precisely the records it was asked to retry. See
/// [`MetadataFetchJobParams::retry_media`].
pub const SKIP_STATUSES: [MetadataFetchStatus; 4] = [
	MetadataFetchStatus::AwaitingReview,
	MetadataFetchStatus::Fetched,
	MetadataFetchStatus::RateLimited,
	// A previous search found nothing. Retrying is worth doing *deliberately* — a
	// provider may have catalogued the book since — but not incidentally: a scan that
	// adds one file enqueues a library-wide fetch, and without this entry that walk
	// re-searches every unmatched book in the library against every enabled provider.
	// On a large library that is hundreds of requests triggered by a single dropped
	// file. The deliberate paths remain: the scheduled retry (configure it with
	// `NoMatch`), a forced re-fetch, or "Find match" on the book itself.
	MetadataFetchStatus::NoMatch,
];

/// Parameters for the metadata fetch job
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct MetadataFetchJobParams {
	pub scope: MetadataFetchScope,
	/// If true, will re-fetch metadata even if matches already exist
	pub force_refetch: bool,
}

impl MetadataFetchJobParams {
	pub fn new(scope: MetadataFetchScope, force_refetch: bool) -> Self {
		Self {
			scope,
			force_refetch,
		}
	}

	pub fn series(ids: Vec<Id>) -> Self {
		Self::new(MetadataFetchScope::Series(ids), false)
	}

	pub fn series_in_library(library_id: Id) -> Self {
		Self::new(MetadataFetchScope::SeriesInLibrary(library_id), false)
	}

	pub fn media(ids: Vec<Id>) -> Self {
		Self::new(MetadataFetchScope::Media(ids), false)
	}

	pub fn media_in_series(series_id: Id) -> Self {
		Self::new(MetadataFetchScope::MediaInSeries(series_id), false)
	}

	pub fn media_in_library(library_id: Id) -> Self {
		Self::new(MetadataFetchScope::MediaInLibrary(library_id), false)
	}

	/// Retry an explicit list of media whose fetch records the caller has already
	/// inspected — the scheduled metadata retry.
	///
	/// `force_refetch` is **not optional here**. A retry selects records *by status*,
	/// and the statuses worth retrying are the ones in [`SKIP_STATUSES`]; without
	/// forcing, the job skips every record the retry just asked it to revisit and the
	/// whole job is a no-op. Use [`media`](Self::media) for a scope that should respect
	/// existing outcomes.
	pub fn retry_media(ids: Vec<Id>) -> Self {
		Self::new(MetadataFetchScope::Media(ids), true)
	}

	/// [`retry_media`](Self::retry_media) for series.
	pub fn retry_series(ids: Vec<Id>) -> Self {
		Self::new(MetadataFetchScope::Series(ids), true)
	}
}

/// A single task for the metadata fetch job
#[derive(Serialize, Deserialize)]
pub enum MetadataFetchTask {
	/// Fetch metadata for a series
	FetchSeries {
		series_id: String,
		series_name: String,
		library_type: LibraryType,
		/// Whether this entity's library allows filling in providers that never
		/// answered. `serde(default)` so a job persisted before this field existed
		/// still deserializes, defaulting to the safe "don't".
		#[serde(default)]
		backfill_providers: bool,
	},
	/// Fetch metadata for a media item
	FetchMedia {
		media_id: String,
		media_name: String,
		series_name: Option<String>,
		library_type: LibraryType,
		/// See [`MetadataFetchTask::FetchSeries::backfill_providers`].
		#[serde(default)]
		backfill_providers: bool,
	},
}

#[derive(Clone, Serialize, Deserialize, Default, Debug, SimpleObject)]
#[serde(default, rename_all = "camelCase")]
pub struct MetadataFetchJobOutput {
	/// Total number of entities processed
	pub total_processed: u64,
	/// Number of entities where matches were found
	pub matches_found: u64,
	/// Number of entities where no matches were found
	pub no_matches: u64,
	/// Number of entities that were skipped (already have matches)
	pub skipped: u64,
	/// Number of entities that failed during fetch
	pub failed: u64,
	/// Number of entities that were auto-applied
	pub auto_applied: u64,
	/// Number of entities that were rate-limited
	pub rate_limited: u64,
}

impl JobOutputExt for MetadataFetchJobOutput {
	fn update(&mut self, updated: Self) {
		self.total_processed += updated.total_processed;
		self.matches_found += updated.matches_found;
		self.no_matches += updated.no_matches;
		self.skipped += updated.skipped;
		self.failed += updated.failed;
		self.auto_applied += updated.auto_applied;
		self.rate_limited += updated.rate_limited;
	}
}

/// The main job struct for fetching metadata
#[derive(Clone)]
pub struct MetadataFetchJob {
	pub params: MetadataFetchJobParams,
	pub provider_cache: Option<Arc<ProviderClientCache>>,
}

// Note: We won't persist the provider cache
impl Serialize for MetadataFetchJob {
	fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
	where
		S: serde::Serializer,
	{
		self.params.serialize(serializer)
	}
}

impl<'de> Deserialize<'de> for MetadataFetchJob {
	fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
	where
		D: serde::Deserializer<'de>,
	{
		let params = MetadataFetchJobParams::deserialize(deserializer)?;
		Ok(Self {
			params,
			provider_cache: None,
		})
	}
}

impl MetadataFetchJob {
	pub fn new(params: MetadataFetchJobParams) -> Self {
		Self {
			params,
			provider_cache: None,
		}
	}

	async fn get_or_init_cache(
		&mut self,
		ctx: &JobContext,
	) -> Result<Arc<ProviderClientCache>, JobError> {
		if let Some(cache) = &self.provider_cache {
			return Ok(Arc::clone(cache));
		}

		// The process-wide instance: sharing it keeps rate limiters, response
		// cache, and budget ledger unified across jobs and mutations.
		let cache = ctx.provider_cache();
		self.provider_cache = Some(Arc::clone(&cache));
		Ok(cache)
	}
}

#[async_trait::async_trait]
impl JobLifecycle for MetadataFetchJob {
	const NAME: &'static str = "metadata_fetch";

	type Output = MetadataFetchJobOutput;
	type Task = MetadataFetchTask;

	fn description(&self) -> Option<String> {
		match &self.params.scope {
			MetadataFetchScope::Series(ids) => {
				Some(format!("Metadata fetch for {} series", ids.len()))
			},
			MetadataFetchScope::SeriesInLibrary(id) => {
				Some(format!("Metadata fetch for series in library {}", id))
			},
			MetadataFetchScope::Media(ids) => {
				Some(format!("Metadata fetch for {} media items", ids.len()))
			},
			MetadataFetchScope::MediaInSeries(id) => {
				Some(format!("Metadata fetch for media in series {}", id))
			},
			MetadataFetchScope::MediaInLibrary(id) => {
				Some(format!("Metadata fetch for media in library {}", id))
			},
		}
	}

	async fn init(
		&mut self,
		ctx: &JobContext,
	) -> Result<WorkingState<Self::Output, Self::Task>, JobError> {
		let conn = ctx.conn();

		self.get_or_init_cache(ctx).await?;

		// TODO: This is terrible, media needs direct fk to library
		// TODO: The names should be entity.metadata.name.or(entity.name)
		let tasks: VecDeque<MetadataFetchTask> = match &self.params.scope {
			MetadataFetchScope::Series(ids) => {
				let series_list = series::Entity::find()
					.filter(series::Column::Id.is_in(ids.clone()))
					.all(conn)
					.await?;

				let unique_library_ids: Vec<String> = series_list
					.iter()
					.filter_map(|s| s.library_id.clone())
					.collect::<std::collections::HashSet<_>>()
					.into_iter()
					.collect();

				let mut library_map: HashMap<String, LibrarySettings> = HashMap::new();

				for library_id in &unique_library_ids {
					let settings = resolve_library_settings(conn, library_id).await?;
					library_map.insert(library_id.clone(), settings);
				}

				series_list
					.into_iter()
					.filter_map(|s| {
						let settings = s
							.library_id
							.as_ref()
							.and_then(|lid| library_map.get(lid))
							.copied()?;
						Some(MetadataFetchTask::FetchSeries {
							series_id: s.id,
							series_name: s.name,
							library_type: settings.library_type,
							backfill_providers: settings.backfill_providers,
						})
					})
					.collect()
			},
			MetadataFetchScope::SeriesInLibrary(library_id) => {
				let settings = resolve_library_settings(conn, library_id).await?;

				let series_list = series::Entity::find()
					.filter(series::Column::LibraryId.eq(library_id))
					.all(conn)
					.await?;

				series_list
					.into_iter()
					.map(|s| MetadataFetchTask::FetchSeries {
						series_id: s.id,
						series_name: s.name,
						library_type: settings.library_type,
						backfill_providers: settings.backfill_providers,
					})
					.collect()
			},
			MetadataFetchScope::Media(ids) => {
				let media_list = media::Entity::find()
					.filter(media::Column::Id.is_in(ids.clone()))
					.find_also_related(series::Entity)
					.all(conn)
					.await?;

				let unique_library_ids: Vec<String> = media_list
					.iter()
					.filter_map(|(_, s)| s.as_ref().and_then(|s| s.library_id.clone()))
					.collect::<std::collections::HashSet<_>>()
					.into_iter()
					.collect();

				let mut library_map: HashMap<String, LibrarySettings> = HashMap::new();

				for library_id in &unique_library_ids {
					let settings = resolve_library_settings(conn, library_id).await?;
					library_map.insert(library_id.clone(), settings);
				}

				media_list
					.into_iter()
					.filter_map(|(m, s)| {
						let settings = s
							.as_ref()
							.and_then(|s| s.library_id.as_ref())
							.and_then(|lid| library_map.get(lid))
							.copied()?;
						Some(MetadataFetchTask::FetchMedia {
							media_id: m.id,
							media_name: m.name,
							series_name: s.as_ref().map(|s| s.name.clone()),
							library_type: settings.library_type,
							backfill_providers: settings.backfill_providers,
						})
					})
					.collect()
			},
			MetadataFetchScope::MediaInSeries(series_id) => {
				let library_id = series::Entity::find_by_id(series_id)
					.select_only()
					.column(series::Column::LibraryId)
					.into_tuple::<String>()
					.one(conn)
					.await?
					.ok_or_else(|| {
						JobError::TaskFailed("Series not found".to_string())
					})?;
				let settings = resolve_library_settings(conn, &library_id).await?;

				let media_list = media::Entity::find()
					.filter(media::Column::SeriesId.eq(series_id))
					.find_also_related(series::Entity)
					.all(conn)
					.await?;

				media_list
					.into_iter()
					.map(|(m, s)| MetadataFetchTask::FetchMedia {
						media_id: m.id,
						media_name: m.name,
						series_name: s.map(|s| s.name),
						library_type: settings.library_type,
						backfill_providers: settings.backfill_providers,
					})
					.collect()
			},
			MetadataFetchScope::MediaInLibrary(library_id) => {
				let settings = resolve_library_settings(conn, library_id).await?;

				let media_list = media::Entity::find()
					.filter(
						media::Column::SeriesId.in_subquery(
							// TODO(perf): I think I just need to add a direct fk to library on media at this point
							// bc I do this way too often
							Query::select()
								.column(series::Column::Id)
								.from(series::Entity)
								.and_where(series::Column::LibraryId.eq(library_id))
								.to_owned(),
						),
					)
					.find_also_related(series::Entity)
					.all(conn)
					.await?;

				media_list
					.into_iter()
					.map(|(m, s)| MetadataFetchTask::FetchMedia {
						media_id: m.id,
						media_name: m.name,
						series_name: s.map(|s| s.name),
						library_type: settings.library_type,
						backfill_providers: settings.backfill_providers,
					})
					.collect()
			},
		};

		ctx.report_progress(JobProgress::msg(&format!(
			"Initialized metadata fetch with {} tasks",
			tasks.len()
		)));

		Ok(WorkingState {
			output: Some(Self::Output::default()),
			tasks,
			logs: vec![],
		})
	}

	async fn execute_task(
		&self,
		ctx: &JobContext,
		task: Self::Task,
	) -> Result<JobTaskOutput<Self>, JobError> {
		let conn = ctx.conn();
		let mut output = Self::Output::default();

		let provider_cache = self.provider_cache.as_ref().ok_or_else(|| {
			JobError::TaskFailed("Provider cache not initialized".to_string())
		})?;

		let all_provider_configs = metadata_provider_config::Entity::find()
			.filter(metadata_provider_config::Column::Enabled.eq(true))
			.all(conn)
			.await?;

		if all_provider_configs.is_empty() {
			tracing::warn!("No enabled metadata providers configured");
			return Ok(JobTaskOutput {
				output,
				logs: vec![],
				subtasks: vec![],
			});
		}

		let mut logs = vec![];

		// Budget gate: when every enabled provider's rolling window is exhausted,
		// firing more requests would only deepen the rate-limit hole. Mark the
		// entity RATE_LIMITED without any provider traffic — the scheduled
		// MetadataRetry job resumes it once the window rolls over.
		let runtime = provider_cache.runtime();
		let mut budget_states = Vec::with_capacity(all_provider_configs.len());
		for config in &all_provider_configs {
			let budget_id = super::provider_budget_id(&config.provider_type);
			budget_states.push((budget_id, runtime.budget_exhausted(budget_id).await));
		}
		if all_budgets_exhausted(&budget_states) {
			output.total_processed = 1;
			output.rate_limited = 1;
			let (series_id, media_id, conflict_column) = match &task {
				MetadataFetchTask::FetchSeries { series_id, .. } => (
					Some(series_id.clone()),
					None,
					metadata_fetch_record::Column::SeriesId,
				),
				MetadataFetchTask::FetchMedia { media_id, .. } => (
					None,
					Some(media_id.clone()),
					metadata_fetch_record::Column::MediaId,
				),
			};
			metadata_fetch_record::Entity::insert(metadata_fetch_record::ActiveModel {
				series_id: Set(series_id),
				media_id: Set(media_id),
				status: Set(MetadataFetchStatus::RateLimited),
				..Default::default()
			})
			.on_conflict(
				OnConflict::column(conflict_column)
					.update_columns([
						metadata_fetch_record::Column::Status,
						metadata_fetch_record::Column::UpdatedAt,
					])
					.to_owned(),
			)
			.exec(conn)
			.await?;
			logs.push(JobExecuteLog::warn(
				"Provider API budgets exhausted — deferred without spending requests; \
				 the scheduled metadata retry resumes this entity",
			));
			return Ok(JobTaskOutput {
				output,
				logs,
				subtasks: vec![],
			});
		}

		match task {
			MetadataFetchTask::FetchSeries {
				series_id,
				series_name,
				library_type,
				backfill_providers,
			} => {
				let mut provider_configs: Vec<_> = all_provider_configs
					.iter()
					.filter(|c| library_type.has_provider_overlap(&c.provider_type))
					.collect();

				if provider_configs.is_empty() {
					tracing::debug!(
						?library_type,
						"No compatible providers for this library type, skipping series"
					);
					output.total_processed = 1;
					output.skipped = 1;
					return Ok(JobTaskOutput {
						output,
						logs: vec![],
						subtasks: vec![],
					});
				}
				output.total_processed = 1;
				ctx.report_progress(JobProgress::msg_with_subtitle(
					"Fetching series metadata",
					&series_name,
				));

				// An entity that already has an outcome is left alone -- that is the
				// re-fetch policy and it stays. The one exception is backfill mode, where
				// the *entity* keeps its match but a provider that never answered may
				// still be asked. Nothing already linked is ever re-searched.
				if !self.params.force_refetch {
					let existing = metadata_fetch_record::Entity::find()
						.filter(metadata_fetch_record::Column::SeriesId.eq(&series_id))
						.filter(
							metadata_fetch_record::Column::Status.is_in(SKIP_STATUSES),
						)
						.one(conn)
						.await?;

					if existing.is_some() {
						if backfill_providers {
							let linked = enrichment::linked_providers(
								conn,
								enrichment::EnrichmentTarget::Series(&series_id),
							)
							.await?;
							provider_configs.retain(|config| {
								needs_backfill(&config.provider_type, &linked)
							});
							if provider_configs.is_empty() {
								tracing::trace!(
									series_id,
									"Backfill: every compatible provider is already linked"
								);
								output.skipped = 1;
								return Ok(JobTaskOutput {
									output,
									logs,
									subtasks: vec![],
								});
							}
							tracing::debug!(
								series_id,
								providers = provider_configs.len(),
								"Backfill: asking only the providers with no link yet"
							);
						} else {
							output.skipped = 1;
							return Ok(JobTaskOutput {
								output,
								logs,
								subtasks: vec![],
							});
						}
					}
				}

				let series_meta = series_metadata::Entity::find_by_id(&series_id)
					.one(conn)
					.await?;

				let mut all_candidates: Vec<MatchCandidate> = Vec::new();
				let mut was_rate_limited = false;

				for config in &provider_configs {
					match provider_cache.get_or_create(config).await {
						Ok(provider) => {
							let query = SearchQuery {
								title: series_name.clone(),
								series_year: series_meta.as_ref().and_then(|m| m.year),
								limit: Some(10),
								..Default::default()
							};

							match provider.search_series(&query).await {
								Ok(candidates) => {
									all_candidates.extend(candidates);
								},
								Err(e) if e.is_rate_limited() => {
									was_rate_limited = true;
									logs.push(JobExecuteLog::error(format!(
										"Rate limited by provider {:?} for series metadata",
										config.provider_type
									)));
									tracing::warn!(
										provider = ?config.provider_type,
										"Rate limited after retries for series metadata"
									);
								},
								Err(e) => {
									logs.push(JobExecuteLog::error(format!(
										"Failed to search provider for series metadata: {:?}",
										e
									)));
									tracing::error!(
										provider = ?config.provider_type,
										error = ?e,
										"Failed to search provider for series metadata"
									);
								},
							}
						},
						Err(e) => {
							logs.push(JobExecuteLog::error(format!(
								"Failed to get provider client: {:?}",
								e
							)));
							tracing::error!(
								provider = ?config.provider_type,
								error = ?e,
								"Failed to get provider client"
							);
						},
					}
				}

				let status = if was_rate_limited && all_candidates.is_empty() {
					output.rate_limited = 1;
					MetadataFetchStatus::RateLimited
				} else if all_candidates.is_empty() {
					output.no_matches = 1;
					MetadataFetchStatus::NoMatch
				} else {
					output.matches_found = 1;
					MetadataFetchStatus::AwaitingReview
				};

				let candidates_json = serde_json::to_value(&all_candidates)
					.map_err(|e| JobError::TaskFailed(e.to_string()))?;

				let active_model = metadata_fetch_record::ActiveModel {
					series_id: Set(Some(series_id.clone())),
					status: Set(status),
					match_candidates: Set(Some(candidates_json)),
					..Default::default()
				};

				metadata_fetch_record::Entity::insert(active_model)
					.on_conflict(
						OnConflict::column(metadata_fetch_record::Column::SeriesId)
							.update_columns([
								metadata_fetch_record::Column::Status,
								metadata_fetch_record::Column::MatchCandidates,
								metadata_fetch_record::Column::UpdatedAt,
							])
							.to_owned(),
					)
					.exec(conn)
					.await?;

				// See the media branch: the pool outlives this review's working set.
				enrichment::record_candidate_pool(
					conn,
					enrichment::EnrichmentTarget::Series(&series_id),
					&all_candidates,
				)
				.await?;

				if let Some((candidate, config)) = apply::find_auto_apply_candidate(
					&all_candidates,
					&all_provider_configs,
				) {
					// Collision guard: never silently bind an external id a
					// sibling series in this library already holds — leave the
					// record awaiting review instead (fail open on lookup error).
					let holder = apply::find_series_external_id_holder(
						conn,
						&series_id,
						&candidate.provider,
						&candidate.external_id,
					)
					.await
					.unwrap_or(None);
					if let Some(holder_id) = holder {
						logs.push(
							JobExecuteLog::warn(&format!(
								"Auto-apply skipped: series {holder_id} already holds {} id {} in this library — left awaiting review",
								candidate.provider, candidate.external_id
							))
							.with_ctx(format!("For {series_name}")),
						);
						tracing::warn!(
							series_id,
							holder_id,
							provider = candidate.provider,
							external_id = candidate.external_id,
							"External-id collision — auto-apply skipped"
						);
						return Ok(JobTaskOutput {
							output,
							logs,
							subtasks: vec![],
						});
					}
					tracing::info!(
						series_id,
						provider = candidate.provider,
						confidence = candidate.confidence,
						"Auto-applying series metadata match"
					);
					// Auto-apply has no reviewer to trigger the detail fetch, so the one
					// candidate being written is hydrated here.
					let candidate = apply::hydrate_candidate_for_apply(
						&candidate,
						&all_provider_configs,
						provider_cache,
						false,
					)
					.await;

					match apply::apply_series_match(
						conn,
						&series_id,
						&candidate,
						config.strategy,
						config.exclude_fields,
						vec![],
						ApplyActor::Auto,
					)
					.await
					{
						Ok(()) => output.auto_applied = 1,
						Err(e) => {
							logs.push(
								JobExecuteLog::error(format!(
									"Failed to auto-apply series metadata: {:?}",
									e
								))
								.with_ctx(format!("For {series_name}")),
							);
							tracing::error!(
								series_id,
								error = ?e,
								"Failed to auto-apply series metadata"
							);
						},
					}
				}
			},

			MetadataFetchTask::FetchMedia {
				media_id,
				media_name,
				library_type,
				backfill_providers,
				..
			} => {
				let mut provider_configs: Vec<_> = all_provider_configs
					.iter()
					.filter(|c| library_type.has_provider_overlap(&c.provider_type))
					.collect();

				if provider_configs.is_empty() {
					tracing::debug!(
						?library_type,
						"No compatible providers for this library type, skipping media"
					);
					output.total_processed = 1;
					output.skipped = 1;
					return Ok(JobTaskOutput {
						output,
						logs: vec![],
						subtasks: vec![],
					});
				}
				output.total_processed = 1;
				ctx.report_progress(JobProgress::msg_with_subtitle(
					"Fetching media metadata",
					&media_name,
				));

				// An entity that already has an outcome is left alone -- that is the
				// re-fetch policy and it stays. The one exception is backfill mode, where
				// the *entity* keeps its match but a provider that never answered may
				// still be asked. Nothing already linked is ever re-searched.
				if !self.params.force_refetch {
					let existing = metadata_fetch_record::Entity::find()
						.filter(metadata_fetch_record::Column::MediaId.eq(&media_id))
						.filter(
							metadata_fetch_record::Column::Status.is_in(SKIP_STATUSES),
						)
						.one(conn)
						.await?;

					if existing.is_some() {
						if backfill_providers {
							let linked = enrichment::linked_providers(
								conn,
								enrichment::EnrichmentTarget::Media(&media_id),
							)
							.await?;
							provider_configs.retain(|config| {
								needs_backfill(&config.provider_type, &linked)
							});
							if provider_configs.is_empty() {
								tracing::trace!(
									media_id,
									"Backfill: every compatible provider is already linked"
								);
								output.skipped = 1;
								return Ok(JobTaskOutput {
									output,
									logs,
									subtasks: vec![],
								});
							}
							tracing::debug!(
								media_id,
								providers = provider_configs.len(),
								"Backfill: asking only the providers with no link yet"
							);
						} else {
							output.skipped = 1;
							return Ok(JobTaskOutput {
								output,
								logs: vec![],
								subtasks: vec![],
							});
						}
					}
				}

				let metadata = media_metadata::Entity::find()
					.filter(media_metadata::Column::MediaId.eq(&media_id))
					.one(conn)
					.await?;

				let mut all_candidates: Vec<MatchCandidate> = Vec::new();
				let mut was_rate_limited = false;

				for config in &provider_configs {
					match provider_cache.get_or_create(config).await {
						Ok(provider) => {
							// Note: `year` here is the *issue's own* year
							// (media_metadata.year), not the series' start year —
							// providers should treat it as a per-issue disambiguation
							// signal. `series_year` is intentionally left unpopulated:
							// `MetadataFetchTask::FetchMedia` doesn't carry a series_id,
							// so getting series_metadata.year would require a new
							// query/join that isn't already at hand here.
							let mut query = SearchQuery {
								title: media_name.clone(),
								series_name: metadata
									.as_ref()
									.and_then(|m| m.series.clone()),
								number: metadata
									.as_ref()
									.and_then(|m| m.number)
									.map(|n| n.normalize().to_string()),
								publisher: metadata
									.as_ref()
									.and_then(|m| m.publisher.clone()),
								year: metadata.as_ref().and_then(|m| m.year),
								comicvine_id: metadata
									.as_ref()
									.and_then(|m| m.comicvine_id.clone()),
								metron_id: metadata
									.as_ref()
									.and_then(|m| m.metron_id.clone()),
								limit: Some(10),
								..Default::default()
							};
							// Filename fallback for filename-only libraries (see
							// fetch::fill_query_from_filename).
							super::fetch::fill_query_from_filename(&mut query);

							match provider.search_media(&query).await {
								Ok(candidates) => {
									all_candidates.extend(candidates);
								},
								Err(e) if e.is_rate_limited() => {
									was_rate_limited = true;
									logs.push(JobExecuteLog::error(format!(
										"Rate limited by provider {:?} for media metadata",
										config.provider_type
									)));
									tracing::warn!(
										provider = ?config.provider_type,
										"Rate limited after retries for media metadata"
									);
								},
								Err(e) => {
									tracing::error!(
										provider = ?config.provider_type,
										error = ?e,
										"Failed to search provider for media metadata"
									);
								},
							}
						},
						Err(e) => {
							tracing::error!(
								provider = ?config.provider_type,
								error = ?e,
								"Failed to get provider client"
							);
						},
					}
				}

				let status = if was_rate_limited && all_candidates.is_empty() {
					output.rate_limited = 1;
					MetadataFetchStatus::RateLimited
				} else if all_candidates.is_empty() {
					output.no_matches = 1;
					MetadataFetchStatus::NoMatch
				} else {
					output.matches_found = 1;
					MetadataFetchStatus::AwaitingReview
				};

				let candidates_json = serde_json::to_value(&all_candidates)
					.map_err(|e| JobError::TaskFailed(e.to_string()))?;

				let active_model = metadata_fetch_record::ActiveModel {
					media_id: Set(Some(media_id.clone())),
					status: Set(status),
					match_candidates: Set(Some(candidates_json)),
					..Default::default()
				};

				metadata_fetch_record::Entity::insert(active_model)
					.on_conflict(
						OnConflict::column(metadata_fetch_record::Column::MediaId)
							.update_columns([
								metadata_fetch_record::Column::Status,
								metadata_fetch_record::Column::MatchCandidates,
								metadata_fetch_record::Column::UpdatedAt,
							])
							.to_owned(),
					)
					.exec(conn)
					.await?;

				// Keep each provider's best answer in the pool, whether or not anything is
				// applied below. `match_candidates` above is this review's working set and
				// is overwritten by the next fetch; the pool is what lets the review grid
				// show LOCG's fields beside ComicVine's later on.
				enrichment::record_candidate_pool(
					conn,
					enrichment::EnrichmentTarget::Media(&media_id),
					&all_candidates,
				)
				.await?;

				if let Some((candidate, config)) = apply::find_auto_apply_candidate(
					&all_candidates,
					&all_provider_configs,
				) {
					// Collision guard: see the series branch above.
					let holder = apply::find_media_external_id_holder(
						conn,
						&media_id,
						&candidate.provider,
						&candidate.external_id,
					)
					.await
					.unwrap_or(None);
					if let Some(holder_id) = holder {
						logs.push(
							JobExecuteLog::warn(&format!(
								"Auto-apply skipped: media {holder_id} already holds {} id {} in this library — left awaiting review",
								candidate.provider, candidate.external_id
							))
							.with_ctx(format!("For {media_name}")),
						);
						tracing::warn!(
							media_id,
							holder_id,
							provider = candidate.provider,
							external_id = candidate.external_id,
							"External-id collision — auto-apply skipped"
						);
						return Ok(JobTaskOutput {
							output,
							logs,
							subtasks: vec![],
						});
					}
					tracing::info!(
						media_id,
						provider = candidate.provider,
						confidence = candidate.confidence,
						"Auto-applying media metadata match"
					);
					// See the series branch: hydrate before writing.
					let candidate = apply::hydrate_candidate_for_apply(
						&candidate,
						&all_provider_configs,
						provider_cache,
						true,
					)
					.await;

					match apply::apply_media_match(
						conn,
						&media_id,
						&candidate,
						config.strategy,
						config.exclude_fields,
						vec![],
						ApplyActor::Auto,
					)
					.await
					{
						Ok(()) => output.auto_applied = 1,
						Err(e) => {
							logs.push(
								JobExecuteLog::error(format!(
									"Failed to auto-apply media metadata: {:?}",
									e
								))
								.with_ctx(format!("For {media_name}")),
							);
							tracing::error!(
								media_id,
								error = ?e,
								"Failed to auto-apply media metadata"
							);
						},
					}
				}
			},
		}

		Ok(JobTaskOutput {
			output,
			logs,
			subtasks: vec![],
		})
	}
}

/// True when every enabled provider's budget window is exhausted — the only
/// situation where deferring the whole task beats trying. A single provider
/// with headroom (including budget-free providers like Hardcover, which are
/// never exhausted) keeps the task running.
fn all_budgets_exhausted(states: &[(&'static str, bool)]) -> bool {
	!states.is_empty() && states.iter().all(|(_, exhausted)| *exhausted)
}

/// Whether a provider still has to be asked when backfilling.
///
/// The comparison is against [`MetadataProvider::provider_id`] — the lowercase trait id
/// (`comicvine`) — and **not** `to_string()`, which yields the SCREAMING_SNAKE form
/// (`COMIC_VINE`) used for the DB column and the GraphQL enum. Link rows store the trait
/// id, so comparing the wrong one silently matches nothing and re-asks every provider.
fn needs_backfill(
	provider: &models::shared::enums::MetadataProvider,
	linked: &[String],
) -> bool {
	!linked
		.iter()
		.any(|candidate| candidate == provider.provider_id())
}

/// The per-library settings a fetch task needs to carry.
///
/// Both come from `library_configs`, and both are decided per library rather than per
/// job, so a scope spanning libraries has to look them up per entity.
#[derive(Debug, Clone, Copy)]
struct LibrarySettings {
	library_type: LibraryType,
	/// See `library_config.metadata_backfill_providers`.
	backfill_providers: bool,
}

async fn resolve_library_settings(
	conn: &DatabaseConnection,
	library_id: &str,
) -> Result<LibrarySettings, JobError> {
	let config = library_config::Entity::find()
		.filter(library_config::Column::LibraryId.eq(library_id))
		.one(conn)
		.await
		.map_err(|e| JobError::InitFailed(e.to_string()))?
		.ok_or_else(|| {
			JobError::InitFailed(format!(
				"Library config not found for library {library_id}"
			))
		})?;

	Ok(LibrarySettings {
		library_type: config.library_type,
		backfill_providers: config.metadata_backfill_providers,
	})
}

#[cfg(test)]
mod tests {
	use super::{
		all_budgets_exhausted, needs_backfill, MetadataFetchJobParams,
		MetadataFetchStatus, SKIP_STATUSES,
	};

	#[test]
	fn defers_only_when_every_provider_is_exhausted() {
		// All exhausted → defer.
		assert!(all_budgets_exhausted(&[
			("comicvine", true),
			("metron", true)
		]));
		// Any provider with headroom keeps the task running.
		assert!(!all_budgets_exhausted(&[
			("comicvine", true),
			("metron", false)
		]));
		// Budget-free providers (hardcover) are never exhausted → never defer.
		assert!(!all_budgets_exhausted(&[
			("comicvine", true),
			("hardcover", false)
		]));
		// No providers at all is handled upstream; the gate must not fire.
		assert!(!all_budgets_exhausted(&[]));
	}

	/// The id spellings that must not be confused. `provider_id()` is what link rows
	/// store; `to_string()` is the DB/GraphQL enum form. Comparing the latter matches
	/// nothing, which in backfill mode means re-asking every provider that had already
	/// answered -- exactly what the mode exists to avoid.
	#[test]
	fn backfill_compares_the_provider_trait_id() {
		use models::shared::enums::MetadataProvider;

		let linked = vec!["comicvine".to_string()];
		assert!(
			!needs_backfill(&MetadataProvider::ComicVine, &linked),
			"a linked provider must not be asked again"
		);
		assert!(
			needs_backfill(&MetadataProvider::Locg, &linked),
			"a provider that never answered still gets its chance"
		);

		// The trap, spelled out: the enum's Display form is not what is stored.
		assert_eq!(MetadataProvider::ComicVine.provider_id(), "comicvine");
		assert_eq!(MetadataProvider::ComicVine.to_string(), "COMIC_VINE");
		assert!(
			needs_backfill(&MetadataProvider::ComicVine, &["COMIC_VINE".to_string()]),
			"a Display-form value does not match, which is why the helper exists"
		);
	}

	/// Regression test for scan amplification.
	///
	/// A scan that creates any media enqueues a library-wide metadata fetch. While
	/// `NoMatch` was absent from `SKIP_STATUSES`, that walk re-searched every
	/// previously-unmatched book in the library against every enabled provider -- so
	/// adding one file to a large library cost hundreds of provider requests, none of
	/// which anyone asked for.
	///
	/// The three assertions together are the behaviour: a scan-driven scope does not
	/// force, `NoMatch` is skipped when not forcing, and the deliberate retry path still
	/// reaches those records because it does force.
	#[test]
	fn a_scan_does_not_re_search_the_unmatched_backlog() {
		assert!(
			SKIP_STATUSES.contains(&MetadataFetchStatus::NoMatch),
			"an unmatched book must not be re-searched by an incidental library walk"
		);

		for params in [
			MetadataFetchJobParams::media_in_library("lib".to_string()),
			MetadataFetchJobParams::series_in_library("lib".to_string()),
		] {
			assert!(
				!params.force_refetch,
				"scan-driven scopes must not force, or the skip list is bypassed anyway"
			);
		}

		assert!(
			MetadataFetchJobParams::retry_media(vec!["m".to_string()]).force_refetch,
			"a deliberate retry must still be able to revisit a NoMatch record"
		);
	}
}
