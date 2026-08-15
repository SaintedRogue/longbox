use async_graphql::{Json, SimpleObject};
use longbox_core::{plugin::client_for, utils::encryption::decrypt_string};
use models::entity::plugin;
use plugin_integrations::{
	protocol::PluginConfigField, redact_settings, secret_keys_with_values, PluginManifest,
};
use std::collections::BTreeMap;

/// A registered plugin as the settings UI sees it.
///
/// Built by hand rather than flattened straight off the entity because two of its fields
/// must never be returned as stored: the shared token is not exposed at all, and the
/// settings blob has its secret-typed values stripped. Constructing the read model in one
/// place is what makes that guarantee auditable.
#[derive(SimpleObject)]
pub struct Plugin {
	pub id: i32,
	pub slug: String,
	pub name: String,
	pub base_url: String,
	pub enabled: bool,
	pub protocol_version: Option<i32>,
	/// RFC 3339, or null if this plugin has never been reached.
	pub last_handshake_at: Option<String>,
	/// Why the last attempt failed. Null when the last attempt succeeded.
	pub last_error: Option<String>,
	pub created_at: String,

	// --- derived from the stored manifest snapshot ---
	/// Null when the plugin has never completed a handshake.
	pub version: Option<String>,
	pub description: Option<String>,
	pub capabilities: Vec<String>,
	pub config_fields: Vec<PluginConfigField>,
	/// Operator-supplied config, with every secret-typed value removed.
	pub settings: Json<BTreeMap<String, serde_json::Value>>,
	/// Declared secret fields that currently hold a value, so the form can show
	/// "set" without ever receiving the secret itself.
	pub configured_secret_keys: Vec<String>,
	/// Whether the base URL and token currently produce a usable client. False points
	/// at a malformed URL rather than at an unreachable plugin.
	pub is_addressable: bool,
}

impl Plugin {
	pub fn from_model(model: plugin::Model, encryption_key: &String) -> Self {
		let manifest = model
			.manifest
			.clone()
			.and_then(|m| serde_json::from_value::<PluginManifest>(m).ok());

		let stored: BTreeMap<String, serde_json::Value> = model
			.encrypted_settings
			.as_deref()
			.and_then(|blob| decrypt_string(blob, encryption_key).ok())
			.and_then(|json| serde_json::from_str(&json).ok())
			.unwrap_or_default();

		// With no manifest there is nothing that says which keys are secret, so nothing
		// is returned. Leaking a secret because a handshake has not happened yet would be
		// exactly the wrong way round to fail.
		let (settings, configured_secret_keys) = match &manifest {
			Some(manifest) => (
				redact_settings(manifest, &stored),
				secret_keys_with_values(manifest, &stored),
			),
			None => (BTreeMap::new(), vec![]),
		};

		let is_addressable = client_for(&model, encryption_key).is_ok();

		Self {
			id: model.id,
			slug: model.slug,
			name: model.name,
			base_url: model.base_url,
			enabled: model.enabled,
			protocol_version: model.protocol_version,
			last_handshake_at: model.last_handshake_at.map(|t| t.to_rfc3339()),
			last_error: model.last_error,
			created_at: model.created_at.to_rfc3339(),
			version: manifest.as_ref().and_then(|m| m.version.clone()),
			description: manifest.as_ref().and_then(|m| m.description.clone()),
			capabilities: manifest
				.as_ref()
				.map(|m| m.capabilities.iter().map(|c| c.0.clone()).collect())
				.unwrap_or_default(),
			config_fields: manifest.map(|m| m.config).unwrap_or_default(),
			settings: Json(settings),
			configured_secret_keys,
			is_addressable,
		}
	}
}

/// What registering a plugin returns. The token is shown here and never again — it is
/// stored encrypted, and there is deliberately no way to read it back.
#[derive(SimpleObject)]
pub struct RegisteredPlugin {
	pub plugin: Plugin,
	/// Copy this into the plugin's own configuration; Longbox sends it as
	/// `Authorization: Bearer <token>` on every call.
	pub token: String,
}
