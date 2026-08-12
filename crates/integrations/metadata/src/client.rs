use std::{sync::Arc, time::Duration};

use reqwest::{cookie::CookieStore, Client};
use reqwest_middleware::{ClientBuilder, ClientWithMiddleware};
use reqwest_retry::{
	policies::ExponentialBackoff, RetryTransientMiddleware, Retryable, RetryableStrategy,
};

const DEFAULT_MAX_RETRIES: u32 = 3;

/// Cap on establishing a TCP/TLS connection. Providers that firewall-ban a client IP
/// (e.g. Metron dropping SYNs) leave the socket hanging; without this cap a request —
/// and any UI waiting on it — would stall indefinitely.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
/// Overall per-request cap (connect + response). Generous for a JSON API but bounded.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);

/// User-Agent sent with every outbound metadata-provider request.
///
/// Metron's API guidelines make a User-Agent MANDATORY: requests that send none
/// are flagged by their bot/AI filters, and a *browser* User-Agent (Firefox,
/// Safari, …) is explicitly called out as "very likely" to be banned. We therefore
/// send a stable, non-browser identifier on every provider request. It is versioned
/// via the crate version so Metron can correlate traffic to a client build — their
/// guidelines note they may contact API consumers about problematic usage.
pub const METADATA_USER_AGENT: &str = concat!("Longbox/", env!("CARGO_PKG_VERSION"));

/// A retry strategy that retries on 5xx, 429, timeouts, etc
struct RetryOn429And5xx;

impl RetryableStrategy for RetryOn429And5xx {
	fn handle(
		&self,
		res: &Result<reqwest::Response, reqwest_middleware::Error>,
	) -> Option<Retryable> {
		match res {
			Ok(response) => {
				let status = response.status();
				if status == reqwest::StatusCode::TOO_MANY_REQUESTS
					|| status.is_server_error()
				{
					Some(Retryable::Transient)
				} else if status.is_client_error() {
					Some(Retryable::Fatal)
				} else {
					None
				}
			},
			Err(error) => reqwest_retry::default_on_request_failure(error),
		}
	}
}

pub struct RetryClientConfig {
	pub max_retries: u32,
}

impl Default for RetryClientConfig {
	fn default() -> Self {
		Self {
			max_retries: DEFAULT_MAX_RETRIES,
		}
	}
}

/// Build the base [`reqwest::Client`] shared by every metadata provider, carrying
/// the mandatory [`METADATA_USER_AGENT`]. Wrap the result in
/// [`build_client_with_retry`] to add the shared retry/backoff middleware.
///
/// Providers must construct their client through this helper (not
/// `reqwest::Client::new()`) so the User-Agent is never accidentally dropped —
/// a headerless request is exactly what Metron's filters ban.
pub fn default_metadata_client() -> Client {
	metadata_client_builder()
		.build()
		// Mirrors `reqwest::Client::new()`, which unwraps the same result. The only
		// failure mode is the TLS backend failing to initialize at startup.
		.expect("failed to build metadata HTTP client")
}

/// A [`reqwest::ClientBuilder`] carrying the mandatory User-Agent and the shared
/// timeouts, for providers that need one more knob (a cookie jar, a redirect policy).
/// Start here rather than at `Client::builder()` so the User-Agent is never dropped.
pub fn metadata_client_builder() -> reqwest::ClientBuilder {
	Client::builder()
		.user_agent(METADATA_USER_AGENT)
		.connect_timeout(CONNECT_TIMEOUT)
		.timeout(REQUEST_TIMEOUT)
}

/// Build a metadata client that persists cookies into `jar`, otherwise identical to
/// [`default_metadata_client`] (same mandatory User-Agent, same timeouts).
///
/// Only for providers that authenticate with a *session* rather than a token — i.e.
/// League of Comic Geeks, which has no API and is reached by logging into the site as
/// the operator. Its `ci_session` cookie is reissued by the server on **every**
/// response, so the jar has to be the source of truth; a credential string copied
/// once would be stale by the next request. The caller keeps the `Arc` so it can ask
/// whether a session is currently held (and drop it to force a fresh login).
pub fn metadata_client_with_cookie_jar<C: CookieStore + 'static>(jar: Arc<C>) -> Client {
	metadata_client_builder()
		.cookie_provider(jar)
		.build()
		.expect("failed to build cookie-aware metadata HTTP client")
}

/// Build a [`ClientWithMiddleware`] wrapping the given [`reqwest::Client`]
/// with exponential-backoff retry logic
pub fn build_client_with_retry(
	inner: Client,
	config: RetryClientConfig,
) -> ClientWithMiddleware {
	let retry_policy =
		ExponentialBackoff::builder().build_with_max_retries(config.max_retries);
	let retry_middleware = RetryTransientMiddleware::new_with_policy_and_strategy(
		retry_policy,
		RetryOn429And5xx,
	);

	ClientBuilder::new(inner).with(retry_middleware).build()
}

#[cfg(test)]
mod tests {
	use super::*;
	use wiremock::{
		matchers::{header, method},
		Mock, MockServer, ResponseTemplate,
	};

	#[tokio::test]
	async fn default_client_sends_non_browser_user_agent() {
		let server = MockServer::start().await;

		// This mock only matches when the request carries our exact User-Agent.
		// Before the fix (a bare `reqwest::Client::new()` sends no UA) the request
		// falls through to wiremock's default 404, failing the assert below.
		Mock::given(method("GET"))
			.and(header("user-agent", METADATA_USER_AGENT))
			.respond_with(ResponseTemplate::new(200))
			.mount(&server)
			.await;

		let client = build_client_with_retry(
			default_metadata_client(),
			RetryClientConfig::default(),
		);

		let status = client
			.get(server.uri())
			.send()
			.await
			.expect("request failed")
			.status();

		assert_eq!(
			status, 200,
			"expected the User-Agent to match the mounted mock"
		);
	}

	#[test]
	fn user_agent_is_not_a_browser_string() {
		// Metron explicitly bans browser User-Agents. Encode that rule as a guard so
		// nobody "fixes" a future issue by pasting in a browser UA string.
		let ua = METADATA_USER_AGENT.to_lowercase();
		for banned in ["mozilla", "firefox", "safari", "chrome", "edg/", "webkit"] {
			assert!(
				!ua.contains(banned),
				"METADATA_USER_AGENT must not look like a browser: {METADATA_USER_AGENT}"
			);
		}
	}
}
