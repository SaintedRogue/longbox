//! Longbox plugin integration: the wire protocol and HTTP client for talking to
//! out-of-tree extensions.
//!
//! A plugin is a service the operator runs, not code Longbox loads. That choice is what
//! makes a plugin able to live in its own repository, on its own release cycle, in any
//! language — and it means a broken plugin degrades to "that plugin is unhealthy" rather
//! than taking the server down with it.
//!
//! This crate deliberately knows nothing about the database or GraphQL. It speaks the
//! protocol and nothing else, so it can be tested end to end against a stub HTTP server.

mod client;
mod error;
pub mod protocol;
mod settings;

pub use client::PluginClient;
pub use error::{PluginError, PluginResult};
pub use protocol::{
	DownloadCandidate, DownloadQuery, PluginCapability, PluginConfigField,
	PluginConfigFieldType, PluginHealth, PluginManifest, PluginRelease, ReleaseFormat,
	ReleaseWindow, ReleasesRequest, ReleasesResponse, ResolveRequest, ResolveResponse,
	SearchRequest, SearchResponse, SeriesRef, PROTOCOL_VERSION,
};
pub use settings::{
	merge_settings, redact_settings, secret_keys_with_values, SettingsError,
};
