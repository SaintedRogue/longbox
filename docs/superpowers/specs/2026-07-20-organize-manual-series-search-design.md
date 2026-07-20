# Manual Series Search for the Organize Flow — Design

**Date:** 2026-07-20
**Status:** Approved (brainstorm)
**Feature #4 on the loose-file-organizer roadmap** (after #1 root-only scan, #2 parser
flexibility, #3 targeted organize).

## Problem

The organize flow (both library-wide and the targeted/scoped variant) matches each loose
file to a series **fully automatically**:

1. `parse_comic_filename` derives a **series query** from the filename.
2. `search_series_candidates` sends it to every enabled provider, sorts by confidence.
3. `confirm_from_candidates` takes the **top** candidate and buckets it:
   `>= 0.85` Confident, `>= 0.5` Ambiguous, `< 0.5` Unmatched.

Unruly filenames fail one of two ways: the parser mis-splits the series (subtitle bleed,
no clean issue number), or the best provider hit scores under 0.5. Either way the file
lands in **Unmatched with no way to intervene** — the user cannot tell it "the series is
actually X." No amount of parser tuning fully closes this; the escape hatch is a **manual
search + pick**. Concrete failure: "Jay and Silent Bob" comes back unmatched.

## Goal

Let the user, from any organize preview row, open a **launched picker** to **edit the
series search query, choose a provider, search, and select** the correct series — turning
that file into a proposed move that files correctly on Apply. Available on **every row**
(Unmatched, Ambiguous, and to override a wrong Confident match).

## Non-goals

- No new parser heuristics (a separate, complementary track).
- No issue-level metadata editing — this is a **series**-level search (it picks the
  destination folder). Issue metadata is still the existing per-issue `ProviderMatchDialog`.
- No automated Metron connection/validation of any kind (see Metron compliance).

## Architecture

The feature lives on the seam between two existing pipelines that both wrap the same
provider `search_series` call but differ on **identity**: metadata-match keys on an
existing `media_id`/`series_id`; organize keys on a **file `src` path** because the entity
isn't filed yet. We reuse the metadata-match _UI_ and the organize _apply_ path, bridged
by one thin, non-persisting search resolver.

### 1. Backend — one search resolver + a minimal core tweak

**Core** (`core/src/filesystem/organizer/confirm.rs`): add an optional provider filter to
`search_series_candidates`:

```rust
pub async fn search_series_candidates(
    conn: &DatabaseConnection,
    library_type: &LibraryType,
    series_query: &str,
    year: Option<i32>,
    provider_filter: Option<MetadataProvider>,   // NEW; None = all enabled (unchanged auto path)
    provider_cache: &ProviderClientCache,
) -> Result<Vec<MatchCandidate>, CoreError>
```

Apply the existing `filter_to_provider(configs, provider_filter)` helper (already used by
`core/src/filesystem/metadata/fetch.rs`) to the enabled+overlapping configs. The two
existing callers in `plan.rs` pass `None`.

**GraphQL** (`crates/graphql/src/query/organize.rs`): new query

```graphql
organizeSearchSeries(
  libraryId: ID!,
  title: String!,
  year: Int,
  provider: MetadataProvider
): [MatchCandidate!]!
```

- Guard `PermissionGuard::one(UserPermission::ScanLibrary)` (matches the rest of organize).
- `library::Entity::find_for_user(user)` scoped by `libraryId` (IDOR prevention).
- Load `library_config` for `library_type` + build a `ProviderClientCache` from the
  encryption key (same as `organizePreviewForPath`).
- Call `search_series_candidates(conn, &library_type, &title, year, provider, &cache)`.
- Returns the existing `MatchCandidate` GraphQL type — the compare-grid already renders it.
- A **query, not a mutation**, and **not persisted** — never writes a `metadata_fetch_record`
  for a series that doesn't exist yet (same posture as `organizePreviewForPath`).

No new apply logic: `applyOrganizeLooseFiles` already accepts
`OrganizeDecisionInput { src, seriesId?, canonicalName, year?, externalId, provider }` and
computes the destination folder + resolves-or-merges the series from those fields. A manual
override simply produces that decision for its `src`.

### 2. Frontend — reuse the grid, add a per-row launcher

**Extract** the reusable search UI from the shipped `ProviderMatchDialog.tsx` into a shared
`MetadataSearchPanel` component:

- Props: `{ seed: { title, year }, kind: 'series' | 'media', onSearch(query, provider) => Promise<Candidate[]>, onSelect(candidate) => void, busy }`.
- Owns: the editable query inputs (title/year; number/publisher shown only for `kind: 'media'`),
  the provider `<Select>`, the Search button, and the results compare-grid (`ResultRow`
  with cover + fields + `ConfidenceBadge` + Select).
- `ProviderMatchDialog` is refactored to consume it, passing its existing
  `fetchMediaMetadata`/`fetchSeriesMetadata` search + `acceptMediaMatch`/`acceptSeriesMatch`
  select. **Behavior of the existing per-issue/series flow must be unchanged** and is
  re-verified by its existing tests.

**New `OrganizeSeriesMatchDialog.tsx`** (launched picker):

- Props: `{ libraryId, src, seedTitle, seedYear, open, onOpenChange, onPicked(override) }`.
- Renders `<MetadataSearchPanel kind="series" seed={{title: seedTitle, year: seedYear}} onSearch={runOrganizeSearchSeries} onSelect={handlePick} />`.
- `onSearch` calls the `organizeSearchSeries` query (via `useGraphQLMutation`-style manual
  fetch or a lazy query) with the edited title/year/provider; returns candidates. Live and
  slow — show a busy state; **no auto-search on open** (fires only on the Search click).
- `onSelect(candidate)` → build an override `{ canonicalName: candidate.metadata.title,
year: candidate.metadata.year, externalId: candidate.externalId, provider: candidate.provider }`,
  call `onPicked(override)`, close.

**Row wiring** in `organizeMoves.tsx` + the two dialogs:

- Every row (proposed and unmatched) gets a **"Find match"** button that opens
  `OrganizeSeriesMatchDialog` seeded from the row (parsed series for unmatched, canonical
  name for proposed).
- The owning dialog (`ScopedOrganizeDialog` and `OrganizeLooseFilesDialog`) holds
  `overrides: Map<src, Override>` state. `onPicked` writes `overrides[src]`.
- Rendering: a row with an override renders as a **proposed move** (`filename → Canonical
(Year)`, auto-checked, a small "manual" badge). An **Unmatched** row with an override is
  promoted into the proposed section.
- `toDecisions` is extended to merge: for each `src`, an override (if checked) wins;
  otherwise a checked auto proposed-move is used as today. Overrides for `src` values that
  were originally unmatched are emitted as decisions too.

Because both dialogs already share `organizeMoves`/`PreviewRows`, the feature lands in the
**scoped** and **library-wide** flows together.

### 3. Metron compliance (standing rule)

The picker **never auto-searches** — the `organizeSearchSeries` call fires only on an
explicit Search click. Selecting Metron and clicking Search _is_ the user "doing it
manually." This adds **zero** automated Metron connection/validation. Default provider is
the first enabled config; Metron is selectable but never probed on its own.

## Data flow

```
Row "Find match"
  → OrganizeSeriesMatchDialog (seed title/year from row)
     → user edits query + picks provider + Search
        → organizeSearchSeries(libraryId, title, year, provider)  [query, not persisted]
           → search_series_candidates(..., provider_filter, ...)
              → provider.search_series  → [MatchCandidate] (sorted by confidence)
     → user Selects a candidate
        → override { src, canonicalName, year, externalId, provider }
  → dialog overrides[src] = override  (row now a checked proposed move)
  → Apply → toDecisions merges overrides → applyOrganizeLooseFiles
     → apply_plan computes dst folder + resolves/merges series + moves file + repoints media
```

## Error handling

- `organizeSearchSeries`: library not found / outside user's libraries → error (guarded).
  Provider failures are logged and yield an empty/partial candidate list (existing
  `search_series_candidates` behavior — one bad provider never fails the whole search).
- Picker: a search returning zero candidates shows an empty state + lets the user refine
  the query and search again. A network/provider error shows a retry.
- Apply is unchanged: each move is transactional; a bad `src` (outside root) is refused.

## Testing

- **Core:** `search_series_candidates` with `provider_filter = Some(p)` hits only provider
  `p`; `None` preserves today's all-enabled behavior (unit test with a stub provider set).
- **Resolver:** `organizeSearchSeries` returns candidates for a valid library; rejects a
  library id outside the user's libraries; is `ScanLibrary`-gated.
- **Frontend:** `toDecisions` merges an override over an auto result and emits a decision
  for a previously-unmatched `src` (unit test, extends the existing `toDecisions` test).
- **Regression:** the extraction of `MetadataSearchPanel` leaves the existing
  `ProviderMatchDialog` per-issue/series flow green (its existing tests + `check-types`).

## Files (anticipated)

- Modify: `core/src/filesystem/organizer/confirm.rs` (provider_filter), `plan.rs` (pass None).
- Modify: `crates/graphql/src/query/organize.rs` (+ `schema.graphql` regen).
- Create: `packages/browser/src/components/metadata/**/MetadataSearchPanel.tsx` (extracted).
- Modify: `ProviderMatchDialog.tsx` (consume the panel).
- Create: `.../organizer/OrganizeSeriesMatchDialog.tsx`.
- Modify: `.../organizer/organizeMoves.tsx`, `ScopedOrganizeDialog.tsx`,
  `OrganizeLooseFilesDialog.tsx` (Find-match button + overrides state + `toDecisions`).
- Modify: `packages/graphql` regen, `packages/sdk/src/constants.ts` (cache key),
  `packages/i18n` locales.
