use async_graphql::{InputObject, Json};
use std::collections::BTreeMap;

/// Register a plugin by URL.
///
/// Only the URL is required: a plugin's name, version, capabilities and config schema are
/// all read from its manifest at handshake, so nothing here duplicates something the
/// plugin already declares about itself.
#[derive(InputObject)]
pub struct RegisterPluginInput {
	/// Root of the plugin's protocol endpoints, e.g. `http://my-plugin:8080/longbox/v1`.
	pub base_url: String,
	/// Supply a token Longbox should use instead of generating one. For deployments that
	/// provision both sides from the same configuration; leave unset for the normal flow,
	/// where Longbox generates a token and shows it once.
	pub token: Option<String>,
}

/// A patch: every field is optional, and an omitted field is left alone.
#[derive(InputObject)]
pub struct PatchPluginInput {
	pub base_url: Option<String>,
	pub enabled: Option<bool>,
	/// Values for the fields the plugin's manifest declares. Merged over what is already
	/// stored, so a form may send only what changed — and a blank secret means "keep the
	/// stored one", since the UI never receives it to send back.
	pub settings: Option<Json<BTreeMap<String, serde_json::Value>>>,
	/// Issue a fresh token, invalidating the old one. The new token is returned once.
	pub rotate_token: Option<bool>,
}
