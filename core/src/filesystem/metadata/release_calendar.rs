//! The release-calendar oracle: sweep provider store-date windows into
//! `expected_issues` skeleton rows. Matching is provider-series-ID only —
//! a release binds to a series whose stored external id (or Mylar `comicid`,
//! for ComicVine) equals the provider's series id; everything else is dropped.
//! Skeletons are never media: "in library" is computed at query time.

use std::{
	collections::HashMap,
	sync::atomic::{AtomicBool, Ordering},
};

use chrono::{Duration, Utc};
use metadata_integrations::UpcomingRelease;
use models::{
	entity::scheduled_job::ReleaseCalendarConfig,
	entity::{
		expected_issue, external_metadata_link, metadata_provider_config, scheduled_job,
		series_metadata, server_config,
	},
	shared::enums::MetadataProvider as MetadataProviderEnum,
};
use plugin_integrations::{protocol::PluginCapability, ReleaseWindow};
use sea_orm::{prelude::*, sea_query::OnConflict, ActiveValue::Set, QueryFilter};

use super::provider_budget_id;
use crate::{CoreError, CoreResult, Ctx};

/// The sweep window: recent past (late store-date corrections, last week's
/// books) through a quarter ahead.
const WINDOW_PAST_DAYS: i64 = 14;
const WINDOW_FUTURE_DAYS: i64 = 90;
/// Hard cap per provider per sweep — a runaway window must not eat the budget.
const SWEEP_CAP: usize = 3000;

#[derive(Debug, Default, PartialEq, Eq)]
pub struct ReleaseSyncStats {
	pub fetched: usize,
	/// Releases written — every one that was fetched, bound or not.
	pub stored: usize,
	/// The subset that resolved to a series in this library.
	pub matched: usize,
}

/// Upsert **every** release a provider reported into `expected_issues`, binding the ones
/// whose series id corresponds to a library series. Pure DB logic, testable without
/// providers.
pub async fn sync_provider_releases<C>(
	conn: &C,
	provider_id: &str,
	releases: Vec<UpcomingRelease>,
) -> CoreResult<ReleaseSyncStats>
where
	C: ConnectionTrait,
{
	let mut stats = ReleaseSyncStats {
		fetched: releases.len(),
		..Default::default()
	};

	// provider series-id → our series id.
	//
	// The enrichment pool is the authoritative source here, and it is what makes a
	// second provider's calendar work at all: `series_metadata.metadata_source` holds
	// only *one* provider, so before the pool existed a series matched to ComicVine was
	// invisible to a LOCG sweep no matter how well LOCG knew it. Links accumulate, so a
	// series can now be found by whichever provider is sweeping.
	let mut series_by_external_id: HashMap<String, String> = HashMap::new();
	let links = external_metadata_link::Entity::find()
		.filter(external_metadata_link::Column::Provider.eq(provider_id))
		.filter(external_metadata_link::Column::SeriesId.is_not_null())
		.all(conn)
		.await?;
	for link in links {
		if let (Some(series_id), Some(external_id)) = (link.series_id, link.external_id) {
			series_by_external_id.insert(external_id, series_id);
		}
	}

	// The legacy single-source column still contributes. The Phase 2 migration
	// backfilled it into the pool, but a series matched by an older build between that
	// migration and this sweep would otherwise be missed.
	let rows = series_metadata::Entity::find()
		.filter(series_metadata::Column::MetadataSource.eq(provider_id))
		.all(conn)
		.await?;
	for row in rows {
		if let Some(ext) = row.metadata_external_id.clone() {
			series_by_external_id
				.entry(ext)
				.or_insert(row.series_id.clone());
		}
	}
	if provider_id == "comicvine" {
		let with_comicid = series_metadata::Entity::find()
			.filter(series_metadata::Column::Comicid.is_not_null())
			.all(conn)
			.await?;
		for row in with_comicid {
			if let Some(comicid) = row.comicid {
				series_by_external_id
					.entry(comicid.to_string())
					.or_insert(row.series_id.clone());
			}
		}
	}

	let resolved: Vec<ResolvedRelease> = releases
		.into_iter()
		.map(|release| {
			// Binding is an enrichment, not a filter. A release nothing here matches is
			// still what is coming out, and dropping it is what left the "all releases"
			// view with nothing to show.
			let series_id = release
				.series_external_id
				.as_ref()
				.and_then(|external| series_by_external_id.get(external))
				.cloned();
			ResolvedRelease {
				series_id,
				series_name: release.series_name,
				series_external_id: release.series_external_id,
				external_id: release.external_id,
				number: release.number,
				title: release.title,
				cover_url: release.cover_url,
				release_date: release.release_date,
			}
		})
		.collect();

	stats.stored = resolved.len();
	stats.matched = resolved.iter().filter(|r| r.series_id.is_some()).count();
	upsert_expected_issues(conn, provider_id, resolved).await?;

	Ok(stats)
}

/// A release ready to store, bound to one of our series or not.
///
/// The two sweeps arrive at this point differently — a metadata provider's releases have
/// to be matched to a series by external id and often match nothing, whereas a plugin is
/// *told* which series to answer about and echoes the id back, so its releases are always
/// bound — but from here on the work is identical, so they share it rather than keeping
/// two upserts in step by hand.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedRelease {
	/// `None` when no series in this library corresponds to the release.
	pub series_id: Option<String>,
	pub series_name: Option<String>,
	pub series_external_id: Option<String>,
	pub external_id: String,
	pub number: Option<String>,
	pub title: Option<String>,
	pub cover_url: Option<String>,
	pub release_date: Option<String>,
}

/// Upsert releases as `expected_issues` skeleton rows, keyed on (provider, external id) so
/// a re-sweep updates rather than duplicates.
///
/// `series_id` is among the updated columns, which is what lets a release that arrived
/// unbound become bound later: match the series, and the next sweep attaches the releases
/// already sitting in the table rather than waiting for the provider to mention them again.
pub async fn upsert_expected_issues<C>(
	conn: &C,
	provider_id: &str,
	releases: Vec<ResolvedRelease>,
) -> CoreResult<()>
where
	C: ConnectionTrait,
{
	for release in releases {
		let active = expected_issue::ActiveModel {
			series_id: Set(release.series_id),
			series_name: Set(release.series_name),
			series_external_id: Set(release.series_external_id),
			provider: Set(provider_id.to_string()),
			external_id: Set(release.external_id),
			number: Set(release.number),
			title: Set(release.title),
			cover_url: Set(release.cover_url),
			release_date: Set(release.release_date),
			created_at: Set(Utc::now().into()),
			..Default::default()
		};
		expected_issue::Entity::insert(active)
			.on_conflict(
				OnConflict::columns([
					expected_issue::Column::Provider,
					expected_issue::Column::ExternalId,
				])
				.update_columns([
					expected_issue::Column::SeriesId,
					expected_issue::Column::SeriesName,
					expected_issue::Column::SeriesExternalId,
					expected_issue::Column::Number,
					expected_issue::Column::Title,
					expected_issue::Column::CoverUrl,
					expected_issue::Column::ReleaseDate,
				])
				.to_owned(),
			)
			.exec(conn)
			.await?;
	}

	Ok(())
}

/// Whether a sweep is in flight, so a second one cannot start on top of it.
///
/// A process-global rather than something on `Ctx`: Longbox is a single process, the cron
/// task and the manual trigger are the only two callers, and the thing being protected is
/// a shared provider budget and rate limiter that are themselves process-wide. Guarding at
/// the same scope as the resource keeps the two from disagreeing.
static SWEEP_IN_FLIGHT: AtomicBool = AtomicBool::new(false);

/// Whether a release-calendar sweep is running right now.
pub fn sweep_in_flight() -> bool {
	SWEEP_IN_FLIGHT.load(Ordering::SeqCst)
}

/// What a sweep did, for reporting back to whoever asked for it.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct ReleaseSyncSummary {
	/// Metadata providers that were actually asked (enabled, configured, in budget).
	pub providers_swept: usize,
	/// Plugins advertising `release-source` that were asked.
	pub plugins_swept: usize,
	/// Releases upserted, whether or not they correspond to anything in this library.
	pub stored: usize,
	/// The subset of those that bound to a library series.
	pub matched: usize,
}

/// A scheduled oracle pass. See [`sync_release_calendar`].
pub async fn run_release_calendar_sync(
	job: &scheduled_job::Model,
	ctx: &Ctx,
) -> CoreResult<()> {
	sync_release_calendar(job.release_calendar_config(), ctx)
		.await
		.map(|_| ())
}

/// One oracle pass: for each enabled+configured provider, budget permitting, fetch the
/// window and upsert matches, then do the same for every `release-source` plugin. A source
/// that is budget-exhausted or errors is skipped (logged) — the next run is the retry.
///
/// Takes the config directly rather than a `scheduled_job::Model` so a manual sync works
/// on a server that has never configured a schedule. Requiring a cron expression before
/// you may press "Sync now" would be a strange thing to insist on.
pub async fn sync_release_calendar(
	config: ReleaseCalendarConfig,
	ctx: &Ctx,
) -> CoreResult<ReleaseSyncSummary> {
	if SWEEP_IN_FLIGHT.swap(true, Ordering::SeqCst) {
		return Err(CoreError::InternalError(
			"A release-calendar sync is already running".to_string(),
		));
	}
	// Released however this returns, including on the `?` early exits below.
	let _guard = SweepGuard;

	let summary = sweep(config, ctx).await?;

	// Stamped on success only: a failed sweep has not refreshed anything, and saying it
	// did would be worse than saying nothing.
	if let Some(server_config) =
		server_config::Entity::find().one(ctx.conn.as_ref()).await?
	{
		let active = server_config::ActiveModel {
			id: sea_orm::ActiveValue::Unchanged(server_config.id),
			last_release_calendar_sync_at: Set(Some(Utc::now())),
			..Default::default()
		};
		server_config::Entity::update(active)
			.exec(ctx.conn.as_ref())
			.await?;
	}

	Ok(summary)
}

/// Clears [`SWEEP_IN_FLIGHT`] on drop, so an early return or a panic cannot wedge the flag
/// on and lock out every later sync.
struct SweepGuard;

impl Drop for SweepGuard {
	fn drop(&mut self) {
		SWEEP_IN_FLIGHT.store(false, Ordering::SeqCst);
	}
}

async fn sweep(
	config: ReleaseCalendarConfig,
	ctx: &Ctx,
) -> CoreResult<ReleaseSyncSummary> {
	let mut summary = ReleaseSyncSummary::default();
	let today = Utc::now().date_naive();
	let start = today - Duration::days(WINDOW_PAST_DAYS);
	let end = today + Duration::days(WINDOW_FUTURE_DAYS);

	let provider_configs = metadata_provider_config::Entity::find()
		.filter(metadata_provider_config::Column::Enabled.eq(true))
		.all(ctx.conn.as_ref())
		.await?;

	let cache = ctx.provider_cache();
	let runtime = cache.runtime();

	for provider_config in &provider_configs {
		let enabled = match provider_config.provider_type {
			MetadataProviderEnum::ComicVine => config.comicvine_enabled,
			MetadataProviderEnum::Metron => config.metron_enabled,
			MetadataProviderEnum::Locg => config.locg_enabled,
			// Hardcover has no release windows.
			MetadataProviderEnum::Hardcover => false,
		};
		if !enabled {
			continue;
		}

		let budget_id = provider_budget_id(&provider_config.provider_type);
		if runtime.budget_exhausted(budget_id).await {
			tracing::warn!(
				provider = budget_id,
				"Release-calendar sweep skipped: budget exhausted — next run resumes"
			);
			continue;
		}

		let provider = match cache.get_or_create(provider_config).await {
			Ok(p) => p,
			Err(e) => {
				tracing::error!(provider = budget_id, error = ?e, "Provider unavailable for release sweep");
				continue;
			},
		};

		match provider
			.fetch_upcoming_releases(start, end, SWEEP_CAP)
			.await
		{
			Ok(releases) => {
				let stats =
					sync_provider_releases(ctx.conn.as_ref(), provider.id(), releases)
						.await?;
				summary.providers_swept += 1;
				summary.stored += stats.stored;
				summary.matched += stats.matched;
				tracing::info!(
					provider = budget_id,
					fetched = stats.fetched,
					stored = stats.stored,
					matched = stats.matched,
					"Release-calendar sweep complete"
				);
			},
			Err(e) => {
				tracing::error!(provider = budget_id, error = ?e, "Release-calendar sweep failed");
			},
		}
	}

	let (plugins_swept, plugin_matched) = sweep_plugin_releases(ctx, start, end).await?;
	summary.plugins_swept = plugins_swept;
	summary.stored += plugin_matched;
	summary.matched += plugin_matched;

	// Surface a config foot-gun: sweeping is pointless with nothing to sweep. A
	// plugin-only server is a legitimate setup, so this only fires when neither kind of
	// release source is configured.
	if provider_configs.is_empty() && plugins_swept == 0 {
		return Err(CoreError::InternalError(
			"Release-calendar sync ran with no enabled metadata providers or release-source plugins"
				.to_string(),
		));
	}

	Ok(summary)
}

/// Ask every enabled `release-source` plugin about the followed series, and upsert what
/// they report. Returns (plugins asked, releases matched).
///
/// A plugin that errors is recorded against its row and skipped — the operator sees the
/// reason in settings, and the next scheduled run is the retry. One broken plugin must
/// never fail the sweep for the others, or for the metadata providers that already ran.
async fn sweep_plugin_releases(
	ctx: &Ctx,
	start: chrono::NaiveDate,
	end: chrono::NaiveDate,
) -> CoreResult<(usize, usize)> {
	let plugins = crate::plugin::load_enabled_with_capability(
		ctx,
		PluginCapability::RELEASE_SOURCE,
	)
	.await?;
	if plugins.is_empty() {
		return Ok((0, 0));
	}

	let conn = ctx.conn.as_ref();
	let series = crate::plugin::followed_series_refs(conn).await?;
	if series.is_empty() {
		tracing::info!(
			plugins = plugins.len(),
			"Release-source plugins are enabled, but nobody follows a series yet"
		);
		return Ok((plugins.len(), 0));
	}

	let mut matched = 0usize;
	let window = ReleaseWindow {
		start: start.to_string(),
		end: end.to_string(),
	};

	for loaded in &plugins {
		let provider_id = loaded.provider_id();

		match crate::plugin::fetch_releases(loaded, &series, window.clone()).await {
			Ok(accepted) => {
				let resolved: Vec<ResolvedRelease> = accepted
					.into_iter()
					// Always bound: a plugin is asked about specific series and echoes
					// the id back, so there is nothing here to resolve or to miss.
					.map(|(series_id, release)| ResolvedRelease {
						series_id: Some(series_id),
						series_name: None,
						series_external_id: None,
						external_id: release.external_id,
						number: release.number,
						title: release.title,
						cover_url: release.cover_url,
						release_date: release.release_date,
					})
					.collect();

				let accepted_count = resolved.len();
				matched += accepted_count;
				upsert_expected_issues(conn, &provider_id, resolved).await?;
				crate::plugin::record_outcome(conn, loaded.row.id, None).await?;

				tracing::info!(
					plugin = loaded.row.slug,
					accepted = accepted_count,
					"Plugin release sweep complete"
				);
			},
			Err(error) => {
				tracing::error!(plugin = loaded.row.slug, %error, "Plugin release sweep failed");
				crate::plugin::record_outcome(
					conn,
					loaded.row.id,
					Some(error.to_string()),
				)
				.await?;
			},
		}
	}

	Ok((plugins.len(), matched))
}

#[cfg(test)]
mod tests {
	use migrations::{Migrator, MigratorTrait};
	use models::entity::series;
	use sea_orm::Database;

	use super::*;

	async fn mem_db() -> DatabaseConnection {
		let conn = Database::connect("sqlite::memory:")
			.await
			.expect("connects");
		Migrator::up(&conn, None).await.expect("migrates");
		conn
	}

	async fn seed_series(
		conn: &DatabaseConnection,
		id: &str,
		source: Option<&str>,
		external_id: Option<&str>,
		comicid: Option<i32>,
	) {
		series::ActiveModel {
			id: Set(id.to_string()),
			name: Set(format!("Series {id}")),
			path: Set(format!("/tmp/{id}")),
			..Default::default()
		}
		.insert(conn)
		.await
		.expect("series inserts");
		series_metadata::ActiveModel {
			series_id: Set(id.to_string()),
			metadata_source: Set(source.map(String::from)),
			metadata_external_id: Set(external_id.map(String::from)),
			comicid: Set(comicid),
			..Default::default()
		}
		.insert(conn)
		.await
		.expect("series_metadata inserts");
	}

	fn release(series_ext: &str, ext: &str, number: &str) -> UpcomingRelease {
		UpcomingRelease {
			series_external_id: Some(series_ext.to_string()),
			series_name: Some(format!("Series {series_ext}")),
			external_id: ext.to_string(),
			number: Some(number.to_string()),
			title: Some(format!("#{number}")),
			cover_url: None,
			release_date: Some("2026-08-12".to_string()),
		}
	}

	/// The capability the enrichment pool exists for: a series matched to one provider
	/// can still be found by another provider's sweep.
	///
	/// Before the pool, `series_metadata` held exactly one `metadata_source`, so a series
	/// matched to ComicVine was invisible to a LOCG sweep however well LOCG knew it —
	/// LOCG's whole reason for being here is its release calendar, so this was the case
	/// that mattered most and could not work.
	#[tokio::test]
	async fn a_series_matched_to_another_provider_is_still_found_via_its_link() {
		let conn = mem_db().await;
		// Matched to ComicVine in the single-source column, as an older build would.
		seed_series(&conn, "s-1", Some("comicvine"), Some("cv-4050"), None).await;
		// And separately linked to LOCG — which the old shape had nowhere to put.
		external_metadata_link::ActiveModel {
			series_id: Set(Some("s-1".to_string())),
			provider: Set("locg".to_string()),
			external_id: Set(Some("178012".to_string())),
			state: Set(
				models::entity::external_metadata_link::LinkState::LINKED.to_string()
			),
			fetched_at: Set(Utc::now()),
			..Default::default()
		}
		.insert(&conn)
		.await
		.expect("link inserts");

		let stats = sync_provider_releases(
			&conn,
			"locg",
			vec![UpcomingRelease {
				series_external_id: Some("178012".to_string()),
				series_name: Some("Absolute Batman".to_string()),
				external_id: "2463692".to_string(),
				number: Some("1".to_string()),
				title: Some("Absolute Batman #1".to_string()),
				cover_url: None,
				release_date: Some("2024-10-09".to_string()),
			}],
		)
		.await
		.expect("sweep succeeds");

		assert_eq!(stats.matched, 1, "the LOCG link is what makes this match");

		let rows = expected_issue::Entity::find()
			.all(&conn)
			.await
			.expect("query");
		assert_eq!(rows.len(), 1);
		assert_eq!(rows[0].series_id.as_deref(), Some("s-1"));
		assert_eq!(rows[0].provider, "locg");
	}

	/// A link belonging to a *different* provider must not match this sweep, or every
	/// provider would inherit every other provider's ids.
	#[tokio::test]
	async fn a_link_for_another_provider_does_not_match() {
		let conn = mem_db().await;
		seed_series(&conn, "s-1", None, None, None).await;
		external_metadata_link::ActiveModel {
			series_id: Set(Some("s-1".to_string())),
			provider: Set("comicvine".to_string()),
			external_id: Set(Some("178012".to_string())),
			state: Set(
				models::entity::external_metadata_link::LinkState::LINKED.to_string()
			),
			fetched_at: Set(Utc::now()),
			..Default::default()
		}
		.insert(&conn)
		.await
		.expect("link inserts");

		let stats = sync_provider_releases(
			&conn,
			"locg",
			vec![UpcomingRelease {
				series_external_id: Some("178012".to_string()),
				series_name: Some("Absolute Batman".to_string()),
				external_id: "issue-1".to_string(),
				number: None,
				title: None,
				cover_url: None,
				release_date: None,
			}],
		)
		.await
		.expect("sweep succeeds");

		assert_eq!(stats.matched, 0, "ids are only meaningful per provider");
		assert_eq!(
			stats.stored, 1,
			"failing to match is not a reason to forget the release"
		);
		let rows = expected_issue::Entity::find().all(&conn).await.unwrap();
		assert_eq!(rows[0].series_id, None, "stored, but bound to nothing");
	}

	#[tokio::test]
	async fn releases_match_by_external_id_and_comicid() {
		let conn = mem_db().await;
		seed_series(&conn, "s1", Some("comicvine"), Some("1001"), None).await;
		// Matched only via Mylar's comicid (metadata_source unset — file-evidence
		// libraries look like this).
		seed_series(&conn, "s2", None, None, Some(2002)).await;

		let stats = sync_provider_releases(
			&conn,
			"comicvine",
			vec![
				release("1001", "11", "1"),
				release("2002", "22", "5"),
				release("9999", "33", "1"), // unknown series → stored, unbound
			],
		)
		.await
		.expect("sync succeeds");

		assert_eq!(
			stats,
			ReleaseSyncStats {
				fetched: 3,
				stored: 3,
				matched: 2
			}
		);
		let rows = expected_issue::Entity::find().all(&conn).await.unwrap();
		assert_eq!(rows.len(), 3, "all three are stored; two of them bind");
		assert!(rows
			.iter()
			.any(|r| r.series_id.as_deref() == Some("s1") && r.external_id == "11"));
		assert!(rows
			.iter()
			.any(|r| r.series_id.as_deref() == Some("s2") && r.external_id == "22"));
		// The unbound one keeps the provider's own name for the series, which is the only
		// thing the calendar can label it with.
		let unbound = rows
			.iter()
			.find(|r| r.external_id == "33")
			.expect("the unmatched release is still stored");
		assert_eq!(unbound.series_id, None);
		assert_eq!(unbound.series_name.as_deref(), Some("Series 9999"));
		assert_eq!(unbound.series_external_id.as_deref(), Some("9999"));
	}

	/// The payoff of storing unbound releases: matching a series later binds the rows that
	/// are already sitting in the table, instead of waiting for the provider to mention
	/// those issues again.
	#[tokio::test]
	async fn a_release_stored_unbound_binds_once_the_series_is_matched() {
		let conn = mem_db().await;

		// Sweep first, with nothing in the library to match against.
		sync_provider_releases(&conn, "metron", vec![release("120", "9911", "13")])
			.await
			.expect("first sweep succeeds");
		let rows = expected_issue::Entity::find().all(&conn).await.unwrap();
		assert_eq!(rows.len(), 1);
		assert_eq!(rows[0].series_id, None, "nothing to bind to yet");

		// The series is then added and matched to the provider.
		seed_series(&conn, "s1", Some("metron"), Some("120"), None).await;

		let stats =
			sync_provider_releases(&conn, "metron", vec![release("120", "9911", "13")])
				.await
				.expect("second sweep succeeds");

		assert_eq!(stats.matched, 1);
		let rows = expected_issue::Entity::find().all(&conn).await.unwrap();
		assert_eq!(rows.len(), 1, "bound in place rather than duplicated");
		assert_eq!(rows[0].series_id.as_deref(), Some("s1"));
	}

	#[tokio::test]
	async fn reupsert_updates_in_place() {
		let conn = mem_db().await;
		seed_series(&conn, "s1", Some("metron"), Some("120"), None).await;

		sync_provider_releases(&conn, "metron", vec![release("120", "9911", "13")])
			.await
			.unwrap();
		// The provider later fills in a corrected date.
		let mut updated = release("120", "9911", "13");
		updated.release_date = Some("2026-08-19".to_string());
		sync_provider_releases(&conn, "metron", vec![updated])
			.await
			.unwrap();

		let rows = expected_issue::Entity::find().all(&conn).await.unwrap();
		assert_eq!(rows.len(), 1, "same identity upserts in place");
		assert_eq!(rows[0].release_date.as_deref(), Some("2026-08-19"));
	}

	#[tokio::test]
	async fn comicid_matching_is_comicvine_only() {
		let conn = mem_db().await;
		seed_series(&conn, "s1", None, None, Some(120)).await;

		let stats =
			sync_provider_releases(&conn, "metron", vec![release("120", "9911", "1")])
				.await
				.unwrap();
		assert_eq!(stats.matched, 0, "comicid is a ComicVine id, not Metron's");
	}
}
