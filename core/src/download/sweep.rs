//! The pull-list pass: find files for issues you follow but do not have.
//!
//! Everything this needs already exists. The calendar knows what is expected, follows say
//! which series matter, and "in library" is issue-number agreement against the series'
//! books — the same comparison the calendar itself renders. So this joins those three and
//! asks the download sources about the difference.

use std::collections::{HashMap, HashSet};

use chrono::{Duration, Utc};
use metadata_integrations::issue_numbers_match;
use models::entity::{
	download_queue, media, media_metadata, release_calendar_entry, scheduled_job, series,
	series_follow,
};
use plugin_integrations::{DownloadQuery, ReleaseFormat};
use sea_orm::{prelude::*, sea_query::OnConflict, ActiveValue::Set, QueryFilter};

use crate::{job::longbox_job::LongboxJob, plugin::search_downloads, CoreResult, Ctx};

/// How far back a missing issue is still worth chasing.
///
/// A pull list is about keeping up, not about filling a back catalogue: without a bound,
/// the first run would ask every source about every issue the calendar has ever recorded.
const LOOKBACK_DAYS: i64 = 60;
/// How far ahead to bother looking. Something not out yet cannot be downloaded.
const LOOKAHEAD_DAYS: i64 = 1;

#[derive(Debug, Default, PartialEq, Eq)]
pub struct DownloadSweepSummary {
	/// Issues that were expected, followed, and absent.
	pub wanted: usize,
	/// Of those, the ones some source offered a file for.
	pub found: usize,
	/// Rows added to the queue.
	pub queued: usize,
}

/// A scheduled pull-list pass.
pub async fn run_download_sweep(
	job: &scheduled_job::Model,
	ctx: &Ctx,
) -> CoreResult<DownloadSweepSummary> {
	sweep(job.download_sweep_config(), ctx).await
}

/// Issue numbers already owned, per series.
async fn owned_numbers(
	ctx: &Ctx,
	series_ids: &[String],
) -> CoreResult<HashMap<String, Vec<String>>> {
	let conn = ctx.conn.as_ref();
	let mut owned: HashMap<String, Vec<String>> = HashMap::new();
	if series_ids.is_empty() {
		return Ok(owned);
	}

	let books = media::Entity::find()
		.filter(media::Column::SeriesId.is_in(series_ids.to_vec()))
		.filter(media::Column::DeletedAt.is_null())
		.all(conn)
		.await?;
	let series_by_media: HashMap<String, String> = books
		.iter()
		.filter_map(|b| b.series_id.clone().map(|s| (b.id.clone(), s)))
		.collect();

	let media_ids: Vec<String> = books.into_iter().map(|b| b.id).collect();
	for row in media_metadata::Entity::find()
		.filter(media_metadata::Column::MediaId.is_in(media_ids))
		.all(conn)
		.await?
	{
		let (Some(media_id), Some(number)) = (row.media_id, row.number) else {
			continue;
		};
		if let Some(series_id) = series_by_media.get(&media_id) {
			owned
				.entry(series_id.clone())
				.or_default()
				.push(number.normalize().to_string());
		}
	}

	Ok(owned)
}

/// Rank a plugin's offers for one wanted issue and take the best.
///
/// Ranking is deliberately modest. The plugin knows its own source and says so through
/// `confidence`; what Longbox can add is whether the issue number it was actually asked
/// for appears in the title, which catches a source answering with the wrong issue of the
/// right series — the failure mode a person would notice immediately and a size-based
/// heuristic never would.
fn best_candidate(
	wanted_number: Option<&str>,
	candidates: Vec<crate::plugin::SourcedCandidate>,
) -> Option<crate::plugin::SourcedCandidate> {
	candidates.into_iter().max_by(|a, b| {
		let number_agrees = |c: &crate::plugin::SourcedCandidate| {
			wanted_number.is_some_and(|wanted| {
				c.candidate.title.split_whitespace().any(|token| {
					issue_numbers_match(token.trim_start_matches('#'), wanted)
				})
			})
		};

		number_agrees(a)
			.cmp(&number_agrees(b))
			.then_with(|| {
				a.candidate
					.confidence
					.unwrap_or(0.0)
					.total_cmp(&b.candidate.confidence.unwrap_or(0.0))
			})
			.then_with(|| a.candidate.size_bytes.cmp(&b.candidate.size_bytes))
	})
}

async fn sweep(
	config: scheduled_job::DownloadSweepConfig,
	ctx: &Ctx,
) -> CoreResult<DownloadSweepSummary> {
	let conn = ctx.conn.as_ref();
	let mut summary = DownloadSweepSummary::default();

	// Only followed series. A pull list is the set someone said they care about, and
	// describing the whole library to a third-party plugin would be both enormous and a
	// good deal more of the operator's data than the job needs.
	let followed: HashSet<String> = series_follow::Entity::find()
		.all(conn)
		.await?
		.into_iter()
		.map(|f| f.series_id)
		.collect();
	if followed.is_empty() {
		tracing::info!("Download sweep: nobody follows a series yet");
		return Ok(summary);
	}

	let series_ids: Vec<String> = followed.iter().cloned().collect();
	let today = Utc::now().date_naive();
	let start = (today - Duration::days(LOOKBACK_DAYS)).to_string();
	let end = (today + Duration::days(LOOKAHEAD_DAYS)).to_string();

	let expected = release_calendar_entry::Entity::find()
		.filter(release_calendar_entry::Column::SeriesId.is_in(series_ids.clone()))
		.filter(release_calendar_entry::Column::ReleaseDate.gte(start))
		.filter(release_calendar_entry::Column::ReleaseDate.lte(end))
		.all(conn)
		.await?;

	let owned = owned_numbers(ctx, &series_ids).await?;
	let names: HashMap<String, series::Model> = series::Entity::find()
		.filter(series::Column::Id.is_in(series_ids))
		.all(conn)
		.await?
		.into_iter()
		.map(|s| (s.id.clone(), s))
		.collect();

	// Anything already on the queue is left alone, whatever state it is in: re-offering a
	// download someone cancelled would be the queue arguing with them.
	let queued: HashSet<(String, String)> = download_queue::Entity::find()
		.all(conn)
		.await?
		.into_iter()
		.filter_map(|row| row.series_id.map(|s| (s, row.number.unwrap_or_default())))
		.collect();

	for entry in expected {
		if summary.wanted >= config.max_per_run {
			tracing::info!(
				limit = config.max_per_run,
				"Download sweep hit its per-run limit; the rest waits for the next pass"
			);
			break;
		}

		let Some(series_id) = entry.series_id.clone() else {
			continue;
		};
		let Some(series) = names.get(&series_id) else {
			continue;
		};

		let number = entry.number.clone();
		let already_owned = number.as_deref().is_some_and(|wanted| {
			owned
				.get(&series_id)
				.is_some_and(|have| have.iter().any(|n| issue_numbers_match(n, wanted)))
		});
		if already_owned {
			continue;
		}
		if queued.contains(&(series_id.clone(), number.clone().unwrap_or_default())) {
			continue;
		}

		summary.wanted += 1;

		let query = DownloadQuery {
			series_name: series.name.clone(),
			series_year: None,
			number: number.clone(),
			format: ReleaseFormat::Issue,
			series_id: series_id.clone(),
		};

		let candidates = match search_downloads(ctx, &query).await {
			Ok(found) => found,
			Err(error) => {
				tracing::warn!(series = series.name, %error, "Download search failed");
				continue;
			},
		};

		let Some(best) = best_candidate(number.as_deref(), candidates) else {
			continue;
		};
		summary.found += 1;

		let status = if config.auto_approve {
			download_queue::DownloadStatus::Approved
		} else {
			download_queue::DownloadStatus::Pending
		};

		let active = download_queue::ActiveModel {
			series_id: Set(Some(series_id)),
			plugin_slug: Set(best.plugin_slug),
			download_id: Set(best.candidate.download_id),
			title: Set(best.candidate.title),
			source: Set(best.candidate.source),
			number: Set(number),
			size_bytes: Set(best.candidate.size_bytes.map(|b| b as i64)),
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
				.do_nothing()
				.to_owned(),
			)
			.exec_without_returning(conn)
			.await?;
		summary.queued += 1;
	}

	// Only started when there is something approved to do — an empty pass should not put a
	// job in the list for an operator to wonder about.
	if config.auto_approve && summary.queued > 0 {
		ctx.enqueue(LongboxJob::download_queue()).await?;
	}

	tracing::info!(
		wanted = summary.wanted,
		found = summary.found,
		queued = summary.queued,
		auto_approve = config.auto_approve,
		"Download sweep complete"
	);
	Ok(summary)
}
