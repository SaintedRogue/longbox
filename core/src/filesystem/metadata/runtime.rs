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
	prelude::*, sea_query::OnConflict, ActiveValue::Set, DatabaseConnection,
	PaginatorTrait, QueryFilter,
};

/// Per-provider rolling budget: stop at `limit - reserve` calls per window. The
/// reserve absorbs retry-middleware attempts (one ledger row per logical call)
/// and leaves headroom for interactive searches.
struct BudgetPolicy {
	window_ms: i64,
	limit: u64,
	reserve: u64,
}

/// Providers are keyed by their [`MetadataProvider::id`] strings. Unknown ids
/// (e.g. `hardcover`, which never passes a runtime) have no budget and are
/// never ledgered.
fn budget_policy(provider: &str) -> Option<BudgetPolicy> {
	match provider {
		// ComicVine: 200 requests/resource/hour; stop at 170.
		"comicvine" => Some(BudgetPolicy {
			window_ms: 3_600_000,
			limit: 200,
			reserve: 30,
		}),
		// Metron: 5,000 requests/day; stop at 4,500.
		"metron" => Some(BudgetPolicy {
			window_ms: 86_400_000,
			limit: 5_000,
			reserve: 500,
		}),
		_ => None,
	}
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

	async fn budget_exhausted(&self, provider: &str) -> bool {
		let Some(policy) = budget_policy(provider) else {
			return false;
		};
		let window_start = Self::now_ms() - policy.window_ms;
		let calls = metadata_api_usage::Entity::find()
			.filter(metadata_api_usage::Column::Provider.eq(provider))
			.filter(metadata_api_usage::Column::CalledAt.gte(window_start))
			.count(self.conn.as_ref())
			.await
			.unwrap_or(0);
		calls + policy.reserve >= policy.limit
	}
}

#[cfg(test)]
mod tests {
	use metadata_integrations::runtime::ProviderRuntime;
	use migrations::{Migrator, MigratorTrait};
	use sea_orm::Database;

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
