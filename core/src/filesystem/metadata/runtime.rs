//! The DB-backed [`ProviderRuntime`]: response cache + API budget ledger over
//! SeaORM. This is what turns the metadata crate's cache/budget hooks into real
//! persistence — `metadata_response_cache` rows with read-time TTLs, and
//! `metadata_api_usage` rows counted over each provider's rolling window.

use std::sync::Arc;

use chrono::Utc;
use metadata_integrations::response_cache::{
	cache_key, classify, CacheTtls, MAX_CACHE_BODY_BYTES,
};
use models::entity::{metadata_api_usage, metadata_response_cache};
use sea_orm::{
	prelude::*, sea_query::OnConflict, ActiveValue::Set, DatabaseConnection, QueryFilter,
};

/// How a provider's published limit is scoped.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum BudgetScope {
	/// One pool for everything the provider serves (Metron's 5,000/day).
	Provider,
	/// A separate pool per resource — ComicVine's limit is documented as 200
	/// requests *per resource* per hour, so `/issues/` and `/volumes/` do not
	/// draw down each other's allowance. Counting them together (what this did
	/// before) declares the budget spent at a fraction of the real ceiling: a
	/// match run that touches volumes, issues and issue details across three
	/// resources used to hit "exhausted" after ~170 total calls instead of ~170
	/// against each.
	Resource,
}

/// Per-provider rolling budget: stop at `limit - reserve` calls per window,
/// counted over whatever [`BudgetScope`] the provider's limit applies to. The
/// reserve absorbs retry-middleware attempts (one ledger row per logical call)
/// and leaves headroom for interactive searches.
struct BudgetPolicy {
	window_ms: i64,
	limit: u64,
	reserve: u64,
	scope: BudgetScope,
}

impl BudgetPolicy {
	/// The point at which the provider should stop spending.
	fn ceiling(&self) -> u64 {
		self.limit.saturating_sub(self.reserve)
	}
}

/// Providers are keyed by their [`MetadataProvider::id`] strings. Unknown ids
/// (e.g. `hardcover`, which never passes a runtime) have no budget and are
/// never ledgered.
fn budget_policy(provider: &str) -> Option<BudgetPolicy> {
	match provider {
		// ComicVine: 200 requests/resource/hour; stop at 170 per resource.
		"comicvine" => Some(BudgetPolicy {
			window_ms: 3_600_000,
			limit: 200,
			reserve: 30,
			scope: BudgetScope::Resource,
		}),
		// Metron: 5,000 requests/day; stop at 4,500.
		"metron" => Some(BudgetPolicy {
			window_ms: 86_400_000,
			limit: 5_000,
			reserve: 500,
			scope: BudgetScope::Provider,
		}),
		_ => None,
	}
}

/// The resource an endpoint draws its budget from — the first path segment after
/// `/api/`, with ComicVine's singular detail endpoints folded onto their list
/// counterparts (`/issue/4000-123/` and `/issues/` are the same "issue" resource
/// as far as the published limit is concerned).
fn budget_resource(endpoint_key: &str) -> String {
	let segment = endpoint_key
		.split('/')
		.filter(|s| !s.is_empty() && *s != "api" && *s != "{id}")
		.map(str::to_ascii_lowercase)
		.next()
		.unwrap_or_default();
	// `issue`/`issues`, `volume`/`volumes`, ... are one resource.
	segment.strip_suffix('s').unwrap_or(&segment).to_string()
}

/// A provider's remaining allowance for the current rolling window.
///
/// ComicVine publishes no rate-limit headers — no `X-RateLimit-Remaining`, no
/// `-Reset`; a breach is reported only after the fact as `status_code` 107 in an
/// otherwise-200 body. So "how much is left and when does it come back" has to be
/// derived locally, from the ledger: `used` is the rows inside the window, and
/// `resets_in_ms` is how long until the *oldest* of them falls out of it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BudgetStatus {
	pub resource: String,
	pub limit: u64,
	pub used: u64,
	pub remaining: u64,
	/// Milliseconds until the window rolls far enough to free at least one call.
	/// `0` when nothing is currently counted against the budget.
	pub resets_in_ms: i64,
}

/// URL path with numeric segments folded to `{id}` — keeps the ledger readable
/// without storing per-entity URLs. Diagnostics only; budget counting ignores it.
fn endpoint_key(url: &str) -> String {
	let path = url::Url::parse(url)
		.map(|u| u.path().to_string())
		.unwrap_or_else(|_| url.to_string());
	path.split('/')
		.filter(|segment| !segment.is_empty())
		.map(|segment| {
			let numeric_ish = segment.chars().any(|c| c.is_ascii_digit())
				&& segment.chars().all(|c| c.is_ascii_digit() || c == '-');
			if numeric_ish {
				"{id}"
			} else {
				segment
			}
		})
		.fold(String::new(), |mut acc, segment| {
			acc.push('/');
			acc.push_str(segment);
			acc
		})
}

/// The budget-ledger key for a configured provider — must match the
/// [`MetadataProvider::id`] string each client passes to its runtime.
pub fn provider_budget_id(
	provider: &models::shared::enums::MetadataProvider,
) -> &'static str {
	match provider {
		models::shared::enums::MetadataProvider::ComicVine => "comicvine",
		models::shared::enums::MetadataProvider::Metron => "metron",
		models::shared::enums::MetadataProvider::Hardcover => "hardcover",
		models::shared::enums::MetadataProvider::Locg => "locg",
	}
}

pub struct DbProviderRuntime {
	conn: Arc<DatabaseConnection>,
	ttls: CacheTtls,
}

impl DbProviderRuntime {
	pub fn new(conn: Arc<DatabaseConnection>) -> Self {
		Self {
			conn,
			ttls: CacheTtls::default(),
		}
	}

	fn now_ms() -> i64 {
		Utc::now().timestamp_millis()
	}
}

#[async_trait::async_trait]
impl metadata_integrations::runtime::ProviderRuntime for DbProviderRuntime {
	async fn cache_get(&self, provider: &str, url: &str) -> Option<serde_json::Value> {
		let kind = classify(url)?;
		let row = metadata_response_cache::Entity::find()
			.filter(metadata_response_cache::Column::Provider.eq(provider))
			.filter(metadata_response_cache::Column::CacheKey.eq(cache_key(url)))
			.one(self.conn.as_ref())
			.await
			.ok()
			.flatten()?;
		// TTLs are evaluated here, at read time: stale rows are simply ignored
		// (and lazily overwritten by the next put) so a TTL change applies to
		// existing rows immediately.
		let age = Utc::now()
			.signed_duration_since(row.created_at)
			.to_std()
			.ok()?;
		if !self.ttls.is_fresh(kind, age) {
			return None;
		}
		serde_json::from_str(&row.body).ok()
	}

	async fn cache_put(&self, provider: &str, url: &str, body: &serde_json::Value) {
		let Some(kind) = classify(url) else {
			return;
		};
		let serialized = body.to_string();
		if serialized.len() > MAX_CACHE_BODY_BYTES {
			return;
		}
		let active = metadata_response_cache::ActiveModel {
			provider: Set(provider.to_string()),
			cache_key: Set(cache_key(url)),
			kind: Set(kind.as_str().to_string()),
			body: Set(serialized),
			created_at: Set(Utc::now().into()),
			..Default::default()
		};
		let result = metadata_response_cache::Entity::insert(active)
			.on_conflict(
				OnConflict::columns([
					metadata_response_cache::Column::Provider,
					metadata_response_cache::Column::CacheKey,
				])
				.update_columns([
					metadata_response_cache::Column::Kind,
					metadata_response_cache::Column::Body,
					metadata_response_cache::Column::CreatedAt,
				])
				.to_owned(),
			)
			.exec(self.conn.as_ref())
			.await;
		if let Err(error) = result {
			tracing::warn!(?error, provider, "failed to store cached provider response");
		}
	}

	async fn record_call(&self, provider: &str, url: &str) {
		let Some(policy) = budget_policy(provider) else {
			return;
		};
		let now = Self::now_ms();
		let active = metadata_api_usage::ActiveModel {
			provider: Set(provider.to_string()),
			endpoint_key: Set(endpoint_key(url)),
			called_at: Set(now),
			..Default::default()
		};
		if let Err(error) = metadata_api_usage::Entity::insert(active)
			.exec(self.conn.as_ref())
			.await
		{
			tracing::warn!(?error, provider, "failed to record provider API call");
		}
		// Prune on write: rows never outlive their window, so the table stays
		// bounded at roughly one window of traffic per provider.
		let _ = metadata_api_usage::Entity::delete_many()
			.filter(metadata_api_usage::Column::Provider.eq(provider))
			.filter(metadata_api_usage::Column::CalledAt.lt(now - policy.window_ms))
			.exec(self.conn.as_ref())
			.await;
	}

	/// Exhausted when *every* pool the provider draws from is at its ceiling.
	///
	/// For a provider-scoped budget that is the single pool. For a resource-scoped one
	/// (ComicVine) it is deliberately "all resources spent", not "any": burning through
	/// `/issues/` says nothing about whether a `/volumes/` lookup may proceed, and the
	/// callers (`fetch_job`, the release-calendar sweep) use this as a global stop
	/// signal that abandons the whole run. Counting every resource into one 200-call
	/// pool made that signal fire at roughly a third of ComicVine's real ceiling.
	async fn budget_exhausted(&self, provider: &str) -> bool {
		if budget_policy(provider).is_none() {
			return false;
		}
		let statuses = self.budget_status(provider).await;
		// Nothing recorded in the window: definitively not exhausted.
		!statuses.is_empty() && statuses.iter().all(|status| status.remaining == 0)
	}
}

impl DbProviderRuntime {
	/// Remaining allowance per pool for the current rolling window.
	///
	/// Returns one entry for a provider-scoped budget, and one per resource touched
	/// this window for a resource-scoped one. Empty when the provider has no policy,
	/// or has made no calls inside the window.
	pub async fn budget_status(&self, provider: &str) -> Vec<BudgetStatus> {
		let Some(policy) = budget_policy(provider) else {
			return Vec::new();
		};
		let now = Self::now_ms();
		let window_start = now - policy.window_ms;

		let rows = metadata_api_usage::Entity::find()
			.filter(metadata_api_usage::Column::Provider.eq(provider))
			.filter(metadata_api_usage::Column::CalledAt.gte(window_start))
			.all(self.conn.as_ref())
			.await
			.unwrap_or_default();

		if rows.is_empty() {
			return Vec::new();
		}

		// (used, oldest call) per pool.
		let mut pools: std::collections::HashMap<String, (u64, i64)> =
			std::collections::HashMap::new();
		for row in &rows {
			let pool = match policy.scope {
				BudgetScope::Provider => provider.to_string(),
				BudgetScope::Resource => budget_resource(&row.endpoint_key),
			};
			let entry = pools.entry(pool).or_insert((0, row.called_at));
			entry.0 += 1;
			entry.1 = entry.1.min(row.called_at);
		}

		let ceiling = policy.ceiling();
		let mut statuses: Vec<BudgetStatus> = pools
			.into_iter()
			.map(|(resource, (used, oldest))| BudgetStatus {
				resource,
				limit: ceiling,
				used,
				remaining: ceiling.saturating_sub(used),
				// The window is rolling, so capacity returns as the oldest call ages out.
				resets_in_ms: (oldest + policy.window_ms - now).max(0),
			})
			.collect();
		statuses.sort_by(|a, b| a.resource.cmp(&b.resource));
		statuses
	}
}

#[cfg(test)]
mod tests {
	use metadata_integrations::runtime::ProviderRuntime;
	use migrations::{Migrator, MigratorTrait};
	// `PaginatorTrait` is test-only now: `budget_status` reads the rows themselves
	// (it needs their `called_at` to compute the window reset), so the lib no longer
	// counts. Importing it at module scope would be an unused import in a lib build,
	// which CI's `clippy -D warnings` rejects.
	use sea_orm::{Database, PaginatorTrait};

	use super::*;

	async fn mem_runtime() -> DbProviderRuntime {
		let conn = Database::connect("sqlite::memory:")
			.await
			.expect("in-memory sqlite connects");
		Migrator::up(&conn, None).await.expect("migrations apply");
		DbProviderRuntime::new(Arc::new(conn))
	}

	const DETAIL_URL: &str = "https://metron.cloud/api/issue/9910/";

	#[tokio::test]
	async fn put_get_roundtrip_honors_ttl() {
		let runtime = mem_runtime().await;
		let body = serde_json::json!({"id": 9910, "number": "12"});

		runtime.cache_put("metron", DETAIL_URL, &body).await;
		assert_eq!(
			runtime.cache_get("metron", DETAIL_URL).await,
			Some(body.clone()),
			"fresh row must hit"
		);

		// Age the row past the 7-day detail TTL; the same row must now miss.
		let stale: DateTimeWithTimeZone = (Utc::now() - chrono::Duration::days(8)).into();
		metadata_response_cache::Entity::update_many()
			.col_expr(
				metadata_response_cache::Column::CreatedAt,
				Expr::value(stale),
			)
			.exec(runtime.conn.as_ref())
			.await
			.expect("row ages");
		assert_eq!(runtime.cache_get("metron", DETAIL_URL).await, None);
	}

	#[tokio::test]
	async fn oversized_and_uncacheable_bodies_are_not_stored() {
		let runtime = mem_runtime().await;

		let oversized = serde_json::json!({"blob": "x".repeat(MAX_CACHE_BODY_BYTES)});
		runtime.cache_put("metron", DETAIL_URL, &oversized).await;

		let uncacheable = serde_json::json!({"ok": true});
		runtime
			.cache_put(
				"hardcover",
				"https://api.hardcover.app/v1/graphql",
				&uncacheable,
			)
			.await;

		let rows = metadata_response_cache::Entity::find()
			.count(runtime.conn.as_ref())
			.await
			.expect("count");
		assert_eq!(rows, 0, "neither body may land in the cache");
	}

	#[tokio::test]
	async fn comicvine_budget_flips_at_170_calls() {
		let runtime = mem_runtime().await;
		let url = "https://comicvine.gamespot.com/api/issues/?filter=volume:1";

		for _ in 0..169 {
			runtime.record_call("comicvine", url).await;
		}
		assert!(
			!runtime.budget_exhausted("comicvine").await,
			"169 of 200 (reserve 30) still has headroom"
		);

		runtime.record_call("comicvine", url).await;
		assert!(
			runtime.budget_exhausted("comicvine").await,
			"170 + reserve 30 reaches the 200 limit"
		);
		// Unknown providers never exhaust.
		assert!(!runtime.budget_exhausted("hardcover").await);
	}

	/// ComicVine's limit is per resource, so spending the issue allowance must not
	/// abandon a run that still has volume lookups it is allowed to make.
	#[tokio::test]
	async fn comicvine_budget_is_tracked_per_resource() {
		let runtime = mem_runtime().await;
		let issues = "https://comicvine.gamespot.com/api/issues/?filter=volume:1";
		let volumes = "https://comicvine.gamespot.com/api/volumes/?filter=name:Saga";

		for _ in 0..170 {
			runtime.record_call("comicvine", issues).await;
		}
		runtime.record_call("comicvine", volumes).await;

		assert!(
			!runtime.budget_exhausted("comicvine").await,
			"the issue pool is spent but the volume pool has headroom, so the run continues"
		);

		let status = runtime.budget_status("comicvine").await;
		assert_eq!(status.len(), 2, "one pool per resource: {status:?}");
		let issue_pool = status
			.iter()
			.find(|s| s.resource == "issue")
			.expect("issue");
		assert_eq!(issue_pool.used, 170);
		assert_eq!(issue_pool.remaining, 0);
		let volume_pool = status
			.iter()
			.find(|s| s.resource == "volume")
			.expect("volume");
		assert_eq!(volume_pool.used, 1);
		assert_eq!(volume_pool.remaining, 169);
		assert!(
			volume_pool.resets_in_ms > 0 && volume_pool.resets_in_ms <= 3_600_000,
			"reset must fall inside the 1h window, got {}",
			volume_pool.resets_in_ms
		);
	}

	/// Singular detail endpoints draw from the same pool as their list counterpart --
	/// `/issue/4000-123/` and `/issues/` are one ComicVine resource.
	#[test]
	fn budget_resources_fold_singular_and_plural() {
		assert_eq!(budget_resource("/api/issue/{id}"), "issue");
		assert_eq!(budget_resource("/api/issues"), "issue");
		assert_eq!(budget_resource("/api/volume/{id}"), "volume");
		assert_eq!(budget_resource("/api/volumes"), "volume");
		assert_eq!(budget_resource("/api/search"), "search");
	}

	/// Metron's limit is a single daily pool, so every endpoint shares it.
	#[tokio::test]
	async fn metron_budget_is_a_single_pool() {
		let runtime = mem_runtime().await;
		runtime
			.record_call("metron", "https://metron.cloud/api/issue/1/")
			.await;
		runtime
			.record_call("metron", "https://metron.cloud/api/series/2/")
			.await;

		let status = runtime.budget_status("metron").await;
		assert_eq!(status.len(), 1, "provider-scoped: one pool, got {status:?}");
		assert_eq!(status[0].used, 2);
		assert_eq!(status[0].remaining, 4_498);
	}

	#[tokio::test]
	async fn record_call_prunes_rows_outside_the_window() {
		let runtime = mem_runtime().await;

		let ancient = metadata_api_usage::ActiveModel {
			provider: Set("comicvine".to_string()),
			endpoint_key: Set("/api/issues".to_string()),
			called_at: Set(DbProviderRuntime::now_ms() - 7_200_000), // 2h ago
			..Default::default()
		};
		metadata_api_usage::Entity::insert(ancient)
			.exec(runtime.conn.as_ref())
			.await
			.expect("seed row");

		runtime
			.record_call(
				"comicvine",
				"https://comicvine.gamespot.com/api/issue/4000-1/",
			)
			.await;

		let rows = metadata_api_usage::Entity::find()
			.count(runtime.conn.as_ref())
			.await
			.expect("count");
		assert_eq!(
			rows, 1,
			"the 2h-old row is outside the 1h window and pruned"
		);
	}

	#[test]
	fn endpoint_keys_fold_ids() {
		assert_eq!(
			endpoint_key("https://comicvine.gamespot.com/api/issue/4000-123/?api_key=x"),
			"/api/issue/{id}"
		);
		assert_eq!(
			endpoint_key("https://metron.cloud/api/series/120/"),
			"/api/series/{id}"
		);
		assert_eq!(
			endpoint_key("https://metron.cloud/api/issue/?cv_id=1"),
			"/api/issue"
		);
	}
}
