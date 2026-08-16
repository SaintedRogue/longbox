//! Runtime for registered plugins: turning rows into live clients, performing the
//! handshake, and driving the capabilities this build knows how to call.
//!
//! Everything protocol-shaped lives in `plugin_integrations`; everything here is about
//! Longbox's side of the relationship — credentials, persistence, and what to do when a
//! plugin misbehaves.

pub mod local;

use std::collections::{BTreeMap, HashSet};

use chrono::Utc;
use models::entity::{plugin, series, series_follow};
use plugin_integrations::{
	protocol::PluginCapability, PluginClient, PluginError, PluginManifest, ReleaseWindow,
	ReleasesRequest, SeriesRef,
};
use sea_orm::{prelude::*, ActiveValue::Set, QuerySelect};
use serde_json::Value;

use crate::{utils::encryption::decrypt_string, CoreError, CoreResult, Ctx};

/// Upper bound on how many series are described to a plugin in one call.
///
/// Two reasons, and the second is the important one: a request naming every series in a
/// large library would be enormous, and every name in it is data leaving the server for a
/// third party. The sweep therefore describes *followed* series only — which is also
/// exactly the set the release calendar is about.
const MAX_SERIES_PER_REQUEST: usize = 500;

/// A plugin loaded and ready to call: its row, its decrypted client, and the manifest
/// captured at its last successful handshake.
pub struct LoadedPlugin {
	pub row: plugin::Model,
	pub client: PluginClient,
	pub manifest: PluginManifest,
	pub settings: BTreeMap<String, Value>,
}

impl LoadedPlugin {
	pub fn provider_id(&self) -> String {
		self.row.provider_id()
	}
}

/// Decrypt a plugin row's stored settings blob.
///
/// A blob that will not decrypt or parse is treated as "no settings" rather than as a
/// hard failure: the encryption key changing should degrade a plugin to unconfigured, not
/// wedge the whole sweep.
fn decrypt_settings(
	row: &plugin::Model,
	encryption_key: &String,
) -> BTreeMap<String, Value> {
	let Some(encrypted) = row.encrypted_settings.as_deref() else {
		return BTreeMap::new();
	};

	match decrypt_string(encrypted, encryption_key)
		.ok()
		.and_then(|json| serde_json::from_str(&json).ok())
	{
		Some(settings) => settings,
		None => {
			tracing::warn!(
				plugin = row.slug,
				"Could not read stored plugin settings; treating as unconfigured"
			);
			BTreeMap::new()
		},
	}
}

/// Build a client for a plugin row, decrypting its token.
pub fn client_for(
	row: &plugin::Model,
	encryption_key: &String,
) -> Result<PluginClient, PluginError> {
	let token = row
		.encrypted_token
		.as_deref()
		.and_then(|t| decrypt_string(t, encryption_key).ok());
	PluginClient::new(&row.base_url, token)
}

/// Where a local plugin's files live. `None` for a remote plugin, which has no directory.
pub fn plugin_dir(ctx: &Ctx, row: &plugin::Model) -> Option<std::path::PathBuf> {
	let dir = row.install_dir.as_deref()?;
	Some(local::plugins_root(&ctx.config.get_config_dir()).join(dir))
}

/// Launch a local plugin and record where it ended up answering.
///
/// The address is persisted on every start rather than held only in memory: `client_for`
/// and everything built on it read the row, so writing it back is what lets the rest of the
/// system stay unaware that this plugin is one we launched.
pub async fn start_local(ctx: &Ctx, row: &plugin::Model) -> CoreResult<String> {
	let dir = plugin_dir(ctx, row).ok_or_else(|| {
		CoreError::InternalError(format!(
			"Plugin {} is local but has no install directory recorded",
			row.slug
		))
	})?;
	let descriptor = local::LocalPluginDescriptor::read(&dir)?;

	// A directory swapped underneath a registration must not inherit its identity, its
	// stored settings or its token — so the descriptor has to still claim the id the slug
	// was derived from.
	let expected = plugin::slugify_plugin_id(&descriptor.id);
	if expected.as_deref() != Some(row.slug.as_str()) {
		return Err(CoreError::InternalError(format!(
			"Plugin directory {} now declares id {:?}, which is not the {} it was installed as",
			dir.display(),
			descriptor.id,
			row.slug
		)));
	}

	let encryption_key = ctx.get_encryption_key().await?;
	let token = row
		.encrypted_token
		.as_deref()
		.and_then(|t| decrypt_string(t, &encryption_key).ok());

	let base_url = ctx
		.plugin_processes
		.start(&row.slug, &dir, &descriptor, token.as_deref())
		.await?;

	plugin::ActiveModel {
		id: sea_orm::ActiveValue::Unchanged(row.id),
		base_url: Set(base_url.clone()),
		..Default::default()
	}
	.update(ctx.conn.as_ref())
	.await?;

	tracing::info!(plugin = row.slug, %base_url, "Started local plugin");
	Ok(base_url)
}

/// Stop a local plugin if it is running. Safe to call for a remote plugin, which is a no-op.
pub async fn stop_local(ctx: &Ctx, slug: &str) {
	ctx.plugin_processes.stop(slug).await;
}

/// Start every enabled local plugin. Called once at boot.
///
/// One plugin failing to start must not stop the others or the server: the failure is
/// recorded against its row so the operator sees it in settings, and boot continues.
pub async fn start_enabled_local_plugins(ctx: &Ctx) -> CoreResult<()> {
	let rows = plugin::Entity::find()
		.filter(plugin::Column::Enabled.eq(true))
		.all(ctx.conn.as_ref())
		.await?;

	for row in rows {
		if row.plugin_kind() != plugin::PluginKind::Local {
			continue;
		}
		if let Err(error) = start_local(ctx, &row).await {
			tracing::error!(plugin = row.slug, %error, "Local plugin failed to start");
			let _ =
				record_outcome(ctx.conn.as_ref(), row.id, Some(error.to_string())).await;
		}
	}

	Ok(())
}

/// Every enabled plugin whose last handshake advertised `capability`.
///
/// Capability is read from the stored manifest rather than by calling the plugin, so a
/// sweep costs one request per plugin that can actually serve it rather than one per
/// plugin that exists.
pub async fn load_enabled_with_capability(
	ctx: &Ctx,
	capability: &str,
) -> CoreResult<Vec<LoadedPlugin>> {
	let rows = plugin::Entity::find()
		.filter(plugin::Column::Enabled.eq(true))
		.all(ctx.conn.as_ref())
		.await?;
	if rows.is_empty() {
		return Ok(vec![]);
	}

	let encryption_key = ctx.get_encryption_key().await?;
	let mut loaded = Vec::new();

	for row in rows {
		let Some(manifest) = row
			.manifest
			.clone()
			.and_then(|m| serde_json::from_value::<PluginManifest>(m).ok())
		else {
			tracing::warn!(
				plugin = row.slug,
				"Enabled plugin has no usable manifest; re-run its handshake"
			);
			continue;
		};

		if !manifest.has_capability(capability) {
			continue;
		}

		match client_for(&row, &encryption_key) {
			Ok(client) => {
				let settings = decrypt_settings(&row, &encryption_key);
				loaded.push(LoadedPlugin {
					row,
					client,
					manifest,
					settings,
				});
			},
			Err(error) => {
				tracing::error!(plugin = row.slug, %error, "Could not build plugin client");
			},
		}
	}

	Ok(loaded)
}

/// Record the outcome of talking to a plugin, so the settings UI can show why something
/// is not working without the operator reading logs.
pub async fn record_outcome(
	conn: &DatabaseConnection,
	plugin_id: i32,
	error: Option<String>,
) -> CoreResult<()> {
	let active = plugin::ActiveModel {
		id: sea_orm::ActiveValue::Unchanged(plugin_id),
		last_handshake_at: Set(Some(Utc::now().into())),
		last_error: Set(error),
		..Default::default()
	};
	plugin::Entity::update(active).exec(conn).await?;
	Ok(())
}

/// Fetch a plugin's manifest and persist it, along with whatever the attempt revealed
/// about the plugin's health.
///
/// This is the handshake in full: a manifest that parses, whose protocol matches, is the
/// only evidence Longbox accepts that a URL is a plugin at all.
pub async fn refresh_manifest(ctx: &Ctx, plugin_id: i32) -> CoreResult<PluginManifest> {
	let conn = ctx.conn.as_ref();
	let row = plugin::Entity::find_by_id(plugin_id)
		.one(conn)
		.await?
		.ok_or_else(|| CoreError::InternalError("Plugin not found".to_string()))?;

	let encryption_key = ctx.get_encryption_key().await?;
	let client = client_for(&row, &encryption_key)
		.map_err(|e| CoreError::InternalError(e.to_string()))?;

	match client.manifest().await {
		Ok(manifest) => {
			let snapshot = serde_json::to_value(&manifest)
				.map_err(|e| CoreError::InternalError(e.to_string()))?;
			let active = plugin::ActiveModel {
				id: sea_orm::ActiveValue::Unchanged(row.id),
				name: Set(manifest.name.clone()),
				protocol_version: Set(Some(manifest.protocol)),
				manifest: Set(Some(snapshot)),
				last_handshake_at: Set(Some(Utc::now().into())),
				last_error: Set(None),
				..Default::default()
			};
			plugin::Entity::update(active).exec(conn).await?;
			Ok(manifest)
		},
		Err(error) => {
			record_outcome(conn, row.id, Some(error.to_string())).await?;
			Err(CoreError::InternalError(error.to_string()))
		},
	}
}

/// The series a plugin sweep should ask about: those at least one user follows.
///
/// Follows *are* the subscription in Longbox, so this is the set the release calendar
/// exists to serve — and scoping to it keeps both the request size and the amount of
/// library data leaving the server proportional to what the operator actually asked for.
pub async fn followed_series_refs(
	conn: &DatabaseConnection,
) -> CoreResult<Vec<SeriesRef>> {
	let followed: HashSet<String> = series_follow::Entity::find()
		.select_only()
		.column(series_follow::Column::SeriesId)
		.into_tuple::<String>()
		.all(conn)
		.await?
		.into_iter()
		.collect();

	if followed.is_empty() {
		return Ok(vec![]);
	}

	let mut refs: Vec<SeriesRef> = series::Entity::find()
		.filter(series::Column::Id.is_in(followed))
		.all(conn)
		.await?
		.into_iter()
		.map(|s| SeriesRef {
			id: s.id,
			name: s.name,
			year: None,
		})
		.collect();

	refs.sort_by(|a, b| a.id.cmp(&b.id));
	if refs.len() > MAX_SERIES_PER_REQUEST {
		tracing::warn!(
			total = refs.len(),
			cap = MAX_SERIES_PER_REQUEST,
			"More followed series than a plugin request carries; the remainder is not swept"
		);
		refs.truncate(MAX_SERIES_PER_REQUEST);
	}

	Ok(refs)
}

/// Outcome of one plugin's release sweep.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct PluginSweepStats {
	pub returned: usize,
	pub accepted: usize,
}

/// Filter a plugin's answer down to rows Longbox will actually store.
///
/// A plugin may only speak about series it was asked about. Without this a plugin could
/// write `release_calendar_entries` rows against any series id it cared to name — including ones
/// the requesting operator cannot see — so unknown ids are dropped rather than trusted.
pub fn accept_releases(
	requested: &[SeriesRef],
	releases: Vec<plugin_integrations::PluginRelease>,
) -> Vec<(String, plugin_integrations::PluginRelease)> {
	let allowed: HashSet<&str> = requested.iter().map(|s| s.id.as_str()).collect();

	releases
		.into_iter()
		.filter_map(|release| {
			if !allowed.contains(release.series_id.as_str()) {
				tracing::debug!(
					series_id = release.series_id,
					"Dropping plugin release for a series that was not requested"
				);
				return None;
			}
			if release.external_id.trim().is_empty() {
				return None;
			}
			Some((release.series_id.clone(), release))
		})
		.collect()
}

/// Ask one plugin for releases in `window` and hand back the rows worth storing.
pub async fn fetch_releases(
	loaded: &LoadedPlugin,
	series: &[SeriesRef],
	window: ReleaseWindow,
) -> Result<Vec<(String, plugin_integrations::PluginRelease)>, PluginError> {
	let request = ReleasesRequest {
		config: loaded.settings.clone(),
		window,
		series: series.to_vec(),
	};

	let response = loaded.client.releases(&request).await?;
	Ok(accept_releases(series, response.releases))
}

/// A candidate together with the plugin that offered it.
///
/// The origin is not decoration: a `download_id` is opaque and only means anything to its
/// author, so resolving has to go back to the same plugin that produced it.
#[derive(Debug, Clone)]
pub struct SourcedCandidate {
	pub plugin_slug: String,
	pub plugin_name: String,
	pub candidate: plugin_integrations::DownloadCandidate,
}

/// Ask every enabled `download-source` plugin what would satisfy this query.
///
/// Results are pooled rather than taken from the first plugin that answers, so a second
/// source can offer a better file than the one that happened to be asked first. A plugin
/// that errors or times out is logged and skipped — one broken source must not deny the
/// others, exactly as in the release sweep.
pub async fn search_downloads(
	ctx: &Ctx,
	query: &plugin_integrations::DownloadQuery,
) -> CoreResult<Vec<SourcedCandidate>> {
	let plugins =
		load_enabled_with_capability(ctx, PluginCapability::DOWNLOAD_SOURCE).await?;

	let mut pooled = Vec::new();
	for loaded in &plugins {
		let request = plugin_integrations::SearchRequest {
			config: loaded.settings.clone(),
			query: query.clone(),
		};

		match loaded.client.search(&request).await {
			Ok(response) => {
				let count = response.candidates.len();
				pooled.extend(response.candidates.into_iter().map(|candidate| {
					SourcedCandidate {
						plugin_slug: loaded.row.slug.clone(),
						plugin_name: loaded.row.name.clone(),
						candidate,
					}
				}));
				tracing::debug!(
					plugin = loaded.row.slug,
					candidates = count,
					series = query.series_name,
					"Download source answered"
				);
				let _ = record_outcome(ctx.conn.as_ref(), loaded.row.id, None).await;
			},
			Err(error) => {
				tracing::warn!(plugin = loaded.row.slug, %error, "Download search failed");
				let _ = record_outcome(
					ctx.conn.as_ref(),
					loaded.row.id,
					Some(error.to_string()),
				)
				.await;
			},
		}
	}

	Ok(pooled)
}

/// Turn a candidate back into somewhere its bytes can be fetched from.
///
/// Deliberately a separate step, and deliberately late: a resolved address is often
/// single-use or short-lived, so it is obtained when a download is about to start rather
/// than when the candidate was first offered.
/// A resolved download, with the means to follow it up.
///
/// The client and settings travel with the response because a streamed resolve needs a
/// second call to the same plugin, with the same credentials — looking the row up again
/// and rebuilding them would be both wasteful and a chance for the two calls to disagree
/// about which plugin they are talking to.
pub struct ResolvedDownload {
	pub response: plugin_integrations::ResolveResponse,
	pub client: PluginClient,
	pub request: plugin_integrations::ResolveRequest,
}

pub async fn resolve_download(
	conn: &DatabaseConnection,
	plugin_slug: &str,
	download_id: &str,
) -> CoreResult<ResolvedDownload> {
	let row = plugin::Entity::find()
		.filter(plugin::Column::Slug.eq(plugin_slug))
		.filter(plugin::Column::Enabled.eq(true))
		.one(conn)
		.await?
		.ok_or_else(|| {
			CoreError::NotFound(format!(
				"Plugin `{plugin_slug}` is not registered or not enabled"
			))
		})?;

	// Takes a connection rather than a `Ctx` so the download job can call it: a job holds
	// a `JobContext`, and threading the whole core context through for one lookup would be
	// the wrong shape.
	let encryption_key = models::entity::server_config::Entity::find()
		.one(conn)
		.await?
		.and_then(|config| config.encryption_key)
		.ok_or(CoreError::EncryptionKeyNotSet)?;
	let client = client_for(&row, &encryption_key)
		.map_err(|e| CoreError::InternalError(e.to_string()))?;
	let settings = decrypt_settings(&row, &encryption_key);

	let request = plugin_integrations::ResolveRequest {
		config: settings,
		download_id: download_id.to_string(),
	};
	let response = client
		.resolve(&request)
		.await
		.map_err(|e| CoreError::InternalError(e.to_string()))?;

	Ok(ResolvedDownload {
		response,
		client,
		request,
	})
}

/// Whether any enabled plugin can contribute to the release calendar. Used to decide
/// whether a sweep with no metadata providers configured is a misconfiguration or simply
/// a plugin-only setup.
pub async fn has_release_source(ctx: &Ctx) -> CoreResult<bool> {
	Ok(
		!load_enabled_with_capability(ctx, PluginCapability::RELEASE_SOURCE)
			.await?
			.is_empty(),
	)
}

#[cfg(test)]
mod tests {
	use super::*;
	use plugin_integrations::PluginRelease;

	fn series_ref(id: &str) -> SeriesRef {
		SeriesRef {
			id: id.to_string(),
			name: id.to_string(),
			year: None,
		}
	}

	fn release(series_id: &str, external_id: &str) -> PluginRelease {
		PluginRelease {
			series_id: series_id.to_string(),
			external_id: external_id.to_string(),
			number: None,
			title: None,
			cover_url: None,
			release_date: None,
		}
	}

	#[test]
	fn releases_for_requested_series_are_accepted() {
		let requested = vec![series_ref("a"), series_ref("b")];
		let accepted =
			accept_releases(&requested, vec![release("a", "1"), release("b", "2")]);

		assert_eq!(accepted.len(), 2);
	}

	/// A plugin must not be able to write rows against series it was never asked about —
	/// including ones the operator cannot see.
	#[test]
	fn releases_for_unrequested_series_are_dropped() {
		let requested = vec![series_ref("a")];
		let accepted = accept_releases(
			&requested,
			vec![release("a", "1"), release("somebody-elses-series", "2")],
		);

		assert_eq!(accepted.len(), 1);
		assert_eq!(accepted[0].0, "a");
	}

	/// `external_id` is the upsert key; a blank one would collapse every issue of a
	/// series onto a single row.
	#[test]
	fn releases_without_an_external_id_are_dropped() {
		let requested = vec![series_ref("a")];
		let accepted =
			accept_releases(&requested, vec![release("a", ""), release("a", "  ")]);

		assert!(accepted.is_empty());
	}
}
