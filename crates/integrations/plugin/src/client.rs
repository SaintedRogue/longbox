use std::time::Duration;

use reqwest::{Client, Response, StatusCode};
use serde::de::DeserializeOwned;
use url::Url;

use crate::{
	error::{PluginError, PluginResult},
	protocol::{
		PluginHealth, PluginManifest, ReleasesRequest, ReleasesResponse, ResolveRequest,
		ResolveResponse, SearchRequest, SearchResponse, AUTHORIZATION_HEADER,
		PROTOCOL_HEADER, PROTOCOL_VERSION, REQUEST_ID_HEADER,
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

	/// Ask what files would satisfy a wanted issue.
	pub async fn search(&self, request: &SearchRequest) -> PluginResult<SearchResponse> {
		let url = self.endpoint("search")?;
		self.send(self.http.post(url).json(request)).await
	}

	/// Turn a candidate's opaque handle into somewhere the bytes can be fetched from.
	///
	/// Called only when a download is actually about to happen, which is the reason this is
	/// separate from [`Self::search`]: a resolved address is frequently short-lived, and
	/// resolving every candidate at search time would spend them on results nobody takes.
	pub async fn resolve(
		&self,
		request: &ResolveRequest,
	) -> PluginResult<ResolveResponse> {
		let url = self.endpoint("resolve")?;
		self.send(self.http.post(url).json(request)).await
	}

	/// Ask the plugin to serve the bytes itself, for a host Longbox cannot reduce to a URL.
	///
	/// Returns the raw response rather than a parsed body: this is a comic file, and the
	/// entire point of the queue is that such a thing is streamed to disk instead of being
	/// held in memory. The response-size ceiling the other calls enforce deliberately does
	/// not apply here; the download job imposes its own, because it is the thing that knows
	/// what a reasonable file is.
	pub async fn fetch_stream(
		&self,
		request: &ResolveRequest,
	) -> PluginResult<reqwest::Response> {
		let url = self.endpoint("fetch")?;
		let response = self
			.decorate(self.http.post(url).json(request))
			.send()
			.await
			.map_err(|e| PluginError::Unreachable(e.to_string()))?;

		let status = response.status();
		if status == StatusCode::UNAUTHORIZED {
			return Err(PluginError::Unauthorized);
		}
		if !status.is_success() {
			// The body is not read: this endpoint answers with a file, and an error body
			// large enough to matter is exactly what should not be buffered here.
			return Err(PluginError::BadStatus {
				status: status.as_u16(),
				body: String::new(),
			});
		}
		Ok(response)
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

	fn download_query() -> crate::protocol::DownloadQuery {
		crate::protocol::DownloadQuery {
			series_name: "Absolute Batman".into(),
			series_year: Some(2024),
			number: Some("7".into()),
			format: crate::protocol::ReleaseFormat::Issue,
			series_id: "series-1".into(),
		}
	}

	#[tokio::test]
	async fn search_posts_the_query_and_parses_candidates() {
		let server = MockServer::start().await;
		Mock::given(method("POST"))
			.and(path("/search"))
			.respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
				"candidates": [{
					"download_id": "opaque-handle",
					"title": "Absolute Batman #7",
					"source": "Example",
					"size_bytes": 41943040u64,
					"format": "issue",
				}],
			})))
			.mount(&server)
			.await;

		let client = PluginClient::new(&server.uri(), None).unwrap();
		let response = client
			.search(&SearchRequest {
				config: Default::default(),
				query: download_query(),
			})
			.await
			.unwrap();

		assert_eq!(response.candidates.len(), 1);
		let candidate = &response.candidates[0];
		assert_eq!(candidate.download_id, "opaque-handle");
		assert_eq!(candidate.size_bytes, Some(41_943_040));
		assert_eq!(
			candidate.format,
			Some(crate::protocol::ReleaseFormat::Issue)
		);
		// Absent optional fields must not be an error: a plugin that knows nothing about
		// its own confidence should not have to invent a number.
		assert_eq!(candidate.confidence, None);
	}

	/// A plugin with nothing to offer answers `{}`, not an error.
	#[tokio::test]
	async fn search_tolerates_an_absent_candidate_list() {
		let server = MockServer::start().await;
		Mock::given(method("POST"))
			.and(path("/search"))
			.respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({})))
			.mount(&server)
			.await;

		let client = PluginClient::new(&server.uri(), None).unwrap();
		let response = client
			.search(&SearchRequest {
				config: Default::default(),
				query: download_query(),
			})
			.await
			.unwrap();
		assert!(response.candidates.is_empty());
	}

	#[tokio::test]
	async fn resolve_returns_a_url_and_any_headers_it_needs() {
		let server = MockServer::start().await;
		Mock::given(method("POST"))
			.and(path("/resolve"))
			.respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
				"url": "https://files.example/abc.cbz",
				"headers": { "referer": "https://example/page" },
				"filename": "Absolute Batman 007.cbz",
			})))
			.mount(&server)
			.await;

		let client = PluginClient::new(&server.uri(), None).unwrap();
		let resolved = client
			.resolve(&ResolveRequest {
				config: Default::default(),
				download_id: "opaque-handle".into(),
			})
			.await
			.unwrap();

		assert_eq!(
			resolved.url.as_deref(),
			Some("https://files.example/abc.cbz")
		);
		assert!(!resolved.stream, "a plain URL is not a streamed resolve");
		assert_eq!(
			resolved.headers.get("referer").map(String::as_str),
			Some("https://example/page")
		);
		assert_eq!(
			resolved.filename.as_deref(),
			Some("Absolute Batman 007.cbz")
		);
	}

	/// A host Longbox cannot reduce to a request answers with no URL at all.
	#[tokio::test]
	async fn resolve_can_ask_longbox_to_stream_from_the_plugin() {
		let server = MockServer::start().await;
		Mock::given(method("POST"))
			.and(path("/resolve"))
			.respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
				"stream": true,
				"filename": "encrypted-host.cbz",
			})))
			.mount(&server)
			.await;

		let client = PluginClient::new(&server.uri(), None).unwrap();
		let resolved = client
			.resolve(&ResolveRequest {
				config: Default::default(),
				download_id: "opaque-handle".into(),
			})
			.await
			.unwrap();

		assert!(resolved.stream);
		assert_eq!(resolved.url, None, "a streamed resolve has no URL to fetch");
		assert_eq!(resolved.filename.as_deref(), Some("encrypted-host.cbz"));
	}

	/// The streamed path returns the raw response, so a file-sized body is never buffered.
	#[tokio::test]
	async fn fetch_stream_returns_the_body_unparsed() {
		let server = MockServer::start().await;
		Mock::given(method("POST"))
			.and(path("/fetch"))
			.respond_with(
				ResponseTemplate::new(200).set_body_bytes(b"PK\x03\x04fake-cbz".to_vec()),
			)
			.mount(&server)
			.await;

		let client = PluginClient::new(&server.uri(), None).unwrap();
		let response = client
			.fetch_stream(&ResolveRequest {
				config: Default::default(),
				download_id: "opaque-handle".into(),
			})
			.await
			.expect("the plugin serves the bytes");

		let body = response.bytes().await.unwrap();
		assert!(body.starts_with(b"PK"), "got {body:?}");
	}

	#[tokio::test]
	async fn a_failed_stream_reports_the_status_without_reading_the_body() {
		let server = MockServer::start().await;
		Mock::given(method("POST"))
			.and(path("/fetch"))
			.respond_with(ResponseTemplate::new(503))
			.mount(&server)
			.await;

		let client = PluginClient::new(&server.uri(), None).unwrap();
		let error = client
			.fetch_stream(&ResolveRequest {
				config: Default::default(),
				download_id: "x".into(),
			})
			.await
			.unwrap_err();

		assert!(matches!(error, PluginError::BadStatus { status: 503, .. }));
		assert!(error.is_transient(), "a 503 is worth retrying");
	}

	#[test]
	fn display_text_is_clipped() {
		assert_eq!(truncate_for_display("  hi  "), "hi");
		let long = truncate_for_display(&"a".repeat(1000));
		assert_eq!(long.chars().count(), 301); // 300 + the ellipsis
	}
}
