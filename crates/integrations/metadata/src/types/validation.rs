use async_graphql::{Enum, SimpleObject};
use serde::{Deserialize, Serialize};

/// Outcome of validating a provider's credentials against its live API.
///
/// The variants deliberately keep failure modes distinct — most importantly
/// `InvalidCredentials` (the user's username:password is wrong) versus `Forbidden`
/// (the request was rejected by the provider's bot/AI filter, or the account is
/// inactive). Those need opposite user actions and used to be indistinguishable.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Enum)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ProviderValidationStatus {
	/// Credentials work — the API accepted an authenticated request.
	Valid,
	/// Authentication failed (e.g. HTTP 401): wrong username/password or token.
	InvalidCredentials,
	/// Access denied (e.g. HTTP 403 or a non-JSON bot-filter response): the account
	/// may be filtered, banned, or inactive.
	Forbidden,
	/// The provider's rate limit was hit (HTTP 429).
	RateLimited,
	/// The provider returned a server-side error (HTTP 5xx) or an unexpected status.
	ProviderError,
	/// The provider host could not be reached (connection error / timeout).
	NetworkError,
	/// This provider does not support server-side credential validation.
	Unsupported,
}

/// The result of a credential-validation attempt: a machine-readable
/// [`ProviderValidationStatus`] plus a human-readable message for display.
#[derive(Debug, Clone, Serialize, Deserialize, SimpleObject)]
pub struct ProviderValidationResult {
	pub status: ProviderValidationStatus,
	pub message: String,
}

impl ProviderValidationResult {
	/// Convenience constructor.
	pub fn new(status: ProviderValidationStatus, message: impl Into<String>) -> Self {
		Self {
			status,
			message: message.into(),
		}
	}
}
