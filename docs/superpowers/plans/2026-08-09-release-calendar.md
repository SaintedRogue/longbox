# Release Calendar + Follows + Updates Feed Implementation Plan (Phase 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Per-user series follows, an `expected_issues` skeleton table fed by a dual-provider (CV + Metron) daily oracle job, and the three user-facing surfaces: follow bells, a week-grid release calendar, and a follows-scoped updates feed — per the approved spec (`docs/superpowers/specs/2026-08-09-metadata-hardening-calendar-design.md`).

**Architecture:** One migration adds `series_follows` + `expected_issues`. The metadata crate gains a provider-trait method `fetch_upcoming_releases(window)` (default `OperationNotSupported`) implemented by CV and Metron through the Phase 1 cache/budget runtime. A new `ScheduledJobKind::ReleaseCalendarSync` dispatches an oracle pass that matches provider results to library series **by provider series-ID only** and upserts skeletons. GraphQL exposes follows mutations plus `releaseCalendar`/`updatesFeed` queries; the browser adds a Calendar scene, an Updates scene, and follow bells.

**Tech Stack:** Rust (SeaORM, async-graphql, apalis scheduler), React 19 + Tailwind 4 (`packages/browser`), gql.tada client.

## Global Constraints

- All Phase 1 constraints (clippy `-D warnings`, centralized deps, schema dump + TS codegen in the same task as any GraphQL change, forward-only migrations, GPL clean-room).
- Oracle window: `today − 14 days … today + 90 days`; hard cap 3000 issues per provider per sweep.
- Metron oracle ships **default-off** (`metron_enabled: false` in the job config) — egress IP currently banned; CV oracle defaults on.
- Matching is provider-series-ID only in v1 — no name/year fuzzy matching.
- Follows never touch anything download- or automation-related; no global `monitored` flag exists.
- "In library" for an expected issue is computed at query time by issue-number match against the series' media; **no media rows are created**.
- Updates feed: 30-day window, 500-item cap, `unread` = viewer has no completed read progress on the media.
- Calendar weeks are Sunday-aligned in UTC; `release_date` stored as ISO `YYYY-MM-DD` text (lexically sortable).

---

### Task 1: Migration + entities (`series_follows`, `expected_issues`)

**Files:**

- Create: `crates/migrations/src/m20260809_000200_follows_and_expected_issues.rs` (register in `lib.rs`)
- Create: `crates/models/src/entity/series_follow.rs`, `crates/models/src/entity/expected_issue.rs` (+ `mod.rs` exports)

**Interfaces:**

- `series_follows`: `id` (i32 auto), `user_id` text FK→users cascade, `series_id` text FK→series cascade, `created_at` DATETIME; unique `(user_id, series_id)` named `idx_sf_user_series`; index `user_id`, index `series_id`.
- `expected_issues`: `id` (i32 auto), `series_id` text FK→series cascade, `provider` text, `external_id` text, `number` text, `title` text null, `cover_url` text null, `release_date` text null (ISO date), `created_at` DATETIME; unique `(series_id, provider, external_id)` named `idx_ei_identity`; index `release_date`.

- [ ] Steps: write migration (book_groups pattern; check the users table's actual Iden name before the FK), entities (metadata_provider_config pattern — `expected_issue` derives `SimpleObject` for GraphQL, `series_follow` does not), `cargo migrate` against `core/dev.db`, verify with sqlite3, `cargo dump-schema` + TS codegen if the SimpleObject surfaces, commit `feat(db): series follows + expected issues tables`.

### Task 2: `fetch_upcoming_releases` provider capability

**Files:**

- Modify: `crates/integrations/metadata/src/provider.rs` (trait method), `types/entities.rs` or new `types/expected.rs` (data type), `providers/comic_vine.rs`, `providers/metron.rs`
- Test: wiremock tests in both provider files

**Interfaces:**

- `pub struct UpcomingRelease { pub series_external_id: String, pub external_id: String, pub number: Option<String>, pub title: Option<String>, pub cover_url: Option<String>, pub release_date: Option<String> /* ISO */ }`
- Trait: `async fn fetch_upcoming_releases(&self, start: chrono::NaiveDate, end: chrono::NaiveDate, cap: usize) -> MetadataResult<Vec<UpcomingRelease>>` with default `Err(OperationNotSupported)`.
- CV impl: paginated `GET /issues/?filter=store_date:{start}|{end}&sort=store_date:asc&field_list=id,name,issue_number,store_date,cover_date,image,volume&limit=100&offset=N` — through `request()` (cache/budget apply); `series_external_id` = `volume.id`; `release_date` = `store_date` else `cover_date`; stop at `cap` or last page.
- Metron impl: paginated `GET /issue/?store_date_range_after={start}&store_date_range_before={end}` following `next`; needs a window-item deserialize struct carrying `id`, `number`, `issue` (name), `store_date`, `cover_date`, `image`, `series{id}` — verify field names against Metron docs during implementation and mirror what the fixture shows.
- Wiremock tests: one page + a second page, cap enforcement, date mapping.

- [ ] Steps: TDD per provider; commit `feat(metadata): upcoming-releases capability for CV and Metron`.

### Task 3: `ReleaseCalendarSync` scheduled job

**Files:**

- Modify: `crates/models/src/shared/enums.rs` (`ScheduledJobKind::ReleaseCalendarSync`), `crates/models/src/entity/scheduled_job.rs` (`ReleaseCalendarConfig { comicvine_enabled: bool /* default true */, metron_enabled: bool /* default false */ }` + accessor)
- Create: `core/src/filesystem/metadata/release_calendar.rs` (`run_release_calendar_sync(ctx)`)
- Modify: `core/src/job/scheduler.rs` (dispatch arm)
- Test: sync logic against in-memory SQLite (seed series+series_metadata, fake `Vec<UpcomingRelease>`, assert upserts/updates)

**Logic:**

- For each enabled provider with a configured client: budget check first (defer whole provider sweep when `budget_exhausted`); `fetch_upcoming_releases(today−14d, today+90d, 3000)`.
- Build the series lookup map for that provider: `series_metadata` rows where `metadata_source == provider_id` keyed by `metadata_external_id`, plus (CV only) `comicid.to_string()`. Library-scoping is unnecessary here — a provider series-id maps per series row.
- Matched releases upsert `expected_issues` on `(series_id, provider, external_id)` updating `number`, `title`, `cover_url`, `release_date`. Unmatched results are dropped (they belong to series we don't have).
- Job summary logged: fetched N, matched M, upserted K per provider. Kind exposed in the scheduled-jobs UI picker (`packages/browser/.../jobs/utils.ts` KIND_OPTIONS + locale keys).

- [ ] Steps: TDD the pure matching/upsert fn; dispatch arm; enum + config + schema dump + codegen; commit `feat(core): release-calendar oracle job (dual provider, budget-aware)`.

### Task 4: GraphQL — follows, calendar, updates

**Files:**

- Create: `crates/graphql/src/mutation/series_follow.rs`, `crates/graphql/src/query/release_calendar.rs`
- Modify: mutation/query `mod.rs` roots; `cargo dump-schema`; `yarn workspace @longbox/graphql codegen`

**Interfaces:**

- Mutations: `followSeries(seriesId: ID!) -> Boolean` (idempotent upsert), `unfollowSeries(seriesId: ID!) -> Boolean`.
- Queries:
  - `followedSeriesIds -> [ID!]!` (viewer's).
  - `releaseCalendar(weekOffset: Int! = 0, scope: CalendarScope! = FOLLOWED) -> [CalendarDay!]!` where `CalendarDay { date: String!, entries: [CalendarEntry!]! }` and `CalendarEntry { seriesId, seriesName, number, title, coverUrl, releaseDate, inLibrary: Boolean! }`. Week = Sunday-aligned UTC window over `expected_issues.release_date`; scope FOLLOWED filters `series_id IN (viewer's follows)`, ALL is unfiltered; `inLibrary` = the series has media whose normalized issue number equals `number` (reuse `issue_numbers_match` semantics via a small SQL-side fetch + Rust compare; entries per week are few).
  - `updatesFeed(days: Int! = 30, cap: Int! = 500) -> UpdatesFeed { items: [UpdateItem!]!, capped: Boolean! }`, `UpdateItem { mediaId, seriesId, seriesName, mediaName, coverUrl … thumbnail via existing media URL patterns, createdAt, isRead: Boolean! }` — media with files created in-window in followed series, ordered `created_at DESC, id DESC`; `isRead` = finished session exists for viewer (mirror the on-deck/read-progress query pattern; find it in `crates/graphql/src/query/` during implementation).
- Both queries auth-gated with the standard `AuthContext` pattern; access respects existing library-access filtering helpers (`find_for_user` pattern) — check `media::find_for_series_id` for the precedent.

- [ ] Steps: implement, dump-schema, codegen, resolver tests where the module has precedent; commit `feat(graphql): follows, release calendar, updates feed`.

### Task 5: UI — follow bell, Calendar scene, Updates scene

**Files:**

- Create: `packages/browser/src/scenes/calendar/` (`CalendarScene.tsx`, week grid + tabs), `packages/browser/src/scenes/updates/` (`UpdatesScene.tsx`, day-grouped feed + unread toggle persisted to localStorage `longbox_updates_unread`)
- Modify: series header (`scenes/series/SeriesHeader.tsx`) + library series cards for the follow bell (optimistic toggle via `followSeries`/`unfollowSeries` + `followedSeriesIds` cache), router + sidebar entries (find the route/nav registries by following how an existing scene like book clubs is wired), i18n en-US/en-GB keys for every string.

**UX:**

- Calendar: prev/today/next week controls; tabs "My Pull List" (FOLLOWED) / "All Series" (ALL); day columns Sun–Sat; entry card = cover, series name, #number; badge `In library` vs `Expected`; empty state explains follows.
- Updates: day-grouped list, unread dot, unread-only toggle; each row links to the book overview.
- Follow bell: outline = not following, filled = following; aria-label per state; 44px touch target (mobile-header conventions).

- [ ] Steps: build with existing component primitives (`@longbox/components`), jest tests for pure helpers (week windowing, day grouping — put them in a `utils.ts` with colocated tests), `yarn lint && yarn test`; commit `feat(browser): calendar, updates feed, follow bells`.

### Task 6: Full gate + PR

- [ ] `.claude/skills/ci-preflight/scripts/preflight.sh`; fix anything red; push `feat/release-calendar`; PR "feat: follows + release calendar + updates feed" with the forward-only-migration note; spec link.

## Self-Review Notes

- Spec Phase 2 coverage: schema→T1, oracle→T2+T3, GraphQL→T4, UI→T5. Metron default-off honored in T3 config default. Provider-ID-only matching honored in T3. No-media-rows honored (T1 note + T4 inLibrary computation).
- Deviation from spec: none. YAGNI: no notifier integration in v1 (updates feed covers the need); no per-user calendar preferences.
- Names used consistently: `UpcomingRelease`, `fetch_upcoming_releases`, `ReleaseCalendarSync`, `ReleaseCalendarConfig`, `expected_issues`, `series_follows`, `releaseCalendar`, `updatesFeed`, `followSeries`/`unfollowSeries`/`followedSeriesIds`.
