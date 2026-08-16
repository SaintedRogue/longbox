//! Runtime for registered plugins: turning rows into live clients, performing the
//! handshake, and driving the capabilities this build knows how to call.
//!
//! Everything protocol-shaped lives in `plugin_integrations`; everything here is about
//! Longbox's side of the relationship — credentials, persistence, and what to do when a
//! plugin misbehaves.

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
