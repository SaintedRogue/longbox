# Manual Series Search for the Organize Flow — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user open a launched picker from any organize preview row, edit the series search query, choose a provider, search, and select the correct series — filing an otherwise-unmatched (or mis-matched) loose file correctly on Apply.

**Architecture:** Reuse the existing metadata-match compare-grid UI and the existing organize apply path, bridged by one thin, non-persisting series-search GraphQL query. The organize flow keys on the file `src` path (not an entity id); a manual "Select" records an override for that `src` that rides the existing `applyOrganizeLooseFiles` decision path.

**Tech Stack:** Rust (async-graphql 7.2, SeaORM 1.1), React 19 + gql.tada, @longbox/{components,client,graphql,i18n}.

## Global Constraints

- **No automated Metron connection/validation of any kind.** The picker's search fires **only** on an explicit user Search click; nothing auto-searches on open/type. Metron is selectable but never probed on its own.
- **Series-level search only** — the picker chooses a destination folder, not issue metadata.
- **Adding a GraphQL field** requires `cargo dump-schema` (schema-drift gate) **and** `yarn workspace @longbox/graphql codegen`, both committed.
- **react-compiler is on**: follow Rules of React, no `eslint-disable`, functional `setState`, no refs for render-driving state.
- **DRY**: extract the shared search panel from `ProviderMatchDialog`; do not fork the compare grid.
- **jest import rule**: in any file reachable by jest, import `ConfidenceBadge` from its concrete path `@/components/metadata/metadataMatching/reviewDialog/ConfidenceBadge`, never the `metadataMatching` barrel (avoids a react-markdown transform break).
- The feature must land in **both** the scoped (`ScopedOrganizeDialog`) and library-wide (`OrganizeLooseFilesDialog`) flows via the shared `organizeMoves.tsx`.
- CI gates (reproduce before pushing): `cargo fmt --all -- --check`, `cargo clippy -- -D warnings`, `cargo dump-schema -- --check`, `cargo test`, `yarn lint`, `yarn test`, `yarn workspace @longbox/browser check-types`.

---

### Task 1: Core — single-provider filter on `search_series_candidates`

**Files:**

- Modify: `core/src/filesystem/metadata/fetch.rs:74` (`filter_to_provider` → `pub(crate)`; add a unit test)
- Modify: `core/src/filesystem/organizer/confirm.rs:170-210` (add `provider_filter` param, apply the helper)
- Modify: `core/src/filesystem/organizer/plan.rs:220` (pass `None` at the only caller)

**Interfaces:**

- Produces: `search_series_candidates(conn, library_type: &LibraryType, series_query: &str, year: Option<i32>, provider_filter: Option<MetadataProvider>, provider_cache: &ProviderClientCache) -> Result<Vec<MatchCandidate>, CoreError>` — `MetadataProvider` is `models::shared::enums::MetadataProvider`.
- Consumes: `filter_to_provider(configs: Vec<metadata_provider_config::Model>, provider: Option<MetadataProvider>) -> Vec<metadata_provider_config::Model>` (already exists in `fetch.rs`).

- [ ] **Step 1: Make the helper reusable + write its failing test.** In `core/src/filesystem/metadata/fetch.rs` change `fn filter_to_provider` (line 74) to `pub(crate) fn filter_to_provider`. Add to that file's `#[cfg(test)] mod tests` (create the module if absent):

```rust
#[cfg(test)]
mod filter_tests {
    use super::filter_to_provider;
    use models::entity::metadata_provider_config;
    use models::shared::enums::MetadataProvider;

    fn cfg(provider: MetadataProvider) -> metadata_provider_config::Model {
        metadata_provider_config::Model {
            id: 0,
            provider_type: provider,
            enabled: true,
            position: 0,
            encrypted_api_token: None,
            api_token_expires_at: None,
            auto_apply_config: None,
            created_at: chrono::Utc::now().into(),
            updated_at: None,
        }
    }

    #[test]
    fn keeps_only_the_requested_provider() {
        let configs = vec![cfg(MetadataProvider::ComicVine), cfg(MetadataProvider::Metron)];
        let only = filter_to_provider(configs.clone(), Some(MetadataProvider::Metron));
        assert_eq!(only.len(), 1);
        assert_eq!(only[0].provider_type, MetadataProvider::Metron);
        assert_eq!(filter_to_provider(configs, None).len(), 2);
    }
}
```

> If the `MetadataProvider` variant names differ (verify in `crates/models/src/shared/enums.rs`), use the real ComicVine + Metron variant identifiers.

- [ ] **Step 2: Run it — expect FAIL to compile** (the module refers to nothing new, but confirms the helper is now reachable/`pub(crate)`): `cargo test -p longbox_core filter_tests` → expect PASS once `pub(crate)` compiles; if the test module can't see `filter_to_provider`, fix the visibility. (This step establishes the helper is testable before threading it.)

- [ ] **Step 3: Thread `provider_filter` through `search_series_candidates`.** In `core/src/filesystem/organizer/confirm.rs`, add the param and apply the helper right after the existing `library_type.has_provider_overlap` filter:

```rust
use models::shared::enums::MetadataProvider;
use crate::filesystem::metadata::fetch::filter_to_provider; // confirm exact path; re-export from `metadata` mod if `fetch` is private

pub async fn search_series_candidates(
    conn: &DatabaseConnection,
    library_type: &LibraryType,
    series_query: &str,
    year: Option<i32>,
    provider_filter: Option<MetadataProvider>,
    provider_cache: &ProviderClientCache,
) -> Result<Vec<MatchCandidate>, CoreError> {
    let configs = metadata_provider_config::Entity::find()
        .filter(metadata_provider_config::Column::Enabled.eq(true))
        .all(conn)
        .await?
        .into_iter()
        .filter(|c| library_type.has_provider_overlap(&c.provider_type))
        .collect::<Vec<_>>();
    let configs = filter_to_provider(configs, provider_filter);
    // ... rest unchanged (build SearchQuery, loop providers, sort by confidence) ...
}
```

> If `filter_to_provider` is not importable because `fetch` is a private module, add `pub(crate) use fetch::filter_to_provider;` to `core/src/filesystem/metadata/mod.rs` and import `crate::filesystem::metadata::filter_to_provider`.

- [ ] **Step 4: Update the caller.** In `core/src/filesystem/organizer/plan.rs` at the `search_series_candidates(` call (~line 220), pass `None` for the new `provider_filter` argument (the auto-organize path never filters):

```rust
let candidates = search_series_candidates(
    conn,
    &config.library_type,
    &group.series_query,
    group.year,
    None,
    provider_cache,
)
```

- [ ] **Step 5: Run the gates.** `cargo test -p longbox_core` (expect all green incl. `filter_tests` and the existing organizer/confirm tests), then `cargo clippy -p longbox_core -- -D warnings` (clean).

- [ ] **Step 6: Commit.**

```bash
git add core/src/filesystem/metadata/fetch.rs core/src/filesystem/metadata/mod.rs core/src/filesystem/organizer/confirm.rs core/src/filesystem/organizer/plan.rs
git commit -m "feat(organizer): optional single-provider filter on series search"
```

---

### Task 2: GraphQL — `organizeSearchSeries` query + schema regen

**Files:**

- Modify: `crates/graphql/src/query/organize.rs` (new resolver on `OrganizeQuery`)
- Modify: `crates/graphql/schema.graphql` (regenerated)

**Interfaces:**

- Consumes: `search_series_candidates(..., provider_filter, ...)` from Task 1.
- Produces GraphQL: `organizeSearchSeries(libraryId: ID!, title: String!, year: Int, provider: MetadataProvider): [MatchCandidate!]!`.

- [ ] **Step 1: Add the resolver.** In `crates/graphql/src/query/organize.rs`, add to `impl OrganizeQuery` (mirror the guards/loading of the existing `organize_preview_for_path`):

```rust
/// Free-text SERIES search for the organize flow: returns provider candidates for a
/// user-edited query so an unruly filename can be matched by hand. Live and NOT
/// persisted (writes no metadata_fetch_record). ScanLibrary-gated, library-scoped.
#[graphql(guard = "PermissionGuard::one(UserPermission::ScanLibrary)")]
async fn organize_search_series(
    &self,
    ctx: &Context<'_>,
    library_id: ID,
    title: String,
    year: Option<i32>,
    provider: Option<MetadataProvider>,
) -> Result<Vec<MatchCandidate>> {
    let AuthContext { user, .. } = ctx.data::<AuthContext>()?;
    let core = ctx.data::<CoreContext>()?;
    let conn = core.conn.as_ref();

    let library = library::Entity::find_for_user(user)
        .filter(library::Column::Id.eq(library_id.to_string()))
        .one(conn)
        .await?
        .ok_or("Library not found")?;

    let config = library_config::Entity::find()
        .filter(library_config::Column::LibraryId.eq(library.id.clone()))
        .one(conn)
        .await?
        .ok_or("Library config not found")?;

    let encryption_key = core.get_encryption_key().await?;
    let provider_cache = ProviderClientCache::new(encryption_key);

    search_series_candidates(conn, &config.library_type, &title, year, provider, &provider_cache)
        .await
        .map_err(|e| async_graphql::Error::new(e.to_string()))
}
```

Add imports: `use longbox_core::filesystem::organizer::confirm::search_series_candidates;`, `use models::shared::enums::MetadataProvider;`, and the `MatchCandidate` type — import it from the SAME path `crates/graphql/src/mutation/media_metadata.rs` uses for its `Vec<MatchCandidate>` return (grep that file for `MatchCandidate`). `library_config`, `ProviderClientCache`, `UserPermission`, `PermissionGuard`, `library`, `AuthContext`, `CoreContext` are already imported in this file.

- [ ] **Step 2: Build.** `cargo build -p graphql` → compiles.

- [ ] **Step 3: Regenerate the schema.** `cargo dump-schema` then verify: `git diff crates/graphql/schema.graphql` shows a new line `organizeSearchSeries(libraryId: ID!, title: String!, year: Int, provider: MetadataProvider): [MatchCandidate!]!` under `type OrganizeQuery` (or the root Query). Then `cargo dump-schema -- --check` → passes (no drift).

- [ ] **Step 4: Lint.** `cargo clippy -p graphql -- -D warnings` → clean.

- [ ] **Step 5: Commit.**

```bash
git add crates/graphql/src/query/organize.rs crates/graphql/schema.graphql
git commit -m "feat(organizer): organizeSearchSeries GraphQL query (non-persisting series search)"
```

---

### Task 3: Frontend — extract `MetadataSearchPanel` from `ProviderMatchDialog`

**Files:**

- Create: `packages/browser/src/components/metadata/providerMatch/MetadataSearchPanel.tsx`
- Modify: `packages/browser/src/components/metadata/providerMatch/ProviderMatchDialog.tsx` (consume the panel)
- Modify: `packages/browser/src/components/metadata/providerMatch/index.ts` (export the panel)

**Interfaces:**

- Produces:

```ts
export type SearchPanelCandidate = {
  provider: string
  externalId: string
  confidence: number
  metadata: Record<string, unknown> // rendered by kind; see ResultRow
}
export type MetadataSearchPanelProps = {
  kind: 'media' | 'series'
  seed: { title: string; number?: string; year?: number | null; publisher?: string }
  providers: { value: string; label: string }[]     // enabled providers
  onSearch: (
    query: { title: string; number?: string; year?: number | null; publisher?: string },
    provider: string | null,
  ) => Promise<SearchPanelCandidate[]>
  onSelect: (candidate: SearchPanelCandidate, index: number) => void
  selectingIndex?: number | null                     // row showing a spinner while its select resolves
}
```

- [ ] **Step 1: Create the panel.** Move from `ProviderMatchDialog.tsx` into `MetadataSearchPanel.tsx` (per the Explore map: editable inputs ~L348-355, Search button ~L388-398, `ResultsBody` ~L417, `ResultRow` ~L464, local query state ~L179-183, `handleSearch` ~L239-293):
  - The editable query inputs (`title`; plus `number` and `publisher` rendered **only** when `kind === 'media'`; `year` always). Seed initial values from `props.seed`.
  - The provider `<Select>` populated from `props.providers` (default: first entry).
  - The **Search** button → calls `props.onSearch(currentQuery, provider)`, stores the returned candidates in local state, shows a busy state while awaiting.
  - The results list = `ResultsBody`/`ResultRow` (cover, title, `year · publisher · credit` subtitle, provider `Badge`, `ConfidenceBadge`, Select button). Select → `props.onSelect(candidate, index)`.
  - Import `ConfidenceBadge` from the concrete path (Global Constraints).
  - Owns NO GraphQL — it is backend-agnostic (search + select are injected).

- [ ] **Step 2: Refactor `ProviderMatchDialog` to consume it.** Keep `ProviderMatchDialog`'s context loading (`loadContext`, the `ProviderMatch*` queries) and its provider list. Render `<MetadataSearchPanel kind={kind} seed={seededQuery} providers={providers} onSearch={runFetch} onSelect={acceptAtIndex} />` where:
  - `runFetch(query, provider)` calls the existing `fetchMediaMetadata`/`fetchSeriesMetadata` mutation (with `autoApply:false`, the edited overrides, and `provider`) and returns its `MatchCandidate[]`.
  - `acceptAtIndex(_candidate, index)` calls the existing `acceptMediaMatch`/`acceptSeriesMatch` with `candidateIndex: index`.
  - Delete the now-moved inline inputs/results from `ProviderMatchDialog`.

- [ ] **Step 3: Export.** Add `export { MetadataSearchPanel } from './MetadataSearchPanel'` and its types to `providerMatch/index.ts`.

- [ ] **Step 4: Verify (regression — the existing per-issue/series flow must not change).**
  - `yarn workspace @longbox/browser check-types` → clean.
  - `yarn workspace @longbox/browser test` → any existing `providerMatch`/`metadataMatching` suites stay green.
  - `yarn lint` → clean (react-compiler raises nothing; no `eslint-disable`).

- [ ] **Step 5: Commit.**

```bash
git add packages/browser/src/components/metadata/providerMatch/
git commit -m "refactor(metadata): extract MetadataSearchPanel from ProviderMatchDialog"
```

---

### Task 4: Frontend — `OrganizeSeriesMatchDialog` (the launched picker)

**Files:**

- Create: `packages/browser/src/scenes/library/tabs/settings/options/organizer/OrganizeSeriesMatchDialog.tsx`
- Modify: `packages/graphql/src/client/{gql,graphql}.ts` (regenerated by codegen)

**Interfaces:**

- Consumes: `MetadataSearchPanel` (Task 3), `organizeSearchSeries` query (Task 2).
- Produces: `OrganizeSeriesMatchDialog` (default export). The `OrganizeOverride` type is defined **once** in `organizeMoves.tsx` (added as Step 0 of this task) and imported here — do NOT redefine it.

```ts
// defined in organizeMoves.tsx, imported here:
// export type OrganizeOverride = { canonicalName: string; year: number | null; externalId: string; provider: string }
export type OrganizeSeriesMatchDialogProps = {
  libraryId: string
  src: string
  seed: { title: string; year: number | null }
  open: boolean
  onOpenChange: (open: boolean) => void
  onPicked: (src: string, override: OrganizeOverride) => void
}
```

- [ ] **Step 0: Define the shared override type once, in `organizeMoves.tsx`.** Add (this is the single source of truth; Task 5 consumes it, this task imports it):

```ts
export type OrganizeOverride = {
  canonicalName: string
  year: number | null
  externalId: string
  provider: string
}
```

- [ ] **Step 1: Create the dialog with the co-located query.**

```tsx
import { useSDK } from '@longbox/client'
import { Dialog } from '@longbox/components'
import { graphql, MetadataProvider } from '@longbox/graphql'
import { useLocaleContext } from '@longbox/i18n'
import { useCallback } from 'react'

import { MetadataSearchPanel, SearchPanelCandidate } from '@/components/metadata/providerMatch'

import { OrganizeOverride } from './organizeMoves'

const organizeSearchSeriesQuery = graphql(`
  query OrganizeSearchSeries($libraryId: ID!, $title: String!, $year: Int, $provider: MetadataProvider) {
    organizeSearchSeries(libraryId: $libraryId, title: $title, year: $year, provider: $provider) {
      provider
      externalId
      confidence
      metadata {
        __typename
        ... on ExternalSeriesMetadata { title year publisher authors coverUrl }
      }
    }
  }
`)

type Props = {
  libraryId: string
  src: string
  seed: { title: string; year: number | null }
  open: boolean
  onOpenChange: (open: boolean) => void
  onPicked: (src: string, override: OrganizeOverride) => void
}

export default function OrganizeSeriesMatchDialog({ libraryId, src, seed, open, onOpenChange, onPicked }: Props) {
  const { t } = useLocaleContext()
  const { sdk } = useSDK()

  const runSearch = useCallback(
    async (query: { title: string; year?: number | null }, provider: string | null) => {
      const res = await sdk.execute(organizeSearchSeriesQuery, {
        libraryId,
        title: query.title,
        year: query.year ?? null,
        provider: (provider as MetadataProvider | null) ?? null,
      })
      return (res.organizeSearchSeries ?? []) as SearchPanelCandidate[]
    },
    [sdk, libraryId],
  )

  const handleSelect = useCallback(
    (candidate: SearchPanelCandidate) => {
      const meta = candidate.metadata as { title?: string; year?: number | null }
      onPicked(src, {
        canonicalName: meta.title ?? '',
        year: meta.year ?? null,
        externalId: candidate.externalId,
        provider: candidate.provider,
      })
      onOpenChange(false)
    },
    [onPicked, src, onOpenChange],
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <Dialog.Content size="xl" className="flex max-h-[85vh] flex-col">
        <Dialog.Header>
          <Dialog.Title>{t('librarySettingsScene.options/organize.seriesMatch.title')}</Dialog.Title>
          <Dialog.Close />
        </Dialog.Header>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <MetadataSearchPanel
            kind="series"
            seed={{ title: seed.title, year: seed.year }}
            providers={/* enabled providers — reuse the same query ProviderMatchDialog uses, or a shared hook */ []}
            onSearch={runSearch}
            onSelect={handleSelect}
          />
        </div>
      </Dialog.Content>
    </Dialog>
  )
}
```

> Providers list: reuse the `metadataProviderConfigs` query (as `ProviderMatchDialog` does) to populate the provider `<Select>`; a shared `useMetadataProviders()` hook is acceptable if it avoids duplicating the query. Empty list falls back to "all enabled" server-side (a `null` provider).

- [ ] **Step 2: Run codegen** (picks up the new `OrganizeSearchSeries` document against Task 2's schema): `yarn workspace @longbox/graphql codegen`. Confirm `OrganizeSearchSeriesDocument`/type appear in `packages/graphql/src/client/graphql.ts`.

- [ ] **Step 3: Verify.** `yarn workspace @longbox/browser check-types` → clean. `yarn lint` → clean.

- [ ] **Step 4: Commit.**

```bash
git add packages/browser/src/scenes/library/tabs/settings/options/organizer/OrganizeSeriesMatchDialog.tsx packages/graphql/src/client/
git commit -m "feat(organizer): OrganizeSeriesMatchDialog series-search picker"
```

---

### Task 5: Frontend — overrides state, "Find match" button, `toDecisions` merge

**Files:**

- Modify: `packages/browser/src/scenes/library/tabs/settings/options/organizer/organizeMoves.tsx`
- Modify: `packages/browser/src/scenes/library/tabs/settings/options/organizer/__tests__/toDecisions.test.ts`
- Modify: `.../organizer/ScopedOrganizeDialog.tsx`
- Modify: `.../organizer/OrganizeLooseFilesDialog.tsx`

**Interfaces:**

- Consumes: `OrganizeOverride`, `OrganizeSeriesMatchDialog` (Task 4).
- Produces: `toDecisions(proposed, checked, overrides)` (new 3rd param); `PreviewRows`/`MoveRow` gain `overrides` + `onFindMatch`.

- [ ] **Step 1: Write the failing `toDecisions` tests.** Append to `__tests__/toDecisions.test.ts`:

```ts
import { toDecisions, OrganizeOverride } from '../organizeMoves'

const move = (src: string, canonicalName = 'Auto', externalId = 'auto-1', provider = 'comicvine') =>
  ({ src, dst: '', canonicalName, year: 2020, externalId, provider, confidence: 0.9, bucket: 'CONFIDENT', existingSeriesId: null }) as any

const override = (o: Partial<OrganizeOverride> = {}): OrganizeOverride =>
  ({ canonicalName: 'Manual', year: 1999, externalId: 'ext-9', provider: 'metron', ...o })

test('an override replaces the auto match for the same src', () => {
  const d = toDecisions([move('/a.cbz')], new Set(['/a.cbz']), new Map([['/a.cbz', override()]]))
  expect(d).toHaveLength(1)
  expect(d[0]).toMatchObject({ src: '/a.cbz', canonicalName: 'Manual', externalId: 'ext-9', provider: 'metron', year: 1999, seriesId: null })
})

test('an override for a previously-unmatched src emits a decision', () => {
  const d = toDecisions([], new Set(['/b.cbz']), new Map([['/b.cbz', override({ canonicalName: 'Found' })]]))
  expect(d).toEqual([{ src: '/b.cbz', seriesId: null, canonicalName: 'Found', year: 1999, externalId: 'ext-9', provider: 'metron' }])
})

test('an unchecked override emits nothing', () => {
  const d = toDecisions([], new Set(), new Map([['/c.cbz', override()]]))
  expect(d).toEqual([])
})
```

- [ ] **Step 2: Run — expect FAIL** (`toDecisions` takes 2 args / `OrganizeOverride` not exported): `yarn workspace @longbox/browser test --testPathPatterns=toDecisions` → FAIL.

- [ ] **Step 3: Extend `toDecisions` in `organizeMoves.tsx`.** (`OrganizeOverride` is already defined here — added in Task 4 Step 0. Do not redefine it.)

```ts
export function toDecisions(
  moves: ProposedMove[],
  checked: Set<string>,
  overrides: Map<string, OrganizeOverride> = new Map(),
): OrganizeDecisionInput[] {
  const bySrc = new Map<string, OrganizeDecisionInput>()
  for (const m of moves) {
    if (!checked.has(m.src) || overrides.has(m.src)) continue
    bySrc.set(m.src, {
      src: m.src,
      seriesId: m.existingSeriesId ?? null,
      canonicalName: m.canonicalName,
      year: m.year ?? null,
      externalId: m.externalId,
      provider: m.provider,
    })
  }
  for (const [src, o] of overrides) {
    if (!checked.has(src)) continue
    bySrc.set(src, {
      src,
      seriesId: null,
      canonicalName: o.canonicalName,
      year: o.year,
      externalId: o.externalId,
      provider: o.provider,
    })
  }
  return [...bySrc.values()]
}
```

- [ ] **Step 4: Run — expect PASS:** `yarn workspace @longbox/browser test --testPathPatterns=toDecisions` → 6 tests pass (3 original + 3 new).

- [ ] **Step 5: Add the "Find match" affordance to the renderers.** In `organizeMoves.tsx`, give `MoveRow` and the unmatched-row markup an `onFindMatch: (src: string, seed: { title: string; year: number | null }) => void` prop and a small `[Find match]` button (seed title = `move.canonicalName` for proposed rows, `unmatched.parsedSeries ?? basename(src)` for unmatched; seed year = `move.year ?? null` / `null`). Extend `PreviewRows` to accept `overrides: Map<string, OrganizeOverride>` + `onFindMatch`, and render:
  - a proposed row whose `src` has an override: show `basename(src) → {override.canonicalName}{override.year ? ` (${override.year})` : ''}` with a `Badge` "manual"; keep it checked/toggleable.
  - an unmatched row whose `src` has an override: render it in the **proposed** section (promoted) using the override.
    Keep everything else (auto rows) as-is.

- [ ] **Step 6: Wire overrides + the picker into both dialogs.** In `ScopedOrganizeDialog.tsx` and `OrganizeLooseFilesDialog.tsx`:
  - Add `const [overrides, setOverrides] = useState<Map<string, OrganizeOverride>>(new Map())` and `const [matchTarget, setMatchTarget] = useState<{ src: string; seed: { title: string; year: number | null } } | null>(null)`.
  - `onFindMatch(src, seed)` → `setMatchTarget({ src, seed })`.
  - Render `{matchTarget && <OrganizeSeriesMatchDialog libraryId={libraryId} src={matchTarget.src} seed={matchTarget.seed} open onOpenChange={(o) => !o && setMatchTarget(null)} onPicked={handlePicked} />}`.
  - `handlePicked(src, override)` → `setOverrides(prev => new Map(prev).set(src, override))` and `setChecked(prev => new Set(prev).add(src))` (overrides are checked by default).
  - Pass `overrides` + `onFindMatch` into `PreviewRows`, and change the Apply call to `toDecisions(proposed, checked, overrides)`.
  - (Scoped dialog only: `libraryId` is already a prop. Library-wide dialog: use its existing `libraryId`.)

- [ ] **Step 7: Verify.** `yarn workspace @longbox/browser check-types` → clean. `yarn workspace @longbox/browser test` → green. `yarn lint` → clean.

- [ ] **Step 8: Commit.**

```bash
git add packages/browser/src/scenes/library/tabs/settings/options/organizer/
git commit -m "feat(organizer): manual per-row series override in the organize dialogs"
```

---

### Task 6: i18n + full-suite verification

**Files:**

- Modify: `packages/i18n/src/locales/en-US.json`, `packages/i18n/src/locales/en-GB.json`

**Interfaces:** none produced.

- [ ] **Step 1: Add locale keys** under `librarySettingsScene.options/organize` in BOTH `en-US.json` and `en-GB.json` (match the existing organizer block's American "Organize" spelling for consistency, as the existing `dialog`/`scopedDialog` blocks do):

```json
"seriesMatch": {
  "title": "Find series match",
  "findButton": "Find match",
  "manualBadge": "manual",
  "searchPlaceholder": "Series title",
  "empty": "No results — refine the query and search again."
}
```

Use `seriesMatch.findButton` for the row button, `seriesMatch.title` for the picker title, `seriesMatch.manualBadge` for the override badge. Wire any string referenced in Task 5's renderers that isn't already keyed.

- [ ] **Step 2: Full CI gate reproduction** (Global Constraints list):
  - `cargo fmt --all -- --check`
  - `cargo clippy -- -D warnings`
  - `cargo dump-schema -- --check`
  - `cargo test`
  - `yarn workspace @longbox/browser check-types`
  - `yarn lint`
  - `yarn test`
    All must pass.

- [ ] **Step 3: Commit.**

```bash
git add packages/i18n/src/locales/en-US.json packages/i18n/src/locales/en-GB.json
git commit -m "i18n(organizer): strings for manual series-match picker"
```

---

## Notes for the executor

- **Metron:** never add an auto-search/validate. The only provider call is `organizeSearchSeries`, invoked strictly on the user's Search click.
- **No new apply backend:** overrides ride `applyOrganizeLooseFiles`; `apply_plan` already computes the destination folder and resolves-or-merges the series from the decision fields.
- **Two dialogs, one renderer:** all row/preview changes go through `organizeMoves.tsx`, so the scoped and library-wide dialogs get the feature together; wire the overrides state + picker into each dialog's own component (Task 5, Step 6).
