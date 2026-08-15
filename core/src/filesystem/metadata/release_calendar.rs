//! The release-calendar oracle: sweep provider store-date windows into
//! `expected_issues` skeleton rows. Matching is provider-series-ID only —
//! a release binds to a series whose stored external id (or Mylar `comicid`,
//! for ComicVine) equals the provider's series id; everything else is dropped.
//! Skeletons are never media: "in library" is computed at query time.

use std::collections::HashMap;

use chrono::{Duration, Utc};
use metadata_integrations::UpcomingRelease;
use models::{
	entity::{
		expected_issue, external_metadata_link, metadata_provider_config, scheduled_job,
		series_metadata,
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
	pub matched: usize,
}

/// Upsert the releases that match a library series (by the provider's series
/// id) into `expected_issues`. Pure DB logic, testable without providers.
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
		.filter_map(|release| {
			let series_id = series_by_external_id.get(&release.series_external_id)?;
			Some(ResolvedRelease {
				series_id: series_id.clone(),
				external_id: release.external_id,
				number: release.number,
				title: release.title,
				cover_url: release.cover_url,
				release_date: release.release_date,
			})
		})
		.collect();

	stats.matched = resolved.len();
	upsert_expected_issues(conn, provider_id, resolved).await?;

	Ok(stats)
}

/// A release already bound to one of our series.
///
/// The two sweeps arrive at this point differently — a metadata provider's releases have
/// to be matched to a series by external id, whereas a plugin is *told* which series to
/// answer about and echoes the id back — but from here on the work is identical, so they
/// share it rather than keeping two upserts in step by hand.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedRelease {
	pub series_id: String,
	pub external_id: String,
	pub number: Option<String>,
	pub title: Option<String>,
	pub cover_url: Option<String>,
	pub release_date: Option<String>,
}

/// Upsert resolved releases as `expected_issues` skeleton rows, keyed on
/// (series, provider, external id) so a re-sweep updates rather than duplicates.
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
					expected_issue::Column::SeriesId,
					expected_issue::Column::Provider,
					expected_issue::Column::ExternalId,
				])
				.update_columns([
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

/// One scheduled oracle pass: for each enabled+configured provider, budget
/// permitting, fetch the window and upsert matches. A provider that is
/// budget-exhausted or errors is skipped (logged) — the next scheduled run is
/// the retry mechanism.
pub async fn run_release_calendar_sync(
	job: &scheduled_job::Model,
	ctx: &Ctx,
) -> CoreResult<()> {
	let config = job.release_calendar_config();
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
				tracing::info!(
					provider = budget_id,
					fetched = stats.fetched,
					matched = stats.matched,
					"Release-calendar sweep complete"
				);
			},
			Err(e) => {
				tracing::error!(provider = budget_id, error = ?e, "Release-calendar sweep failed");
			},
		}
	}

	let plugin_sources = sweep_plugin_releases(ctx, start, end).await?;

	// Surface a config foot-gun: sweeping is pointless with nothing to sweep. A
	// plugin-only server is a legitimate setup, so this only fires when neither kind of
	// release source is configured.
	if provider_configs.is_empty() && plugin_sources == 0 {
		return Err(CoreError::InternalError(
			"Release-calendar sync ran with no enabled metadata providers or release-source plugins"
				.to_string(),
		));
	}

	Ok(())
}

/// Ask every enabled `release-source` plugin about the followed series, and upsert what
/// they report. Returns how many plugins were asked.
///
/// A plugin that errors is recorded against its row and skipped — the operator sees the
/// reason in settings, and the next scheduled run is the retry. One broken plugin must
/// never fail the sweep for the others, or for the metadata providers that already ran.
async fn sweep_plugin_releases(
	ctx: &Ctx,
	start: chrono::NaiveDate,
	end: chrono::NaiveDate,
) -> CoreResult<usize> {
	let plugins = crate::plugin::load_enabled_with_capability(
		ctx,
		PluginCapability::RELEASE_SOURCE,
	)
	.await?;
	if plugins.is_empty() {
		return Ok(0);
	}

	let conn = ctx.conn.as_ref();
	let series = crate::plugin::followed_series_refs(conn).await?;
	if series.is_empty() {
		tracing::info!(
			plugins = plugins.len(),
			"Release-source plugins are enabled, but nobody follows a series yet"
		);
		return Ok(plugins.len());
	}

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
					.map(|(series_id, release)| ResolvedRelease {
						series_id,
						external_id: release.external_id,
						number: release.number,
						title: release.title,
						cover_url: release.cover_url,
						release_date: release.release_date,
					})
					.collect();

				let accepted_count = resolved.len();
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

	Ok(plugins.len())
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
			series_external_id: series_ext.to_string(),
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
				series_external_id: "178012".to_string(),
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
		assert_eq!(rows[0].series_id, "s-1");
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
				series_external_id: "178012".to_string(),
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
				release("9999", "33", "1"), // unknown series → dropped
			],
		)
		.await
		.expect("sync succeeds");

		assert_eq!(
			stats,
			ReleaseSyncStats {
				fetched: 3,
				matched: 2
			}
		);
		let rows = expected_issue::Entity::find().all(&conn).await.unwrap();
		assert_eq!(rows.len(), 2);
		assert!(rows
			.iter()
			.any(|r| r.series_id == "s1" && r.external_id == "11"));
		assert!(rows
			.iter()
			.any(|r| r.series_id == "s2" && r.external_id == "22"));
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
