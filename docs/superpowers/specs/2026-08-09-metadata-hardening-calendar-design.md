# Metadata Pipeline Hardening + Release Calendar — Design

**Date:** 2026-08-09
**Status:** Approved
**Origin:** Data-backed comparison against `hankscafe/omnibus` (GPL-3.0 — behavioral
findings only; no code was or may be ported). Longbox's per-candidate scorer is
stronger than Omnibus's; Omnibus's pipeline discipline (caching, budget, retry,
identity guards) and its calendar/follows UX are the adoption targets.

## Decisions (locked with user)

1. **Scope:** all three phases, in order. Each phase is independently deployable.
2. **Calendar oracle:** dual-provider (ComicVine + Metron) from day one, with
   per-provider enable flags. Metron oracle ships **default-off** (current egress
   IP is firewall-banned by Metron; enable after VPN test or unban).
3. **Subscriptions:** per-user follows only. No global "monitored" flag, no
   acquisition/download machinery anywhere in Longbox.
4. **Sweep policy:** the background unmatched sweep reuses the existing
   per-provider `AutoApplyConfig` (threshold / merge strategy / field locks).
   No new global Trust/Confirm/Auto/Custom mode concept.

---

## Phase 1 — Metadata pipeline hardening

### 1a. Provider response cache

New SeaORM table `metadata_response_cache`:

| column       | type        | notes                         |
| ------------ | ----------- | ----------------------------- |
| `id`         | pk          |                               |
| `provider`   | text        | e.g. `COMIC_VINE`, `METRON`   |
| `cache_key`  | text        | SHA-256 hex of normalized URL |
| `kind`       | text        | `detail` \| `list`            |
| `body`       | text (JSON) | raw provider response         |
| `created_at` | timestamp   | refreshed on conflict upsert  |

Unique index `(provider, cache_key)`. Normalization: strip `api_key` (and any
credential-bearing params), sort remaining query pairs. Classification to
`detail`/`list` by URL shape per provider; unclassifiable URLs are never cached.

A caching layer inside `crates/integrations/metadata` (wrapping the existing
`client.rs` request path) consults the table before HTTP. TTLs are evaluated
**at read time** — defaults `detail` = 7 days, `list` = 12 hours, overridable via
server config — so a TTL change applies to existing rows immediately. Body cap
512 KiB (oversized responses skipped, not stored). Cache hits bypass the rate
limiter and the budget ledger (§1b). Providers receive a DB handle for cache and
ledger access via a small `ProviderRuntime` context threaded from core.

### 1b. API budget ledger + job-level 429 discipline

New SeaORM table `metadata_api_usage` (`id`, `provider`, `endpoint_key`,
`called_at`). Real (non-cached) calls append a row; writes prune rows older than
the provider's window. `endpoint_key` = path with numeric segments folded to
`{id}` (diagnostics only; budget counts all endpoints together).

Budget check `budget_exhausted(provider)` = `calls_in_window + reserve >= limit`:

| provider  | window | limit | reserve | stops at |
| --------- | ------ | ----- | ------- | -------- |
| ComicVine | 1 h    | 200   | 30      | 170      |
| Metron    | 24 h   | 5000  | 500     | 4500     |

`MetadataFetchJob` (`core/src/filesystem/metadata/fetch_job.rs`) changes:

- **Between tasks:** if the budget for every remaining enabled provider is
  exhausted, mark the remaining entities' fetch records `RATE_LIMITED` without
  firing requests and finish with a deferral summary in the job output.
- **On fatal 429 mid-task:** same halt-and-defer, replacing today's
  per-entity retry-and-continue (`fetch_job.rs:483-493`, `:690-700`).
- The scheduled `MetadataRetry` job (existing) is the resume mechanism.

**Limiter sharing fix:** `ProviderClientCache` becomes one shared instance in
core `Ctx` instead of being freshly constructed by GraphQL mutations
(`crates/graphql/src/mutation/media_metadata.rs:175` today gets a fresh
limiter, bypassing the job's rate budget). Jobs and interactive searches draw
from the same limiter, cache, and ledger.

### 1c. External-ID collision guard (library-scoped, app-level)

Before auto-applying a candidate, check whether another series/media **in the
same library** already holds `(metadata_source, metadata_external_id)`
(precedent: `core/src/filesystem/organizer/apply.rs:90-108` — IDs legitimately
repeat across libraries, so no DB unique constraint). On collision: do not
apply; set the fetch record to `AWAITING_REVIEW` with a collision note in the
record so it surfaces in the existing pending-matches review queue. Applies to
both the job auto-apply path and `accept*Match` mutations (accept warns but the
explicit user choice wins — collision blocks only silent auto-apply).

### 1d. Year + publisher signals in `MatchScorer`

`crates/integrations/metadata/src/scoring.rs` gains two factors (both emit
`ConfidenceFactor` rows):

- `year`: query `series_year` vs series-candidate year, or query `year` vs
  issue-candidate year. Within ±1 → **+0.05**; differing by >1 → **−0.20**;
  either side unknown → no factor.
- `publisher`: exact/Jaro-Winkler(>0.90) match of query vs candidate publisher
  → **+0.03**; no penalty on mismatch (publisher naming is noisy: imprints,
  renames). This wires the currently-dead `SearchQuery.publisher` field.

Weights are constants beside the existing ones; tests pin ranking behavior
(notably: multi-volume same-name disambiguation by year).

### 1e. `NO_MATCH` retryable in the scheduler UI

Add `NO_MATCH` to the retry-status picker
(`packages/browser/src/scenes/settings/server/jobs/utils.ts:33-36`). Backend
already accepts it. Combined with 1b + the per-provider auto-apply config, this
is the self-finishing unmatched sweep.

### 1f. Richer file evidence

- ComicInfo `Web`: extract Metron IDs (`metron.cloud/series/(\d+)`,
  `metron.cloud/issue/(\d+)`) alongside the existing ComicVine extraction.
- ComicInfo `Notes`: `[Issue ID N]` resolves to Metron when the Notes text
  mentions "metron", else ComicVine (existing behavior). `[CVDB N]` unchanged.
- Dedicated tag aliases: `ComicVineVolumeId`, `ComicVineIssueId`, `MetronId`,
  `MetronIssueId` (Omnibus/komf-tagged libraries). Dedicated tags outrank Web,
  which outranks Notes.
- New column `media_metadata.metron_id` (text, nullable) beside `comicvine_id`.
- Metron provider: native-ID short-circuit (`/issue/{id}/` direct fetch,
  confidence 1.0 factor `metron_id_exact`) before the existing cv_id bridge.

## Phase 2 — Follows, release calendar, updates feed

### Schema (one migration)

`series_follows`: `id`, `user_id` (FK users, cascade), `series_id` (FK series,
cascade), `created_at`; unique `(user_id, series_id)`; index `user_id`,
`series_id`.

`expected_issues`: `id`, `series_id` (FK series, cascade), `provider`,
`external_id`, `number` (text), `title` (nullable), `cover_url` (nullable),
`release_date` (date, nullable), `created_at`; unique
`(series_id, provider, external_id)`; index `release_date`.

Skeleton rows only — **no media rows are created**. "In library" is computed at
query time by issue-number matching (`issue_numbers_match` semantics) against
the series' media. Compatible with book-groups/standalone work.

### Oracle job

New scheduled job kind `ReleaseCalendarSync` (default cadence: daily).

- **CV oracle** (flag default-on when a CV provider is configured): paginated
  `/issues/?filter=store_date:{today−14d}|{today+90d}` sweep; volumes matched
  to series where `metadata_source = COMIC_VINE` via `metadata_external_id`
  or `series_metadata.comicid`. Upsert `expected_issues`; update
  `release_date` on existing rows.
- **Metron oracle** (flag **default-off**): `/issue/?store_date_range_after=…
&store_date_range_before=…` sweep; matched to Metron-bound series via
  `metadata_external_id`.
- Both run through the Phase 1 response cache and budget ledger; the job halts
  and defers exactly like `MetadataFetchJob`. Hard cap ~3000 issues per sweep.
- Matching is provider-series-ID only (no name/year fuzzy matching in v1).

### GraphQL

- Mutations: `followSeries(seriesId)`, `unfollowSeries(seriesId)`.
- Queries: `followedSeriesIds`, `releaseCalendar(weekOffset: Int, scope:
FOLLOWED | ALL)` (Sunday-aligned week window over `expected_issues` joined to
  in-library state), `updatesFeed(days: Int = 30, cap: Int = 500)` (file-backed
  media created in-window in followed series; `unread` = no completed read
  progress for the viewer; ordered `created_at desc, id desc`).
- `cargo dump-schema` + `yarn workspace @longbox/graphql codegen` per CI gate.

### UI

- Follow bell: `SeriesHeader` + library series cards (optimistic toggle).
- **Calendar** scene: week grid, prev/next week, tabs My Pull List (followed)
  / All Series; expected vs in-library badges; sidebar entry.
- **Updates** scene: day-grouped feed, unread-only toggle persisted to
  localStorage, cover thumbnails; sidebar entry.

## Phase 3 — Parser + image polish

### Filename parser (`crates/integrations/metadata/src/filename.rs`)

Stays hand-rolled (no regex). Additions:

- Chapter tokens: `ch`, `ch.`, `chapter`, and `c###` (digit-glued) parse as the
  issue-number position; sets a `has_chapter_token` marker.
- Guarded negative issues: `#-1`, `issue -1` yield number `-1`.
- Cross-reference guard: bracketed groups containing letters **and** digits
  (e.g. `(of 12)`, `(v2)`) are stripped whole, never mined for numbers (current
  behavior already strips brackets; the guard covers marker-bearing unbracketed
  trailing forms like `3 of 12` — `of N` tails are dropped).
- Volume tokens: integer part capped at 3 digits (`v2024` is a year, not vol).
- Year ranges: `1994-1996` bracketed groups yield the first year, not a number.

Each behavior lands with table-driven tests using real-world filename shapes.

### Images

- Width-whitelisted cover/thumbnail variants `[160, 320, 480, 640]` generated
  on demand into the thumbnail directory, keyed by source identity + width;
  full-size behavior unchanged for OPDS.
- `Cache-Control` on cover responses gains `stale-while-revalidate=86400`.
- Failure placeholders (cover/thumbnail render errors) are served with
  `no-store` so a busy-scan miss is retried, never cached (covers self-heal).

## Cross-cutting

- **TDD**; each phase ends green on the full `ci-preflight` gate (fmt, clippy
  `-D warnings`, `dump-schema --check`, `cargo test`, `yarn lint`, `yarn test`).
- **Forward-only migrations:** any phase adding a migration must be pushed to
  GHCR before an Unraid update (older binaries hard-panic on migrated DBs).
- Branches: `feat/metadata-hardening`, `feat/release-calendar`,
  `feat/parser-image-polish`; PR per phase (finer if a phase grows).
- GPL hygiene: clean-room implementation from this session's behavioral
  findings; Omnibus source is not consulted during implementation.
