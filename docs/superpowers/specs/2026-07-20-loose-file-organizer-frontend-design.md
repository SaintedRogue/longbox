# Loose-File Organizer — Frontend Design (Plan 2)

**Date:** 2026-07-20
**Status:** Approved
**Depends on:** the backend (branch `feat/loose-file-organizer`) — GraphQL surface
`planOrganizeLooseFiles` / `applyOrganizeLooseFiles` mutations, `organizePreview`
query, and `autoOrganizeLooseFiles` on the library config input/output.
**Backend spec:** `docs/superpowers/specs/2026-07-19-loose-file-organizer-design.md`

## Goal

Give users a web UI to (a) toggle per-library auto-organize on scan, and (b) run
a manual "organize loose files" flow: scan → review a preview of proposed moves
(include/exclude) → apply. Built on the existing library-settings + dialog
patterns so it feels native.

## Key decisions

1. **Entry point:** a new `Settings → Organizer` sub-tab per library, mirroring the
   `scanner` / `thumbnails` settings tabs. Holds the auto-organize toggle + an
   "Organize loose files" action button. Gated on `UserPermission.ScanLibrary`.
2. **Preview UX:** review + include/exclude. The preview lists proposed moves
   (Confident pre-checked; Ambiguous shown, flagged, unchecked); the user toggles
   which to apply and hits Apply. Unmatched files are shown **read-only** ("left in
   place, couldn't confidently match") — inline tail-assignment is a deferred v2.
3. **The manual flow is a dialog** (`OrganizeLooseFilesDialog`), modeled on the
   existing `ProviderMatchDialog`.
4. **Async plan via the existing job subscription, not polling.** The codebase has
   no poll pattern; long work is surfaced via `JobStarted/JobUpdate/JobOutput`
   WebSocket events → `useJobStore` → `JobOverlay` + targeted query invalidation
   (`handleJobOutput` in `useCoreEvent.ts`). The organizer reuses this.
5. **Explicit "Scan for loose files"** action (not auto-trigger on dialog open),
   because provider-confirmed scanning is slow (provider fetches can exceed 120s).

## Non-goals (v1)

- Inline assignment of Unmatched/Ambiguous files to a series (v2).
- Editing a proposed move's target series in the UI (v2).
- A top-level route or global entry point — it lives under library settings.

## Components & flow

### Config toggle (`autoOrganizeLooseFiles`)

- Added to the `LibrarySettingsConfig` fragment (`LibrarySettingsRouter.tsx`), to
  the config zod schema + `formDefaults` (`components/library/createOrUpdate/schema.ts`),
  and threaded through the `patch({ config })` → `updateLibrary` mutation.
- Rendered as a `CheckBox` in the Organizer tab's toggle form, saving on click via
  `patch` (the established settings-toggle idiom — no submit button).

### `Settings → Organizer` tab (`scenes/library/tabs/settings/options/organizer/`)

- `OrganizerScene.tsx` — composes the toggle form + the actions section (mirrors
  `ScannerBehaviorScene.tsx` / `ThumbnailSettingsScene.tsx`).
- `OrganizerFeaturesPatchForm.tsx` — the auto-organize `CheckBox` (mirror
  `ScannerFeaturesPatchForm.tsx` / `ScannerOptInFeatures.tsx`).
- `OrganizerActionsSection.tsx` — a `Label` + description + "Organize loose files"
  `Button` that opens `OrganizeLooseFilesDialog` (mirror `ScannerActionsSection.tsx` /
  `ThumbnailManagementSection.tsx`).
- Registered: a new entry in `settings/routes.ts` (sidebar, permission-gated) and a
  lazy `<Route path="organizer">` in `LibrarySettingsRouter.tsx`.

### `OrganizeLooseFilesDialog` (`components/library/organizer/` or `scenes/library/tabs/settings/options/organizer/`)

Props: `{ libraryId: string; open: boolean; onOpenChange: (o: boolean) => void }`.

Co-located `graphql(...)` documents:

- `mutation planOrganizeLooseFiles($libraryId: ID!) { planOrganizeLooseFiles(libraryId: $libraryId) }`
- `query OrganizePreview($libraryId: ID!) { organizePreview(libraryId: $libraryId) { proposedMoves { mediaId src dst canonicalName year externalId provider confidence bucket existingSeriesId } unmatched { src parsedSeries reason } } }`
- `mutation applyOrganizeLooseFiles($libraryId: ID!, $decisions: [OrganizeDecisionInput!]!) { applyOrganizeLooseFiles(libraryId: $libraryId, decisions: $decisions) }`

State machine:

1. **Idle** — a "Scan for loose files" primary button (+ explanatory `Text`).
2. **Scanning** — on click, fire `planOrganizeLooseFiles`; show an in-dialog
   "Scanning…" state. The plan runs as a backend job; `JobOverlay` shows global
   progress. On the organize-plan job's completion, `handleJobOutput` invalidates
   the `OrganizePreview` query key; the dialog's `useGraphQL(OrganizePreview,
cacheKey('organizePreview', [libraryId]))` refetches.
3. **Preview** —
   - _Proposed moves_: a checkbox list of rows: `[✓] {basename(src)} → {canonicalName} ({year})`,
     provider `Badge`, `ConfidenceBadge` (reuse `metadataMatching/reviewDialog/ConfidenceBadge`),
     and a bucket flag (`Confident` = default checked; `Ambiguous` = `warning` badge,
     unchecked by default). Local `Set<src>` tracks checked rows.
   - _Couldn't match (left in place)_: read-only list of `unmatched` with `reason`.
   - Empty state: "No loose files found."
4. **Apply** — map checked rows → `OrganizeDecisionInput[]`
   (`{ src, seriesId: existingSeriesId ?? null, canonicalName, year, externalId, provider }`,
   `skip` omitted/false) → `applyOrganizeLooseFiles`. On success: `toast.success`,
   close the dialog. The apply job's completion invalidates `series`/`media` (via
   `handleJobOutput`) so the new series appear in the UI.
5. **Re-scan** — a secondary action re-triggers the plan from Preview.

### Job-output wiring (`hooks/useCoreEvent.ts`)

Extend `handleJobOutput` (the job-type → invalidated-query-keys map) so that when an
`organize_loose_files` job completes it invalidates the `organizePreview` query key
(for the Plan/AutoScan modes) and `series` + `media` (for the Apply/AutoScan modes,
so newly-created series and re-pointed media appear). Match the existing scan/metadata
handling shape.

### i18n

Add strings under `@longbox/i18n` for the tab label, toggle label/description, the
dialog title/description, the scan/apply/rescan buttons, bucket labels, the
"left in place" section + reasons, empty/error states.

## Testing / verification

- **Unit (jest):** the decision-mapping (checked rows → `OrganizeDecisionInput[]`),
  bucket→checkbox default, and any pure helpers. Mirror existing component tests in
  `packages/browser`.
- **Gates:** `yarn lint` (eslint + prettier + `tsc` check-types across packages) and
  `yarn test` (jest) must pass. New `graphql(...)` documents require re-running
  `yarn workspace @longbox/graphql codegen` and committing the regenerated client.
- **Live verification (recommended):** per the `longbox-live-verify-setup` memory —
  build the web dist, run the server against a `/mnt/comics`-style library seeded with
  loose files, and drive the toggle + scan→preview→apply flow with headless Playwright.
  (May be gated by provider reachability — Metron is IP-banned on the real egress; a
  cached/ComicVine path or a fixture is the fallback.)

## Risks

- **Job correlation:** `planOrganizeLooseFiles` returns `Boolean`, not a job id, so the
  dialog can't target "its" job precisely. Mitigation: invalidate `organizePreview` on
  _any_ `organize_loose_files` job completion for the library (rare, per-library — no
  practical collision). Documented, acceptable for v1.
- **Slow/failed providers** (Metron ban): scanning may mostly defer to Unmatched; the
  preview surfaces this honestly. Not a UI bug.
