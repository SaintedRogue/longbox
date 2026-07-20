# Provider-Confirmed Loose-File Organizer — Design

**Date:** 2026-07-19
**Status:** Draft (awaiting user review)
**Author:** Michael Ahrendt (with Claude)

## Problem

Longbox derives series from the directory tree: one series per folder that
directly contains media, named after that folder (`SeriesBuilder::build` sets
`name = path.file_name()`), and it re-derives this on **every** scan. Because
`walk_library` walks with `min_depth(0)`, the library root itself becomes a
series when comic files sit loose in it.

The observed symptom: with the library root directory named `data`, a handful of
loose files (e.g. `Jays of Future Past.cbz`) collapse into a single junk series
named `data` instead of landing in their correct per-series folders. Metadata
matching cannot fix this — series _membership_ is folder-bound and set once at
scan time (`MediaBuilder` writes `media.series_id`); no metadata code path ever
reassigns `series_id`, and `series_metadata` is one row per series, so it can
only relabel/annotate the single `data` bucket, never split it.

## Goal

Detect misfiled loose files, determine each file's correct series using the
**metadata provider's canonical series (volume) identity**, physically move the
file into a `Canonical Name (Year)/` folder, and re-point its existing DB record
— **preserving read progress, favorites, and history**. Ship as **both** a
manual preview-first action and an opt-in per-library auto-on-scan toggle.

## Non-goals (YAGNI for v1)

- Renaming the files themselves (we only move them into folders; filenames are
  preserved).
- Full-library re-normalization of already-correct per-series folders.
- One-click undo UI (we keep an audit log of moves for manual reversal, but no
  dedicated undo flow).
- Splitting existing top-level collections in CollectionBased libraries (that
  grouping is intended by the pattern).

## Key decisions (from brainstorming)

1. **Physically move files** rather than logical/virtual DB grouping. The
   filesystem is Longbox's source of truth; every scan, `series_scan_job`, and
   the `library_watcher` re-derive series from folders, so DB-only grouping is
   perpetually one rescan away from being undone and would create a permanent
   class of "series whose path isn't a real directory" that all scanner code
   must special-case. Per-series folders are also the conventional layout
   (Mylar/Kavita/ComicRack).
2. **Both triggers:** a manual preview-first action and an opt-in per-library
   `auto_organize_loose_files` toggle.
3. **Provider-confirmed matching**, keyed on the provider's canonical volume ID
   — so `Batman (2011)` and `Batman (2016)` are correctly separated, which pure
   filename parsing would wrongly merge.
4. **Destination folder** = sanitized `Canonical Name (Year)/` at the **library
   root**; also write `series_metadata` (title, comicid, metadata_external_id)
   from the confirmed match so `resolved_name` shows the canonical title and the
   match is cached for future runs.
5. **Scope:** root-loose files + SeriesBased catch-all folders; CollectionBased
   libraries are supported (root-loose files only; existing collections
   respected).

## Architecture

### New components

- **`LongboxJob::OrganizeLooseFiles`** — new job variant modeled on
  `LibraryScan`, enqueued via `core.enqueue(...)`, implementing `JobLifecycle`.
  Two modes:
  - `Plan` — dry-run: detect, confirm, bucket, and produce an `OrganizePreview`.
    No filesystem or `media`/`series` writes.
  - `Apply { decisions }` — execute the (possibly user-adjusted) plan: move files
    and reconcile the DB.
- **`core/src/filesystem/organizer/`** — new module, kept separate from
  `scanner/` so the scan path stays focused:
  - `candidates.rs` — pattern-aware candidate detection.
  - `confirm.rs` — parse-to-batch grouping + provider confirmation + bucketing.
  - `plan.rs` — `OrganizePreview` construction (buckets, proposed moves).
  - `apply.rs` — move + DB reconcile executor (transactional, audit-logged).
  - `paths.rs` — destination path computation + filesystem-safe sanitization.
- **GraphQL** (`crates/graphql`):
  - `mutation planOrganizeLooseFiles(libraryId: ID!): JobId` — enqueues a Plan
    job (async because provider confirms are slow).
  - `query organizePreview(libraryId: ID!): OrganizePreview` — reads the latest
    stored preview report.
  - `mutation applyOrganizeLooseFiles(libraryId: ID!, decisions: [OrganizeDecisionInput!]!): JobId`
    — enqueues an Apply job.
  - New object types: `OrganizePreview`, `OrganizeProposedMove`,
    `OrganizeBucketedFile`, and enum `OrganizeBucket { CONFIDENT, AMBIGUOUS, UNMATCHED }`.
  - Requires `cargo dump-schema` + `yarn workspace @longbox/graphql codegen`.
- **`library_config.auto_organize_loose_files: bool`** (default `false`) — new
  column (migration in `crates/migrations`) + entity field + GraphQL input/object.
  Drives the auto-on-scan path.

### Reused (no reinvention)

- `parse_comic_filename` → `ParsedComicName { series, number, year }`
  (`crates/integrations/metadata/src/filename.rs`) — batching only, not authority.
- `fetch_series_metadata` / provider `search_series` + `ProviderClientCache`
  (`core/src/filesystem/metadata/fetch.rs`) — provider confirmation.
- `MatchCandidate { provider, external_id, metadata, confidence: f32, .. }` —
  confidence-based bucketing.
- `SeriesBuilder` — creating new series records for destination folders.

## Detection & bucketing algorithm

### 1. Pattern-aware candidate selection

For each directory that directly contains media:

- **Both patterns — library root:** all direct media are candidates (the root
  must never be a series).
- **SeriesBased — non-root folder:** candidate iff its direct media parse to
  **≥2 distinct provisional series** (a catch-all dump). A folder resolving to
  exactly one series is already correct → **left untouched** (no churn).
- **CollectionBased — non-root folders:** **never** candidates. Top-level folders
  are intended collections and everything beneath them is intentionally
  flattened into that collection; only root-loose files are organized.

Provisional series identity for the ≥2-distinct test uses a normalized form of
`parse_comic_filename(...).series` (case-insensitive, whitespace-collapsed).

### 2. Parse-to-batch

Run `parse_comic_filename` on every candidate → provisional group key
`{normalized_series, year}`. This bounds provider calls (one per distinct group,
not per file); it does **not** decide the final series.

### 3. Confirm once per group

For each distinct provisional group, call provider `search_series` a single time
(via the existing `fetch_series_metadata` path with a `SearchQuery` built from
`{series, number, year}`), and key the real grouping on the returned
`MatchCandidate.external_id` (canonical volume). Groups whose confirmation is
already cached (an existing series in the library carries a matching
`series_metadata.metadata_external_id`) skip the network entirely.

### 4. Bucketing by confidence

Using `MatchCandidate.confidence` (0.0–1.0) against two thresholds
(`HIGH`, `LOW` — configurable constants, initial values e.g. 0.85 / 0.5):

- **Confident** (`confidence >= HIGH`) → propose a move.
- **Ambiguous** (`LOW <= confidence < HIGH`) → propose, flagged for review.
- **Unmatched** (`confidence < LOW`, no match, or provider error) → **file stays
  put**; surfaced for manual input. We never fabricate a series for an unmatched
  file.

## The move + DB reconciliation (safety-critical)

- **Destination:** `<library_root>/<Sanitized Canonical Name (Year)>/<original filename>`.
  Filenames are not renamed. Sanitization strips filesystem-illegal characters
  and trims to a safe length. Year comes from the confirmed match; if the
  provider returns no year, fall back to `Sanitized Canonical Name/` (documented
  edge case — may collide across volumes; flagged in the preview).
- **Merge into existing:** if a series already exists in the library with a
  matching `metadata_external_id` (or whose path equals the computed
  destination folder), move the file _into_ it and reuse its `series_id` rather
  than creating a duplicate.
- **Atomic per file:** move the file (same-filesystem `rename`; cross-device →
  copy + verify + delete), then **update the existing `media` record's `path`
  and `series_id`** in the _same transaction_ as any series/`series_metadata`
  creation. There is no "move then blind rescan" — a blind rescan would see the
  old path as _missing_ and the new path as _new media_, silently orphaning read
  progress, favorites, and history.
- **Collision:** if the destination file already exists, **skip and flag** —
  never overwrite.
- **Audit log:** every executed move records `{media_id, src, dst, ts}` for
  manual reversal (persisted, e.g. to a `library_scan_record`-style table or a
  dedicated `organize_move_record`).
- **Cleanup:** after media move out of a source series that is now empty (e.g.
  the old `data` root series), remove the empty series record.

## Two flows

### Manual (preview-first)

1. User triggers `planOrganizeLooseFiles(libraryId)`.
2. Plan job detects, confirms, buckets, persists an `OrganizePreview` (grouped
   proposed moves + Ambiguous + Unmatched lists).
3. UI renders the preview. User resolves the non-confident tail — assign an
   Ambiguous/Unmatched file to a series (including series created in this run),
   or exclude it — and confirms.
4. `applyOrganizeLooseFiles(libraryId, decisions)` executes the resolved plan.

This is where **"book 1 matched, book 3 not"** resolves: book 1 (Confident)
creates/joins the series; book 3 (Unmatched) stays loose and appears in the
review list for a one-click assignment into that same series. The series is never
split by guessing on book 3.

### Auto-on-scan (`auto_organize_loose_files = true`)

After a scan completes, run a Plan using **cached confirmations only** (no live
provider calls in the scan hot path — critical given Metron is IP-banned on this
deployment's egress and provider fetches can exceed 120s), then auto-apply
**only the Confident bucket**. Ambiguous + Unmatched are left in place and
logged, never auto-moved.

## Error handling & degradation

Every failure mode — provider down/banned/timeout, no match, low confidence,
destination collision, move I/O error — results in the file being **left in
place** and reported in a bucket. Worst case (provider unreachable) degrades to
"nothing confident, everything deferred," surfaced clearly. No failure ever
produces a destructive or incorrect move. DB reconciliation is transactional, so
a mid-run failure cannot leave a file moved on disk but stale in the DB.

## Testing

- **Unit:**
  - Candidate rule: root always; SeriesBased catch-all (≥2) selected, clean
    single-series folder skipped; CollectionBased non-root folders skipped, root
    selected.
  - Confidence → bucket boundaries.
  - Destination path computation + sanitization; no-year fallback.
  - Collision handling; merge-into-existing by `metadata_external_id`.
- **Integration** (extend `core/integration-tests/tests/scanner.rs` with a
  mocked metadata provider):
  - Temp library with loose files → Plan asserts correct buckets.
  - Apply asserts files moved on disk, `media.path` + `series_id` updated,
    **read progress preserved**, empty source series cleaned.
  - Provider-failure path asserts nothing moved and all files intact.
  - CollectionBased library asserts collections are not split.
- **Frontend:** preview render, tail resolution UI, apply flow.
- **CI gates:** `cargo fmt`, `cargo clippy -D warnings`, `cargo dump-schema --check`,
  `cargo test`, `yarn lint`, `yarn test`, plus regenerated GraphQL TS client.

## Risks & open questions

- **Provider latency / Metron ban:** real-world runs on this deployment may
  mostly _defer_ (Unmatched) until matches are cached. Acceptable by design and
  surfaced in the preview; the cache warms over successive runs.
- **Volume disambiguation depends on the provider returning a year.** No-year
  matches fall back to a year-less folder and are flagged.
- **CollectionBased semantics (assumption to confirm):** v1 organizes only
  root-loose files in CollectionBased libraries and never splits existing
  top-level collections. If the intent is different (e.g. also re-home files
  from a specific "downloads" subfolder), that needs a follow-up.
- **Confidence thresholds** (`HIGH`/`LOW`) start as constants; may later warrant
  per-library configurability.
