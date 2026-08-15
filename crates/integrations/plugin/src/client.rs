use std::time::Duration;

use reqwest::{Client, Response, StatusCode};
use serde::de::DeserializeOwned;
use url::Url;

use crate::{
	error::{PluginError, PluginResult},
	protocol::{
		PluginHealth, PluginManifest, ReleasesRequest, ReleasesResponse,
		AUTHORIZATION_HEADER, PROTOCOL_HEADER, PROTOCOL_VERSION, REQUEST_ID_HEADER,
	},
};

/// How long any single plugin call may take. A plugin that scrapes a slow site is a
/// normal thing to write, so this is generous — but it is a ceiling, because the release
/// sweep runs on the cron task and one wedged plugin must not hold it forever.
const DEFAULT_TIMEOUT: Duration = Duration::from_secs(30);

/// Hard ceiling on a plugin response body.
///
/// Enforced while streaming rather than after buffering, so a plugin that answers with an
/// unbounded body is cut off instead of being allowed to exhaust the server's memory
/// first. Plugins are operator-installed and therefore trusted, but "trusted" is not the
/// same as "free of bugs", and the failure mode without this is the whole server dying.
const MAX_RESPONSE_BYTES: usize = 8 * 1024 * 1024;

/// A configured connection to one plugin. Cheap to construct; holds no state beyond the
/// resolved endpoints and the token.
#[derive(Debug, Clone)]
pub struct PluginClient {
	http: Client,
	base_url: Url,
	token: Option<String>,
	timeout: Duration,
	max_response_bytes: usize,
}

impl PluginClient {
	/// Build a client for `base_url`.
	///
	/// Rejects anything that is not an absolute http(s) URL. Note this deliberately does
	/// *not* reject private or loopback addresses: pointing Longbox at a plugin on the
	/// same Docker network is the normal deployment, so an SSRF-style host check would
	/// forbid the intended use. Registration is server-owner-only for that reason.
	pub fn new(base_url: &str, token: Option<String>) -> PluginResult<Self> {
		let parsed = Url::parse(base_url)
			.map_err(|_| PluginError::InvalidBaseUrl(base_url.to_string()))?;
		if !matches!(parsed.scheme(), "http" | "https") {
			return Err(PluginError::InvalidBaseUrl(base_url.to_string()));
		}

		let http = Client::builder()
			.connect_timeout(Duration::from_secs(5))
			.timeout(DEFAULT_TIMEOUT)
			.user_agent(concat!("Longbox/", env!("CARGO_PKG_VERSION")))
			.build()
			.map_err(|e| PluginError::Unreachable(e.to_string()))?;

		Ok(Self {
			http,
			base_url: parsed,
			token,
			timeout: DEFAULT_TIMEOUT,
			max_response_bytes: MAX_RESPONSE_BYTES,
		})
	}

	/// Override the response ceiling. Tests use this to exercise the limit without
	/// generating eight megabytes.
	pub fn with_max_response_bytes(mut self, max: usize) -> Self {
		self.max_response_bytes = max;
		self
	}

	/// Join `path` onto the base URL, preserving any path the operator registered.
	///
	/// `Url::join` would discard it — joining `manifest` onto `http://host/longbox/v1`
	/// yields `http://host/longbox/manifest`, silently dropping the version segment. So
	/// the separator is applied by hand.
	fn endpoint(&self, path: &str) -> PluginResult<Url> {
		let base = self.base_url.as_str().trim_end_matches('/');
		Url::parse(&format!("{base}/{path}"))
			.map_err(|_| PluginError::InvalidBaseUrl(self.base_url.to_string()))
	}

	fn decorate(&self, builder: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
		let builder = builder
			.header(PROTOCOL_HEADER, PROTOCOL_VERSION.to_string())
			.header(REQUEST_ID_HEADER, uuid::Uuid::new_v4().to_string());

		match &self.token {
			Some(token) => {
				builder.header(AUTHORIZATION_HEADER, format!("Bearer {token}"))
			},
			None => builder,
		}
	}

	/// Read a response body under the byte ceiling, then parse it.
	async fn read_json<T: DeserializeOwned>(
		&self,
		mut response: Response,
	) -> PluginResult<T> {
		let status = response.status();

		// Read chunk by chunk rather than calling `bytes()`, which would buffer the whole
		// body before anyone could object to its size.
		let mut body = Vec::new();
		while let Some(chunk) = response
			.chunk()
			.await
			.map_err(|e| PluginError::Unreachable(e.to_string()))?
		{
			if body.len() + chunk.len() > self.max_response_bytes {
				return Err(PluginError::ResponseTooLarge {
					limit: self.max_response_bytes,
				});
			}
			body.extend_from_slice(&chunk);
		}

		if status == StatusCode::UNAUTHORIZED || status == StatusCode::FORBIDDEN {
			return Err(PluginError::Unauthorized);
		}
		if !status.is_success() {
			return Err(PluginError::BadStatus {
				status: status.as_u16(),
				body: truncate_for_display(&String::from_utf8_lossy(&body)),
			});
		}

		serde_json::from_slice(&body).map_err(|e| {
			PluginError::MalformedResponse(format!(
				"{e} (body started: {})",
				truncate_for_display(&String::from_utf8_lossy(&body))
			))
		})
	}

	async fn send<T: DeserializeOwned>(
		&self,
		builder: reqwest::RequestBuilder,
	) -> PluginResult<T> {
		let response = self.decorate(builder).send().await.map_err(|e| {
			if e.is_timeout() {
				PluginError::Timeout {
					seconds: self.timeout.as_secs(),
				}
			} else {
				PluginError::Unreachable(e.to_string())
			}
		})?;

		self.read_json(response).await
	}

	/// Fetch and validate the manifest. This *is* the handshake: a manifest that parses
	/// and whose protocol matches is the only evidence Longbox accepts that a URL is a
	/// plugin at all.
	pub async fn manifest(&self) -> PluginResult<PluginManifest> {
		let url = self.endpoint("manifest")?;
		let manifest: PluginManifest = self.send(self.http.get(url)).await?;

		if manifest.protocol != PROTOCOL_VERSION {
			return Err(PluginError::ProtocolMismatch {
				ours: PROTOCOL_VERSION,
				theirs: manifest.protocol,
			});
		}

		Ok(manifest)
	}

	pub async fn health(&self) -> PluginResult<PluginHealth> {
		let url = self.endpoint("health")?;
		self.send(self.http.get(url)).await
	}

	pub async fn releases(
		&self,
		request: &ReleasesRequest,
	) -> PluginResult<ReleasesResponse> {
		let url = self.endpoint("releases")?;
		self.send(self.http.post(url).json(request)).await
	}
}

/// Plugin-supplied text is shown to the operator and written to logs, so it is clipped
/// to something a UI can hold and a log line can carry.
fn truncate_for_display(raw: &str) -> String {
	const MAX: usize = 300;
	let trimmed = raw.trim();
	if trimmed.chars().count() <= MAX {
		return trimmed.to_string();
	}
	let clipped: String = trimmed.chars().take(MAX).collect();
	format!("{clipped}…")
}

#[cfg(test)]
mod tests {
	use super::*;
	use wiremock::{
		matchers::{header, method, path},
		Mock, MockServer, ResponseTemplate,
	};

	fn manifest_body(protocol: i32) -> serde_json::Value {
		serde_json::json!({
			"protocol": protocol,
			"id": "com.example.p",
			"name": "Example",
			"capabilities": ["release-source"],
		})
	}

	#[test]
	fn rejects_non_http_base_urls() {
		for bad in ["file:///etc/passwd", "ftp://host/x", "not a url", ""] {
			assert!(
				PluginClient::new(bad, None).is_err(),
				"{bad} must be rejected"
			);
		}
	}

	#[test]
	fn accepts_http_and_https() {
		assert!(PluginClient::new("http://plugin:8080/longbox/v1", None).is_ok());
		assert!(PluginClient::new("https://plugin.example/x", None).is_ok());
	}

	/// `Url::join` would turn `…/longbox/v1` + `manifest` into `…/longbox/manifest`,
	/// quietly dropping the version segment the operator registered.
	#[test]
	fn endpoint_preserves_the_registered_base_path() {
		let client = PluginClient::new("http://host/longbox/v1", None).unwrap();
		assert_eq!(
			client.endpoint("manifest").unwrap().as_str(),
			"http://host/longbox/v1/manifest"
		);

		let trailing = PluginClient::new("http://host/longbox/v1/", None).unwrap();
		assert_eq!(
			trailing.endpoint("releases").unwrap().as_str(),
			"http://host/longbox/v1/releases"
		);
	}

	#[tokio::test]
	async fn manifest_round_trips_and_sends_protocol_and_auth_headers() {
		let server = MockServer::start().await;
		Mock::given(method("GET"))
			.and(path("/manifest"))
			.and(header(PROTOCOL_HEADER, PROTOCOL_VERSION.to_string()))
			.and(header(AUTHORIZATION_HEADER, "Bearer s3cret"))
			.respond_with(ResponseTemplate::new(200).set_body_json(manifest_body(1)))
			.mount(&server)
			.await;

		let client =
			PluginClient::new(&server.uri(), Some("s3cret".to_string())).unwrap();
		let manifest = client.manifest().await.expect("handshake must succeed");

		assert_eq!(manifest.id, "com.example.p");
		assert!(manifest.has_capability("release-source"));
	}

	#[tokio::test]
	async fn manifest_rejects_a_protocol_it_does_not_speak() {
		let server = MockServer::start().await;
		Mock::given(method("GET"))
			.and(path("/manifest"))
			.respond_with(ResponseTemplate::new(200).set_body_json(manifest_body(99)))
			.mount(&server)
			.await;

		let client = PluginClient::new(&server.uri(), None).unwrap();
		let error = client.manifest().await.unwrap_err();

		assert!(
			matches!(error, PluginError::ProtocolMismatch { theirs: 99, .. }),
			"got {error:?}"
		);
	}

	#[tokio::test]
	async fn unauthorized_is_its_own_error_not_a_generic_status() {
		let server = MockServer::start().await;
		Mock::given(method("GET"))
			.and(path("/manifest"))
			.respond_with(ResponseTemplate::new(401))
			.mount(&server)
			.await;

		let client = PluginClient::new(&server.uri(), None).unwrap();
		assert!(matches!(
			client.manifest().await.unwrap_err(),
			PluginError::Unauthorized
		));
	}

	#[tokio::test]
	async fn a_body_over_the_ceiling_is_refused() {
		let server = MockServer::start().await;
		Mock::given(method("GET"))
			.and(path("/manifest"))
			.respond_with(ResponseTemplate::new(200).set_body_string("x".repeat(4096)))
			.mount(&server)
			.await;

		let client = PluginClient::new(&server.uri(), None)
			.unwrap()
			.with_max_response_bytes(512);

		assert!(matches!(
			client.manifest().await.unwrap_err(),
			PluginError::ResponseTooLarge { limit: 512 }
		));
	}

	#[tokio::test]
	async fn a_non_json_body_reports_what_it_actually_got() {
		let server = MockServer::start().await;
		Mock::given(method("GET"))
			.and(path("/manifest"))
			.respond_with(
				ResponseTemplate::new(200).set_body_string("<html>not a plugin</html>"),
			)
			.mount(&server)
			.await;

		let client = PluginClient::new(&server.uri(), None).unwrap();
		let error = client.manifest().await.unwrap_err();

		let rendered = error.to_string();
		assert!(rendered.contains("not a plugin"), "got {rendered}");
	}

	#[tokio::test]
	async fn releases_posts_the_request_and_parses_the_list() {
		let server = MockServer::start().await;
		Mock::given(method("POST"))
			.and(path("/releases"))
			.respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
				"releases": [{
					"series_id": "series-1",
					"external_id": "ext-1",
					"number": "7",
					"release_date": "2026-09-03",
				}],
			})))
			.mount(&server)
			.await;

		let client = PluginClient::new(&server.uri(), None).unwrap();
		let request = ReleasesRequest {
			config: Default::default(),
			window: crate::protocol::ReleaseWindow {
				start: "2026-08-01".into(),
				end: "2026-11-01".into(),
			},
			series: vec![],
		};

		let response = client.releases(&request).await.unwrap();
		assert_eq!(response.releases.len(), 1);
		assert_eq!(response.releases[0].number.as_deref(), Some("7"));
		assert_eq!(response.releases[0].title, None);
	}

	#[test]
	fn display_text_is_clipped() {
		assert_eq!(truncate_for_display("  hi  "), "hi");
		let long = truncate_for_display(&"a".repeat(1000));
		assert_eq!(long.chars().count(), 301); // 300 + the ellipsis
	}
}
