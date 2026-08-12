//! The host-environment contract for provider HTTP traffic.
//!
//! Providers are DB-agnostic; anything that needs persistence — the response
//! cache and the API budget ledger — is supplied by the host through
//! [`ProviderRuntime`]. Standalone use (tests, examples) gets [`NoopRuntime`]:
//! no caching, no accounting, unlimited budget, exactly the pre-runtime
//! behavior.

use std::sync::Arc;

use reqwest_middleware::ClientWithMiddleware;

use crate::{error::MetadataProviderError, rate_limit::RateLimiter};

#[async_trait::async_trait]
pub trait ProviderRuntime: Send + Sync {
	/// A fresh cached body for this URL, if the host holds one. Freshness and
	/// cacheability (see [`crate::response_cache`]) are the host's concern —
	/// providers just ask.
	async fn cache_get(&self, provider: &str, url: &str) -> Option<serde_json::Value>;

	/// Offer a response body for caching. Hosts may decline (uncacheable URL,
	/// oversized body); providers don't care.
	async fn cache_put(&self, provider: &str, url: &str, body: &serde_json::Value);

	/// Record one real (non-cached) API call in the budget ledger.
	async fn record_call(&self, provider: &str, url: &str);

	/// Whether the provider's budget window is exhausted (limit − reserve
	/// reached). Callers that can defer work should check this *before*
	/// spending requests.
	async fn budget_exhausted(&self, provider: &str) -> bool;
}

/// The no-persistence runtime: never caches, never counts, never exhausted.
pub struct NoopRuntime;

#[async_trait::async_trait]
impl ProviderRuntime for NoopRuntime {
	async fn cache_get(&self, _provider: &str, _url: &str) -> Option<serde_json::Value> {
		None
	}
	async fn cache_put(&self, _provider: &str, _url: &str, _body: &serde_json::Value) {}
	async fn record_call(&self, _provider: &str, _url: &str) {}
	async fn budget_exhausted(&self, _provider: &str) -> bool {
		false
	}
}

/// Shorthand for the runtime handle providers store.
pub type RuntimeHandle = Arc<dyn ProviderRuntime>;

pub fn noop_runtime() -> RuntimeHandle {
	Arc::new(NoopRuntime)
}

/// Whether a 2xx body is worth caching. Providers that report API-level failures
/// *inside* a successful HTTP response supply their own; see [`always_cacheable`].
pub type BodyCachePolicy = fn(&serde_json::Value) -> bool;

/// The default policy: any body that arrived under a 2xx is cacheable. Correct for
/// providers (Metron) that signal errors with HTTP status codes.
pub fn always_cacheable(_body: &serde_json::Value) -> bool {
	true
}

/// [`cached_get_json`] for providers whose responses are HTML rather than JSON.
///
/// Only League of Comic Geeks needs this: it has no API, so its issue pages and quick
/// search return markup. The body is stored in the same cache as a JSON string, which
/// keeps one cache, one ledger and one limiter across every provider instead of a
/// parallel set for the scraping one. Cached unconditionally — LOCG reports failures
/// with status codes, so anything arriving under a 2xx is a real page.
pub async fn cached_get_text(
	client: &ClientWithMiddleware,
	runtime: &dyn ProviderRuntime,
	limiter: &RateLimiter,
	provider: &str,
	request: reqwest::Request,
) -> Result<String, MetadataProviderError> {
	let url = request.url().to_string();

	if let Some(serde_json::Value::String(hit)) = runtime.cache_get(provider, &url).await
	{
		return Ok(hit);
	}

	limiter.until_ready().await;
	let response = client.execute(request).await?;
	runtime.record_call(provider, &url).await;
	let response = response.error_for_status()?;
	let body = response.text().await?;
	runtime
		.cache_put(provider, &url, &serde_json::Value::String(body.clone()))
		.await;
	Ok(body)
}

/// Execute a provider GET through the cache and ledger: a fresh cache hit costs
/// neither a rate-limit permit nor budget; a miss waits for the limiter, records
/// exactly one ledger row, and offers the body back to the cache.
///
/// The retry middleware inside `client` may issue more physical attempts than
/// the single row recorded here — the budget *reserve* absorbs that slack.
///
/// `body_policy` is what keeps a provider's *error envelope* out of the cache.
/// ComicVine answers "rate limit exceeded" (`status_code` 107), "invalid API key"
/// (100) and "object not found" (101) with HTTP 200 and the failure in the body, so
/// an unconditional `cache_put` stored those under the requested URL's key and served
/// them back for the whole TTL — 12 hours for a search, 7 days for a detail lookup.
/// A single burst of 107s during a bulk match run therefore poisoned exactly the
/// lookups that were mid-flight, and no amount of waiting for the hourly window to
/// reset would clear them.
pub async fn cached_get_json(
	client: &ClientWithMiddleware,
	runtime: &dyn ProviderRuntime,
	limiter: &RateLimiter,
	provider: &str,
	request: reqwest::Request,
	body_policy: BodyCachePolicy,
) -> Result<serde_json::Value, MetadataProviderError> {
	let url = request.url().to_string();

	if let Some(hit) = runtime.cache_get(provider, &url).await {
		return Ok(hit);
	}

	limiter.until_ready().await;
	let response = client.execute(request).await?;
	runtime.record_call(provider, &url).await;
	let response = response.error_for_status()?;
	let body: serde_json::Value = response.json().await?;
	if body_policy(&body) {
		runtime.cache_put(provider, &url, &body).await;
	} else {
		tracing::debug!(
			provider,
			"provider returned an error envelope; not caching the response"
		);
	}
	Ok(body)
}

#[cfg(test)]
mod tests {
	use std::{
		collections::HashMap,
		sync::atomic::{AtomicUsize, Ordering},
	};

	use wiremock::{
		matchers::{method, path},
		Mock, MockServer, ResponseTemplate,
	};

	use super::*;
	use crate::{
		client::{build_client_with_retry, default_metadata_client, RetryClientConfig},
		response_cache::cache_key,
	};

	/// In-memory runtime keyed by [`cache_key`] — caches everything, counts calls.
	#[derive(Default)]
	struct MemRuntime {
		store: tokio::sync::Mutex<HashMap<String, serde_json::Value>>,
		calls: AtomicUsize,
	}

	#[async_trait::async_trait]
	impl ProviderRuntime for MemRuntime {
		async fn cache_get(
			&self,
			_provider: &str,
			url: &str,
		) -> Option<serde_json::Value> {
			self.store.lock().await.get(&cache_key(url)).cloned()
		}
		async fn cache_put(&self, _provider: &str, url: &str, body: &serde_json::Value) {
			self.store.lock().await.insert(cache_key(url), body.clone());
		}
		async fn record_call(&self, _provider: &str, _url: &str) {
			self.calls.fetch_add(1, Ordering::SeqCst);
		}
		async fn budget_exhausted(&self, _provider: &str) -> bool {
			false
		}
	}

	fn test_client() -> ClientWithMiddleware {
		build_client_with_retry(default_metadata_client(), RetryClientConfig::default())
	}

	#[tokio::test]
	async fn second_identical_request_is_served_from_cache() {
		let server = MockServer::start().await;
		Mock::given(method("GET"))
			.and(path("/api/issue/9910/"))
			.respond_with(
				ResponseTemplate::new(200).set_body_json(serde_json::json!({"id": 9910})),
			)
			.expect(1) // the whole point: exactly one network hit for two calls
			.mount(&server)
			.await;

		let client = test_client();
		let runtime = MemRuntime::default();
		let limiter = RateLimiter::per_minute(600);
		let url = format!("{}/api/issue/9910/", server.uri());

		for _ in 0..2 {
			let request = client.get(&url).build().expect("request builds");
			let body = cached_get_json(
				&client,
				&runtime,
				&limiter,
				"metron",
				request,
				always_cacheable,
			)
			.await
			.expect("request succeeds");
			assert_eq!(body["id"], 9910);
		}

		assert_eq!(
			runtime.calls.load(Ordering::SeqCst),
			1,
			"only the cache miss lands in the ledger"
		);
		// MockServer verifies expect(1) on drop.
	}

	#[tokio::test]
	async fn api_key_differences_do_not_fragment_the_cache() {
		let server = MockServer::start().await;
		Mock::given(method("GET"))
			.and(path("/api/search/"))
			.respond_with(
				ResponseTemplate::new(200).set_body_json(serde_json::json!({"ok": true})),
			)
			.expect(1)
			.mount(&server)
			.await;

		let client = test_client();
		let runtime = MemRuntime::default();
		let limiter = RateLimiter::per_minute(600);

		for key in ["first", "second"] {
			let url = format!("{}/api/search/?api_key={key}&query=saga", server.uri());
			let request = client.get(&url).build().expect("request builds");
			cached_get_json(
				&client,
				&runtime,
				&limiter,
				"comic_vine",
				request,
				always_cacheable,
			)
			.await
			.expect("request succeeds");
		}

		assert_eq!(runtime.calls.load(Ordering::SeqCst), 1);
	}
}
