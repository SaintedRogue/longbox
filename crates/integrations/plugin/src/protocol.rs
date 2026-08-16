//! The Longbox plugin wire protocol.
//!
//! Longbox is always the client: it calls the plugin, never the other way around. That
//! keeps authentication one-directional (the plugin only ever *verifies* a token, and
//! never needs Longbox credentials of its own) and means a plugin can be a static,
//! stateless service behind any HTTP stack the author likes.

use std::collections::BTreeMap;

use async_graphql::{Enum, SimpleObject};
use serde::{Deserialize, Serialize};

/// The protocol revision this build speaks. Bumped only for breaking wire changes; a
/// plugin advertising anything else is refused at handshake with a legible reason
/// rather than failing later at a call site.
pub const PROTOCOL_VERSION: i32 = 1;

/// Header carrying the per-plugin shared secret.
pub const AUTHORIZATION_HEADER: &str = "authorization";
/// Header echoing [`PROTOCOL_VERSION`], so a plugin can serve several Longbox
/// generations from one deployment if it wants to.
pub const PROTOCOL_HEADER: &str = "x-longbox-protocol";
/// Correlation id, so a plugin's logs can be lined up against Longbox's.
pub const REQUEST_ID_HEADER: &str = "x-longbox-request-id";

/// How a declared config field should be collected from the operator.
///
/// Deliberately a small closed set. A plugin describes *what* it needs; Longbox decides
/// how to render and store it. Anything richer would mean shipping plugin-authored code
/// to the browser, which v1 does not do.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Enum)]
#[serde(rename_all = "snake_case")]
pub enum PluginConfigFieldType {
	/// Free text, stored and returned as-is.
	String,
	/// Free text that is never returned to the client once stored.
	Secret,
	Number,
	Boolean,
	/// One of `options`.
	Select,
}

impl PluginConfigFieldType {
	pub fn is_secret(self) -> bool {
		matches!(self, Self::Secret)
	}
}

/// One operator-supplied setting a plugin declares in its manifest.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, SimpleObject)]
pub struct PluginConfigField {
	pub key: String,
	pub label: String,
	#[serde(rename = "type")]
	#[graphql(name = "type")]
	pub field_type: PluginConfigFieldType,
	#[serde(default)]
	pub required: bool,
	/// Prefilled when the operator has not set a value yet. Never applies to secrets.
	#[serde(default)]
	pub default: Option<String>,
	/// Allowed values for [`PluginConfigFieldType::Select`].
	#[serde(default)]
	pub options: Option<Vec<String>>,
	/// Longer explanation rendered beneath the field.
	#[serde(default)]
	pub help: Option<String>,
}

/// A capability a plugin claims to implement.
///
/// Unknown strings are preserved rather than rejected: a plugin built against a newer
/// Longbox may advertise capabilities this build has never heard of, and that is not an
/// error — this build simply never calls them.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct PluginCapability(pub String);

impl PluginCapability {
	/// Contribute expected issues to the release calendar.
	pub const RELEASE_SOURCE: &'static str = "release-source";
	/// Find a file for a wanted issue and resolve it to something downloadable.
	pub const DOWNLOAD_SOURCE: &'static str = "download-source";

	pub fn is_release_source(&self) -> bool {
		self.0 == Self::RELEASE_SOURCE
	}

	pub fn is_download_source(&self) -> bool {
		self.0 == Self::DOWNLOAD_SOURCE
	}
}

/// What shape of release a search is for.
///
/// A plugin is free to ignore this and return whatever it has — it is a hint about what
/// would satisfy the request, not a filter Longbox will enforce on the answer.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Enum)]
#[serde(rename_all = "snake_case")]
pub enum ReleaseFormat {
	/// A single issue.
	Issue,
	/// A collected edition of a story arc.
	Tpb,
	/// A large collected edition.
	Omnibus,
}

/// What Longbox is looking for.
///
/// Described in the library's own terms — the series as it is filed here, and the issue
/// number as the calendar knows it — because a plugin's idea of how to find that is exactly
/// what the plugin is for.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DownloadQuery {
	pub series_name: String,
	#[serde(default)]
	pub series_year: Option<i32>,
	/// Raw issue number as stored, so non-integer numbers ("1.MU", "½") survive.
	#[serde(default)]
	pub number: Option<String>,
	pub format: ReleaseFormat,
	/// Longbox's series id, echoed back on candidates so a result can be tied to the
	/// series it was searched for without re-matching by name.
	pub series_id: String,
}

/// Body of `POST {base}/search`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SearchRequest {
	pub config: BTreeMap<String, serde_json::Value>,
	pub query: DownloadQuery,
}

/// One file a plugin says would satisfy the query.
///
/// `PartialEq` but not `Eq`: `confidence` is a float, and there is no sensible total
/// equality over it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DownloadCandidate {
	/// The plugin's own handle for this file. Opaque to Longbox, which never parses it and
	/// only ever hands it back to `resolve` — so a plugin can encode whatever it needs.
	pub download_id: String,
	/// Human-readable, shown in the queue so a person can tell candidates apart.
	pub title: String,
	/// Where the plugin found it, for display. Not interpreted.
	#[serde(default)]
	pub source: Option<String>,
	#[serde(default)]
	pub size_bytes: Option<u64>,
	#[serde(default)]
	pub format: Option<ReleaseFormat>,
	/// The plugin's own confidence, 0.0–1.0, when it has a view. Longbox ranks with its
	/// own scorer as well; this only breaks ties a plugin knows more about than we do.
	#[serde(default)]
	pub confidence: Option<f32>,
}

/// Body of the `search` response.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SearchResponse {
	#[serde(default)]
	pub candidates: Vec<DownloadCandidate>,
}

/// Body of `POST {base}/resolve`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ResolveRequest {
	pub config: BTreeMap<String, serde_json::Value>,
	pub download_id: String,
}

/// Where to actually fetch the bytes.
///
/// Resolution is a separate call from search on purpose: search results are cached and
/// shown in a queue, while the address a file is served from is often short-lived,
/// single-use, or only issued on demand. Folding them together would mean resolving
/// candidates nobody ever downloads, and holding URLs until they expire.
///
/// Two ways to answer, because one is not enough. Most hosts can be reduced to a URL
/// Longbox fetches. Some cannot: an end-to-end encrypted host has no plain URL at all,
/// and a host requiring a multi-step handshake would hand over a token that has expired by
/// the time it is used. Those set [`Self::stream`] and serve the bytes themselves.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ResolveResponse {
	/// Absolute `http`/`https` URL for Longbox to fetch. Absent when [`Self::stream`] is
	/// set. Longbox does the fetching so progress, retries, disk limits and cancellation
	/// live in one place rather than in each plugin.
	#[serde(default)]
	pub url: Option<String>,
	/// Extra request headers, for a source that needs a referer or its own authorisation.
	#[serde(default)]
	pub headers: BTreeMap<String, String>,
	/// Suggested filename, used when the response carries nothing better.
	#[serde(default)]
	pub filename: Option<String>,
	/// Longbox should `POST {base}/fetch` and stream the plugin's own response body
	/// instead of fetching a URL.
	///
	/// For hosts Longbox cannot reduce to a request: client-side decryption, a session
	/// that only the plugin holds, or a protocol that is not HTTP at all. The plugin
	/// becomes the transport; Longbox still owns the queue, the progress, the disk limits
	/// and the atomic placement, so nothing about the guarantees changes.
	#[serde(default)]
	pub stream: bool,
}

/// What `GET {base}/manifest` returns: everything Longbox needs to decide whether it can
/// talk to this plugin at all, and what to ask it for.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PluginManifest {
	pub protocol: i32,
	/// Author-chosen stable identity, e.g. `com.example.my-plugin`. Slugified once, at
	/// registration, into the local identity that outlives any later rename.
	pub id: String,
	pub name: String,
	#[serde(default)]
	pub version: Option<String>,
	#[serde(default)]
	pub description: Option<String>,
	#[serde(default)]
	pub capabilities: Vec<PluginCapability>,
	#[serde(default)]
	pub config: Vec<PluginConfigField>,
}

impl PluginManifest {
	pub fn has_capability(&self, capability: &str) -> bool {
		self.capabilities.iter().any(|c| c.0 == capability)
	}

	/// The declared field for `key`, if the plugin declared one. Values whose key is not
	/// declared are dropped on save rather than stored, so a manifest that shrinks can
	/// never leave orphaned settings behind.
	pub fn field(&self, key: &str) -> Option<&PluginConfigField> {
		self.config.iter().find(|f| f.key == key)
	}
}

/// What `GET {base}/health` returns. Any non-2xx is unhealthy regardless of body.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PluginHealth {
	pub ok: bool,
	#[serde(default)]
	pub detail: Option<String>,
}

/// Inclusive date window, ISO `YYYY-MM-DD`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReleaseWindow {
	pub start: String,
	pub end: String,
}

/// A series Longbox wants releases for. The plugin matches it however it likes —
/// by name, by year, by its own stored mapping — and answers with `id` echoed back.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SeriesRef {
	/// Longbox's series id. Echoing this back is what links a release to a series, so
	/// nothing has to be reconciled afterwards.
	pub id: String,
	pub name: String,
	#[serde(default)]
	pub year: Option<i32>,
}

/// Body of `POST {base}/releases`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ReleasesRequest {
	/// Operator-supplied values for the manifest's declared config fields.
	pub config: BTreeMap<String, serde_json::Value>,
	pub window: ReleaseWindow,
	pub series: Vec<SeriesRef>,
}

/// One issue a plugin says is expected.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PluginRelease {
	/// Must be one of the `series[].id` values from the request. Anything else is
	/// dropped: a plugin cannot invent rows against series Longbox did not ask about.
	pub series_id: String,
	/// The plugin's own stable id for this issue, used to upsert rather than duplicate.
	pub external_id: String,
	#[serde(default)]
	pub number: Option<String>,
	#[serde(default)]
	pub title: Option<String>,
	#[serde(default)]
	pub cover_url: Option<String>,
	/// ISO `YYYY-MM-DD`, or absent when the plugin has no date yet.
	#[serde(default)]
	pub release_date: Option<String>,
}

/// Body of the `releases` response.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReleasesResponse {
	#[serde(default)]
	pub releases: Vec<PluginRelease>,
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn manifest_deserializes_with_only_required_fields() {
		let manifest: PluginManifest =
			serde_json::from_str(r#"{"protocol":1,"id":"com.example.p","name":"P"}"#)
				.expect("a minimal manifest must be accepted");

		assert_eq!(manifest.protocol, 1);
		assert!(manifest.capabilities.is_empty());
		assert!(manifest.config.is_empty());
		assert_eq!(manifest.version, None);
	}

	/// A plugin built against a newer Longbox may advertise capabilities this build has
	/// never heard of. That must parse — this build simply never calls them.
	#[test]
	fn unknown_capabilities_are_preserved_not_rejected() {
		let manifest: PluginManifest = serde_json::from_str(
			r#"{"protocol":1,"id":"x","name":"X","capabilities":["release-source","teleport"]}"#,
		)
		.unwrap();

		assert!(manifest.has_capability(PluginCapability::RELEASE_SOURCE));
		assert!(manifest.has_capability("teleport"));
	}

	#[test]
	fn config_field_type_uses_snake_case_on_the_wire() {
		let field: PluginConfigField = serde_json::from_str(
			r#"{"key":"k","label":"K","type":"secret","required":true}"#,
		)
		.unwrap();

		assert_eq!(field.field_type, PluginConfigFieldType::Secret);
		assert!(field.field_type.is_secret());
		assert!(field.required);
	}

	#[test]
	fn releases_response_tolerates_an_absent_list() {
		let response: ReleasesResponse = serde_json::from_str("{}").unwrap();
		assert!(response.releases.is_empty());
	}
}
