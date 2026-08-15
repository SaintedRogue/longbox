use thiserror::Error;

/// Everything that can go wrong talking to a plugin.
///
/// Each variant is written to be shown to the operator verbatim in the settings UI: a
/// plugin that will not handshake is a configuration problem they have to fix, and
/// "something went wrong" would leave them guessing between a typo'd URL, a wrong token
/// and a plugin that simply isn't running.
#[derive(Debug, Error)]
pub enum PluginError {
	#[error("Plugin URL must be an absolute http(s) URL: {0}")]
	InvalidBaseUrl(String),

	#[error("Could not reach the plugin: {0}")]
	Unreachable(String),

	#[error("Plugin rejected the request as unauthorized (HTTP 401). Check the plugin's copy of the token.")]
	Unauthorized,

	#[error("Plugin returned HTTP {status}: {body}")]
	BadStatus { status: u16, body: String },

	#[error("Plugin response was not valid JSON for this endpoint: {0}")]
	MalformedResponse(String),

	#[error(
		"Plugin speaks protocol version {theirs}, but this Longbox build speaks {ours}"
	)]
	ProtocolMismatch { ours: i32, theirs: i32 },

	#[error("Plugin response exceeded the {limit} byte limit")]
	ResponseTooLarge { limit: usize },

	#[error("Plugin did not respond within {seconds}s")]
	Timeout { seconds: u64 },
}

impl PluginError {
	/// Whether a later, identical call might succeed. Used to decide between recording a
	/// transient blip and marking the plugin as misconfigured.
	pub fn is_transient(&self) -> bool {
		match self {
			Self::Unreachable(_) | Self::Timeout { .. } => true,
			Self::BadStatus { status, .. } => *status >= 500,
			_ => false,
		}
	}
}

pub type PluginResult<T> = Result<T, PluginError>;
