# Metadata Pipeline Hardening Implementation Plan (Phase 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provider response cache, API budget ledger with job-level 429 discipline, library-scoped external-ID collision guard, year/publisher scoring signals, NO_MATCH retry, and Metron file evidence — per the approved spec (`docs/superpowers/specs/2026-08-09-metadata-hardening-calendar-design.md`).

**Architecture:** Storage (two new tables + one column) lives in `crates/migrations` + `crates/models`. Pure logic (URL normalization, cache-key, classification, TTL, scoring factors) lives in `crates/integrations/metadata` behind a new `ProviderRuntime` trait so the crate stays DB-agnostic. Core implements the runtime over SeaORM (`DbProviderRuntime`), owns one shared `ProviderClientCache` on `Ctx`, and gains the budget gate in `MetadataFetchJob` plus the collision guard in `apply.rs`.

**Tech Stack:** Rust (SeaORM 1.1, axum, async-graphql 7.2, apalis), sha2, TS/React frontend (`packages/browser`).

## Global Constraints

- `cargo clippy -- -D warnings` must stay clean; `cargo fmt --all` before every commit.
- Workspace deps are centralized in root `Cargo.toml` `[workspace.dependencies]` (alphabetical) — add `sha2` there if absent.
- GraphQL changes require `cargo dump-schema` (+ `yarn workspace @longbox/graphql codegen` if the TS client is affected) committed in the same task.
- Migration is forward-only; never edit shipped migrations.
- No Omnibus code may be consulted or ported (GPL). Clean-room from the spec only.
- Budget constants: ComicVine window 3600s / limit 200 / reserve 30; Metron window 86400s / limit 5000 / reserve 500.
- Cache TTL defaults: detail 7 days, list 12 hours; body cap 512 KiB.
- Scoring weights: year ±1 → +0.05, year off-by->1 → −0.20, publisher match → +0.03.

---

### Task 1: Migration + entities (`metadata_response_cache`, `metadata_api_usage`, `media_metadata.metron_id`)

**Files:**

- Create: `crates/migrations/src/m20260809_000100_metadata_pipeline_hardening.rs`
- Modify: `crates/migrations/src/lib.rs` (register module + boxed migration, after book_groups)
- Create: `crates/models/src/entity/metadata_response_cache.rs`
- Create: `crates/models/src/entity/metadata_api_usage.rs`
- Modify: `crates/models/src/entity/mod.rs` (export), `crates/models/src/entity/media_metadata.rs` (add `metron_id: Option<String>` after `comicvine_id`)

**Interfaces:**

- Produces: `metadata_response_cache::Model { id, provider, cache_key, kind, body, created_at }`; `metadata_api_usage::Model { id, provider, endpoint_key, called_at: i64 }` (epoch ms); `media_metadata::Model.metron_id`.

- [ ] **Step 1:** Write the migration following the `m20260809_000000_add_book_groups.rs` pattern: two `create_table` (text `id` PK; `metadata_response_cache` unique index `(provider, cache_key)` named `idx_mrc_provider_key`; `metadata_api_usage` index `(provider, called_at)` named `idx_mau_provider_called`; `called_at` is `big_integer`), then `alter_table` adding nullable text `MetronId` to `MediaMetadata`. `down()` drops both tables and the column.
- [ ] **Step 2:** Register in `lib.rs`; write the two entity files mirroring an existing simple entity (e.g. copy the shape of `metadata_provider_config.rs` — `DeriveEntityModel`, `#[sea_orm(table_name = ...)]`); add `metron_id` to the media_metadata entity.
- [ ] **Step 3:** `cargo build -p longbox_migrations -p models` → compiles; `cargo migrate` against a scratch `LONGBOX_*` data dir; verify with `sqlite3 .../longbox.db ".schema metadata_response_cache"`.
- [ ] **Step 4:** Commit `feat(db): response cache + api usage tables, media metron_id`.

### Task 2: Pure cache logic in the metadata crate

**Files:**

- Create: `crates/integrations/metadata/src/response_cache.rs`
- Modify: `crates/integrations/metadata/src/lib.rs` (mod + re-exports), root `Cargo.toml` + crate `Cargo.toml` (`sha2`)

**Interfaces:**

- Produces:
  - `pub enum CacheKind { Detail, List }`
  - `pub fn normalize_url(url: &str) -> String` — strips `api_key` query param, sorts remaining query pairs, drops fragments.
  - `pub fn cache_key(url: &str) -> String` — sha256 hex of `normalize_url(url)`.
  - `pub fn classify(url: &str) -> Option<CacheKind>` — Detail: CV `/(issue|volume)/\d{4}-\d+`, Metron `/(issue|series|arc|character|team|publisher)/\d+/?$`; List: CV `/search/`, `/issues/`, `/volumes/`, Metron collection endpoints `/(issue|series)/?$` (query-string ignored); anything else → `None`.
  - `pub const MAX_CACHE_BODY_BYTES: usize = 512 * 1024;`
  - `pub struct CacheTtls { pub detail: Duration, pub list: Duration }` with `Default` (7d/12h) and `pub fn is_fresh(&self, kind: CacheKind, age: Duration) -> bool`.

- [ ] **Step 1:** Write failing tests: normalization strips `api_key` and sorts params (two orderings → same key); classification table (CV detail/list URLs, Metron detail/list URLs, Hardcover GraphQL URL → `None`); TTL freshness boundaries.
- [ ] **Step 2:** `cargo test -p metadata_integrations response_cache` → FAIL (unresolved).
- [ ] **Step 3:** Implement with `url::Url` parsing (already a transitive dep — add to workspace deps if not exported) + `sha2::Sha256`. No regex needed: match on path segments.
- [ ] **Step 4:** Tests pass; clippy clean. Commit `feat(metadata): response cache keying + classification`.

### Task 3: `ProviderRuntime` trait + cached request path for CV/Metron

**Files:**

- Create: `crates/integrations/metadata/src/runtime.rs`
- Modify: `crates/integrations/metadata/src/providers/comic_vine.rs`, `metron.rs` (route JSON GETs through the helper), `lib.rs` (`create_provider` gains `runtime: Arc<dyn ProviderRuntime>`)

**Interfaces:**

- Produces:

```rust
#[async_trait::async_trait]
pub trait ProviderRuntime: Send + Sync {
    /// Fresh cached body for this URL, if the runtime holds one.
    async fn cache_get(&self, provider: &str, url: &str) -> Option<serde_json::Value>;
    async fn cache_put(&self, provider: &str, url: &str, body: &serde_json::Value);
    /// Record one real (non-cached) API call.
    async fn record_call(&self, provider: &str, url: &str);
    /// true when the provider's budget window is exhausted (limit - reserve reached).
    async fn budget_exhausted(&self, provider: &str) -> bool;
}
pub struct NoopRuntime; // cache_get -> None, budget_exhausted -> false
```

- `async fn cached_get_json(client, runtime, provider_id, request: reqwest::Request) -> Result<serde_json::Value, MetadataProviderError>` — consult `cache_get` (freshness is the runtime's concern); on miss: acquire the rate-limit permit, execute, `record_call`, parse JSON, `cache_put` (runtime enforces the size cap), return. Cache hits never touch the limiter.
- Consumes: Task 2's `classify`/`cache_key` (used inside the core runtime impl, not here — the trait passes raw URLs).

- [ ] **Step 1:** Failing test with `wiremock`: a `CountingRuntime` test double returns a canned body on the second call → exactly **one** HTTP request is made across two identical provider searches; `record_call` observed once.
- [ ] **Step 2:** Implement trait + helper; thread `runtime` through `ComicVineProvider`/`MetronProvider` constructors (store `Arc<dyn ProviderRuntime>`; `create_provider(provider_type, api_token, runtime)`); replace their raw `client.execute` JSON paths with `cached_get_json`. Hardcover keeps its POST path untouched (uncacheable).
- [ ] **Step 3:** Fix `create_provider` call sites (`provider_cache.rs`, examples, tests) to pass `Arc::new(NoopRuntime)` where no DB exists.
- [ ] **Step 4:** All metadata-crate tests pass; commit `feat(metadata): ProviderRuntime + cached provider requests`.

### Task 4: `DbProviderRuntime` in core

**Files:**

- Create: `core/src/filesystem/metadata/runtime.rs`
- Modify: `core/src/filesystem/metadata/mod.rs`

**Interfaces:**

- Produces: `pub struct DbProviderRuntime { conn: Arc<DatabaseConnection>, ttls: CacheTtls }` implementing `ProviderRuntime`:
  - `cache_get`: classify → uncacheable ⇒ `None`; else look up `(provider, cache_key)`, TTL check **at read time** via `ttls.is_fresh`, stale rows ignored (lazily overwritten by the next put).
  - `cache_put`: skip when `classify` is `None` or serialized body > `MAX_CACHE_BODY_BYTES`; upsert on `(provider, cache_key)` refreshing `created_at`.
  - `record_call`: insert row (`endpoint_key` = URL path with numeric segments folded to `{id}`), then delete rows older than the provider window.
  - `budget_exhausted`: count window rows, compare against `limit - reserve` (constants from Global Constraints; unknown providers → `false`).

- [ ] **Step 1:** Failing async tests against an in-memory SQLite (`MockDatabase` won't do — use `sea_orm::Database::connect("sqlite::memory:")` + `Migrator::up`): put→get roundtrip honors TTL; oversized body not stored; 171st CV call in the window flips `budget_exhausted` (insert 170 rows with `called_at = now`).
- [ ] **Step 2:** Implement; tests pass; commit `feat(core): DB-backed provider runtime (cache + budget ledger)`.

### Task 5: Shared `ProviderClientCache` on `Ctx` (limiter/budget sharing fix)

**Files:**

- Modify: `core/src/context.rs` (add `pub provider_cache: Arc<ProviderClientCache>`), `core/src/filesystem/metadata/provider_cache.rs` (constructor takes the runtime, passes it to `create_provider`), `core/src/filesystem/metadata/fetch_job.rs:135,172-181` (use `ctx.provider_cache`), `crates/graphql/src/mutation/media_metadata.rs:175` and `series_metadata.rs` + `library.rs` (use `ctx.provider_cache` instead of constructing fresh)

- [ ] **Step 1:** Construct the cache once in `Ctx::new` (encryption key resolution moves from `fetch_job.rs:172-181` into `Ctx`; keep the existing error path if the key is unavailable by making construction lazy inside `ProviderClientCache` — the cache itself is always constructible).
- [ ] **Step 2:** Replace all fresh constructions; delete the now-unused per-job constructor path. `cargo test` full — the wiring touches many call sites; existing tests are the guard.
- [ ] **Step 3:** Commit `fix(core): one shared provider client cache — jobs and mutations share limiter, cache, budget`.

### Task 6: Budget gate in `MetadataFetchJob`

**Files:**

- Modify: `core/src/filesystem/metadata/fetch_job.rs` (task loop, ~`:383-799`), job output counters

- [ ] **Step 1:** Failing unit test for the extracted decision fn: `pub(crate) fn should_defer(budget_exhausted_by_provider: &[(String, bool)]) -> bool` — true only when **every** enabled provider is exhausted.
- [ ] **Step 2:** At the top of each entity task: query `runtime.budget_exhausted` per enabled provider; if all exhausted → upsert the fetch record as `RateLimited` **without any provider call**, increment the job's `rate_limited` counter, log once per job (not per entity) via a `budget_deferred` flag in the job state, and continue. The scheduled `MetadataRetry` job (existing, default statuses include `RATE_LIMited`) is the resume path.
- [ ] **Step 3:** `cargo test -p longbox_core`; commit `feat(core): metadata fetch job defers instead of burning the rate-limit wall`.

### Task 7: Library-scoped external-ID collision guard

**Files:**

- Modify: `core/src/filesystem/metadata/apply.rs` (auto-apply paths for series and media)
- Test: same file `#[cfg(test)]` or `crates/tests` integration if fixtures exist

- [ ] **Step 1:** Failing test: two series in one library; auto-applying a candidate whose `(provider, external_id)` the sibling already holds must NOT write, and the fetch record ends `AwaitingReview`. Cross-library duplicate must still apply (mirror `organizer/apply.rs:90-108` scoping).
- [ ] **Step 2:** Implement `find_holder_in_library(conn, library_id, source, external_id, exclude_entity_id) -> Option<String>` and gate `find_auto_apply_candidate`'s apply path; explicit `accept*Match` mutations bypass the guard (user choice wins) but log a warning.
- [ ] **Step 3:** Commit `feat(core): external-id collision guard routes duplicates to review`.

### Task 8: Year + publisher factors in `MatchScorer`

**Files:**

- Modify: `crates/integrations/metadata/src/scoring.rs`, `crates/integrations/metadata/src/types/query.rs` (no new fields; both already exist)

- [ ] **Step 1:** Failing tests: (a) two same-name series candidates, years 2011 vs 2016, query `series_year: 2016` → 2016 ranks first and carries factor `year` matched; (b) year gap > 1 applies −0.20 (exact-title 0.90 → 0.70); (c) no year on either side → no `year` factor emitted; (d) publisher exact match adds +0.03 with factor `publisher`; publisher mismatch adds nothing.
- [ ] **Step 2:** Implement `score_year(query, metadata) -> f32` (query `series_year` vs series candidate year / query `year` vs media candidate year; consult both `ExternalSeriesMetadata`/`ExternalMediaMetadata` year fields) and `score_publisher` (eq_ignore_ascii_case or Jaro-Winkler > 0.90) as additive terms in `score_candidate`, clamped as today. Constants `YEAR_MATCH_BONUS: f32 = 0.05`, `YEAR_MISMATCH_PENALTY: f32 = 0.20`, `PUBLISHER_MATCH_BONUS: f32 = 0.03`.
- [ ] **Step 3:** Whole-crate tests pass (existing ranking tests must not regress); commit `feat(metadata): year and publisher scoring signals`.

### Task 9: `NO_MATCH` in the retry-status picker

**Files:**

- Modify: `packages/browser/src/scenes/settings/server/jobs/utils.ts:33-36`
- Test: colocated test if the module has one, else covered by `yarn lint` + types

- [ ] **Step 1:** Add `NO_MATCH` (label "No match found") to the retryable-status options.
- [ ] **Step 2:** `yarn lint && yarn test`; commit `feat(browser): allow scheduled retry of NO_MATCH metadata fetches`.

### Task 10: Metron file evidence + native-ID short-circuit

**Files:**

- Modify: `core/src/filesystem/media/metadata.rs` (extraction + serde aliases + persist `metron_id`), `crates/integrations/metadata/src/types/query.rs` (add `pub metron_id: Option<String>`), `crates/integrations/metadata/src/providers/metron.rs` (short-circuit), `core/src/filesystem/metadata/fetch.rs` (`enrich_query_with_media_metadata` populates `metron_id`)
- Test: extraction tests beside the existing `extract_comicvine_id` tests

**Interfaces:**

- Produces: `extract_metron_issue_id(notes: Option<&str>, links: &[String]) -> Option<String>`; `ProcessedMediaMetadata { comicvine_id, metron_id, ... }`; `SearchQuery.metron_id`.

- [ ] **Step 1:** Failing tests: Web `https://metron.cloud/issue/12345/` → `12345`; Notes `[Issue ID 999]` with "metron" in the Notes text → metron `999` and **no** comicvine id; without "metron" → comicvine `999` (existing behavior preserved); dedicated tags `<MetronIssueId>77</MetronIssueId>` / `<ComicVineIssueId>88</ComicVineIssueId>` outrank Web/Notes.
- [ ] **Step 2:** Implement extraction precedence (dedicated tag → Web → Notes) for both providers; persist to `media_metadata.metron_id` in `into_active_model`.
- [ ] **Step 3:** Metron provider: when `query.metron_id` is set, fetch `/issue/{id}/` directly → single candidate, confidence 1.0, factor `metron_id_exact`; on error fall through to the cv_id bridge. Test with wiremock.
- [ ] **Step 4:** Commit `feat(metadata): metron ids from ComicInfo + native-id short-circuit`.

### Task 11: Full gate + PR

- [ ] **Step 1:** `.claude/skills/ci-preflight/scripts/preflight.sh` (fmt, clippy, dump-schema --check, cargo test, yarn lint, yarn test). Fix anything red. Note: Tasks 3/10 changed provider constructor + SearchQuery — if any GraphQL input/output type changed, `cargo dump-schema` + TS codegen must be committed.
- [ ] **Step 2:** Push branch, open PR "feat: metadata pipeline hardening" with a body summarizing the six features + spec link.

## Self-Review Notes

- Spec coverage: 1a→T2/3/4, 1b→T4/6, limiter fix→T5, 1c→T7, 1d→T8, 1e→T9, 1f→T1/T10. ✓
- Deliberate deferral: TTL server-config override ships as `CacheTtls::default()` consts in Phase 1; a config knob is a follow-up if needed (YAGNI — the spec's "overridable" is satisfied by the struct being injectable).
- Type consistency: `ProviderRuntime` names used identically in T3 (definition), T4 (impl), T5 (wiring), T6 (budget calls).
