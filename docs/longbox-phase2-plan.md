# Longbox Phase 2 Implementation Plan (Waves 1 & 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Wave 1 (nav quick wins, PWA correctness, ComicInfo parsing + write-back) as three parallel streams, then Wave 2 (book peek overlay, Metron provider) as two parallel streams.

**Architecture:** Each stream is an independent branch in its own git worktree (`superpowers:using-git-worktrees`), merged to `main` after per-stream review. Streams touch disjoint files (see matrix below). Rust streams follow TDD with in-file `#[cfg(test)]` tests; UI streams verify via typecheck + build + live boot.

**Tech Stack:** Rust (Axum, SeaORM, quick-xml 0.38 w/ `serialize`, governor, reqwest-middleware), React 19 + React Router 6.30 (declarative, NOT data router), vite-plugin-pwa 1.2 (generateSW), sonner toasts, GraphQL (async-graphql + graphql-codegen).

## Global Constraints

- Yarn is invoked as `npx -y yarn@1.22.21` (no global yarn on this machine); cargo is system cargo 1.97.
- Internal names stay `@stump/*` / `stump_core` / `use stump_core::` — never rename them (upstream merge-noise rule). Cargo _package_ names are `longbox_server`/`longbox_core`.
- Pre-commit hook runs prettier `--check` on staged JS/TS/MD/JSON and `cargo fmt --check` on staged `.rs`. Run `npx -y prettier@3.7.4 --config prettier.config.js --write <files>` and `cargo fmt` before committing.
- Per-stream verification gate before merge (`superpowers:verification-before-completion`): `cargo check --workspace` (Rust streams), `npx -y yarn@1.22.21 check-types`, `npx -y yarn@1.22.21 web build`, live boot test (`./target/debug/longbox_server` with `STUMP_CONFIG_DIR` pointed at a scratch dir, curl `/` → 200).
- Rust tests: `cargo test -p stump_core <module>` (in-file `#[cfg(test)]` convention; fixtures under `core/integration-tests/data/`). Metadata-integrations tests: `cargo test -p metadata_integrations`.
- GraphQL schema changes: `cargo dump-schema` regenerates `crates/graphql/schema.graphql` (CI enforces `cargo dump-schema -- --check`); TS types via `npx -y yarn@1.22.21 workspace @stump/graphql codegen`.
- Commit messages end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- i18n: only Stream B adds locale keys (to `packages/i18n/src/locales/en-US.json` + `en-GB.json`); other streams must not touch locale files (prevents parallel-merge conflicts).

## Stream file-independence matrix (Wave 1)

| Stream        | Files touched                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Overlap check                                                                                                                                                           |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A (nav)       | `packages/browser/src/scenes/series/SeriesHeader.tsx`, `scenes/book/BookOverviewSceneHeader.tsx`, `scenes/book/BookLibrarySeriesLinks.tsx`, `scenes/book/BookReaderLink.tsx`, `components/readers/imageBased/container/ReaderHeader.tsx`, `components/readers/epub/EpubReaderHeader.tsx`, `components/navigation/sidebar/SideBar.tsx`, `packages/components/src/button/ButtonOrLink.tsx`                                                                                           | none with B/C                                                                                                                                                           |
| B (PWA)       | `apps/web/src/index.tsx`, `apps/web/src/index.html`, `apps/web/vite.config.ts`, `apps/web/src/App.tsx`, NEW `apps/web/src/PWAUpdatePrompt.tsx`, `packages/browser/src/scenes/book/reader/BookReaderScene.tsx`, `packages/browser/src/components/readers/epub/EpubJsReader.tsx`, `packages/i18n/src/locales/en-US.json`, `en-GB.json`                                                                                                                                               | B touches reader _scene/logic_ files; A touches reader _header_ files — disjoint, but both live under readers: coordinate merge order (either is fine, no shared lines) |
| C (ComicInfo) | `core/src/filesystem/media/metadata.rs`, `core/src/utils/serde.rs` (read-only reference), NEW `core/src/filesystem/media/comic_info.rs`, `core/src/filesystem/media/utils.rs`, `core/src/filesystem/media/mod.rs`, `crates/models/src/entity/media_metadata.rs`, `crates/models/src/entity/library_config.rs`, NEW migration in `crates/migrations/src/`, `crates/migrations/src/lib.rs`, `crates/graphql/src/mutation/media_metadata.rs`, `crates/graphql/schema.graphql` (regen) | Rust-only; no overlap with A/B                                                                                                                                          |

Wave 2: D touches `packages/browser` routing/scene files; E touches `crates/integrations/metadata`, `core/src/filesystem/metadata/`, `crates/models`, plus 3 small UI registry files. Disjoint except both end with a `yarn codegen` regen of `packages/graphql/src/client/` — merge one, rebase the other, re-run codegen.

---

# STREAM A — Navigation quick wins

Branch: `feat/nav-quick-wins`. All TypeScript. No new i18n keys (breadcrumb labels are entity names; the one literal is `'Libraries'`, matching the hardcoded-label convention in `scenes/settings/routes.ts`).

### Task A1: Breadcrumb row on the series page

**Files:**

- Modify: `packages/browser/src/scenes/series/SeriesHeader.tsx`

**Interfaces:**

- Consumes: `Breadcrumbs` from `@stump/components` (`segments: { label: string; to?: string; noShrink?: boolean }[]`, `trailingSlash?: boolean`) — proven usage at `scenes/book/settings/BookManagementScene.tsx:97`. `useSeriesContext()` already provides `series.library.{id,name}` (fetched by `SeriesLayout.tsx` query lines 14-51).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Add the breadcrumb row**

In `SeriesHeader.tsx`, the context destructure currently reads (~line 30):

```tsx
	const {
		series: {
			id,
			resolvedName,
			path,
			stats,
			library: { id: libraryId },
		},
	} = useSeriesContext()
```

Change the `library` destructure to also take the name:

```tsx
			library: { id: libraryId, name: libraryName },
```

Add `Breadcrumbs` to the existing `@stump/components` import list, and `paths` is already imported. In the return JSX (~line 156), insert a breadcrumb row immediately before `<EntityHeader ...>`:

```tsx
			<div className="px-4 pt-2">
				<Breadcrumbs
					segments={[
						{ label: 'Libraries', to: paths.libraries(), noShrink: true },
						{ label: libraryName, to: paths.librarySeries(libraryId), noShrink: true },
						{ label: resolvedName },
					]}
				/>
			</div>
```

Note: check `paths.ts` for the exact list-page helper — if `paths.libraries()` does not exist, use the literal `'/libraries'` (that is the `LibrarySearchScene` route per `LibraryRouter.tsx:27-45`). Match surrounding padding classes to `EntityHeader`'s own container (open the file and align — the row must not look indented differently from the header).

- [ ] **Step 2: Verify**

Run: `npx -y yarn@1.22.21 check-types` → PASS.
Run: `npx -y yarn@1.22.21 web build` → PASS.
Live check: start dev (`npx -y yarn@1.22.21 web dev` + `./target/debug/longbox_server`), open a series page, confirm `Libraries / <library> / <series>` renders and both links navigate.

- [ ] **Step 3: Commit**

```bash
git add packages/browser/src/scenes/series/SeriesHeader.tsx
git commit -m "feat(nav): breadcrumb trail on series pages

Restores library context lost when SeriesRouter unmounts LibraryLayout
(see docs/longbox-investigation.md §1.4a). Data was already fetched by
SeriesLayout; no new queries.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task A2: Book overview breadcrumb + context-preserving parent links

**Files:**

- Modify: `packages/browser/src/scenes/book/BookLibrarySeriesLinks.tsx`

**Interfaces:**

- Consumes: `useLocation` from react-router; existing badge-trail component (full source in scouting notes — it renders `library badge / series badge` with plain `paths.librarySeries()`/`paths.seriesOverview()` links).
- Produces: the component now accepts an optional `from` location state contract: `{ from?: string }` set by grid cards (Task A3 sets it for readers; cards→overview state is set here-adjacent, see Step 1).

- [ ] **Step 1: Preserve the caller's full URL when it matches the parent**

The bug (investigation §1.4b): returning to the series via the badge lands on page 1, unfiltered, because the badge link is a bare path. Fix: when the browser arrived here from a URL whose pathname prefix matches the badge target, link back to that full URL (path + search) instead.

Replace the body of `BookLibrarySeriesLinks.tsx` links with:

```tsx
import { useLocation } from 'react-router-dom'
// ...existing imports unchanged

export default function BookLibrarySeriesLinks({ seriesId }: Props) {
	const location = useLocation()
	const cameFrom = (location.state as { from?: string } | null)?.from

	// ...existing query code unchanged (sdk, useSuspenseGraphQL, series, library)

	const linkFor = (bareTarget: string) => {
		if (cameFrom && cameFrom.split('?')[0] === bareTarget.split('?')[0]) {
			return cameFrom // full URL incl. ?page=&filters= the user was on
		}
		return bareTarget
	}

	return (
		<div className="gap-1.5 flex items-center">
			{library && (
				<Link to={linkFor(paths.librarySeries(library.id))} underline={false}>
					{/* existing Badge unchanged */}
```

…and the series link becomes `to={linkFor(paths.seriesOverview(series.id))}`. Keep everything else identical.

- [ ] **Step 2: Make cards send `state.from`**

Find where `BookCard` builds its link: `packages/browser/src/components/book/BookCard.tsx:112-125` computes `href` (a string). Locate the component that consumes `href` (an `EntityCard`/`Card` from `@stump/components`) and confirm whether it forwards a `state` prop to the underlying react-router `Link`. If it does not, add an optional passthrough:

```tsx
// packages/components — the Card/EntityCard link wrapper
state?: unknown  // forwarded to react-router Link
```

Then in `BookCard.tsx`, alongside `href`, pass:

```tsx
state={{ from: `${location.pathname}${location.search}` }}
```

(`const location = useLocation()` at the top of the component.) Do the same in `packages/browser/src/components/series/SeriesCard.tsx` (its link is at line ~83) so series→library back-navigation can use the same idiom later.

- [ ] **Step 3: Verify**

`check-types` + `web build` PASS. Live: library → page 2 of a series' books → open a book → click the series badge → you land back on page 2 with filters intact. Direct-load a book URL (fresh tab) → badges still link to bare parent paths (no state → fallback works).

- [ ] **Step 4: Commit**

```bash
git add -A packages/browser packages/components
git commit -m "feat(nav): context-preserving back-links from book overview

Badge links now return to the exact parent URL (page/filters intact)
when navigation state is available, falling back to bare paths on
direct loads.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task A3: Reader exit returns to where you came from

**Files:**

- Modify: `packages/browser/src/components/readers/imageBased/container/ReaderHeader.tsx`
- Modify: `packages/browser/src/components/readers/epub/EpubReaderHeader.tsx`
- Modify: `packages/browser/src/scenes/book/BookReaderLink.tsx`
- Modify (only if needed): `packages/components/src/button/ButtonOrLink.tsx` (add `state` passthrough to `Link`, same as A2 Step 2)

**Interfaces:**

- Consumes: the `state: { from }` idiom already used for auth redirects at `AppLayout.tsx:197`.
- Produces: reader entry links set `state.from`; reader headers capture it **once on mount** (immune to later in-reader `navigate` calls that replace state).

- [ ] **Step 1: Entry points pass `state.from`**

`BookReaderLink.tsx` renders `<ButtonOrLink href={readUrl} ...>`. Add:

```tsx
import { useLocation } from 'react-router-dom'
// inside component:
const location = useLocation()
// on the ButtonOrLink:
state={{ from: `${location.pathname}${location.search}` }}
```

If `ButtonOrLink` doesn't forward `state`, add the optional prop (it wraps react-router `Link`; pass `state={state}` through). Also add the same `state` at the other reader entry points that matter for "back to origin": `components/readers/imageBased/container/NextInSeries.tsx:59` and the `navigate(paths.bookReader(...))` calls in `scenes/book/BookActionMenu.tsx` (`navigate(to, { state: { from: ... } })`).

- [ ] **Step 2: Headers capture and use it**

In `ReaderHeader.tsx` (exit link currently `to={paths.bookOverview(id)}` at ~line 41):

```tsx
import { useLocation } from 'react-router-dom'
import { useState } from 'react'
// inside component:
const location = useLocation()
const [exitTo] = useState(
	() => (location.state as { from?: string } | null)?.from ?? paths.bookOverview(id),
)
// exit Link:
to={exitTo}
```

The `useState` initializer runs once on mount, so page-turn navigations inside the reader (which may replace location state) can't lose the origin. Same change in `EpubReaderHeader.tsx` (exit link at ~line 30; it imports the non-hook `paths` module — keep that, just swap the `to`).

- [ ] **Step 3: Verify**

`check-types` + `web build` PASS. Live: Home → Continue Reading → open reader → turn several pages → exit arrow → back on Home (not book overview). Enter reader from book overview → exit → book overview (unchanged behavior). Deep-link a reader URL in a fresh tab → exit → book overview (fallback).

- [ ] **Step 4: Commit**

```bash
git add -A packages/browser packages/components
git commit -m "feat(nav): reader exit returns to origin

Entry points pass location state; reader headers capture it on mount
and fall back to book overview for deep links. Uses the same
state.from idiom as the auth redirect in AppLayout.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task A4: Restore back/forward buttons on web

**Files:**

- Modify: `packages/browser/src/components/navigation/sidebar/SideBar.tsx:81-92`

- [ ] **Step 1: Drop the platform gate**

`renderHeader()` currently returns the UserMenu + NavigationButtons header only when `!isBrowser && isAtLeastMedium`. Change the condition to `isAtLeastMedium`:

```tsx
	const renderHeader = () => {
		if (isAtLeastMedium) {
			return (
				<header className="gap-1 flex w-full justify-between">
					<UserMenu />
					<NavigationButtons />
				</header>
			)
		}

		return null
	}
```

Check the file for other `isBrowser` uses before deleting the variable — if `isBrowser` becomes unused, remove its declaration (line 77), otherwise leave it.

- [ ] **Step 2: Verify**

`check-types` + `web build` PASS. Live: back/forward chevrons render at the top of the sidebar in the browser; clicking them walks history; `cmd+[`/`cmd+]` hotkeys work.

- [ ] **Step 3: Commit** — the framing below is required verbatim in spirit (this is a regression fix, not a feature):

```bash
git add packages/browser/src/components/navigation/sidebar/SideBar.tsx
git commit -m "fix(nav): restore back/forward buttons on the web platform

This is a Phase 0.5 regression fix, not new functionality: the
NavigationButtons header only ever rendered when platform !== 'browser',
i.e. exclusively on the Tauri desktop app we removed. With desktop gone
the web client was left with zero in-app back affordance. Render it for
all platforms at >=768px.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Stream A gate

- [ ] Full verification: `check-types`, `web build`, live boot test, click-through of all four behaviors.
- [ ] `superpowers:requesting-code-review` → `superpowers:finishing-a-development-branch` (merge to main).

---

# STREAM B — PWA correctness

Branch: `fix/pwa-correctness`. Mixed apps/web + reader mutation files + i18n (B owns all new locale keys this wave).

### Task B1: Reading-progress failures are no longer silent (bounded fix)

**Scope note:** this is the Wave-1 bounded fix — mutation retry + user-visible error. The full IndexedDB outbox/Background Sync build is explicitly Wave 3 (do NOT start it here).

**Files:**

- Modify: `packages/browser/src/scenes/book/reader/BookReaderScene.tsx` (mutation options at ~lines 108-115)
- Modify: `packages/browser/src/components/readers/epub/EpubJsReader.tsx` (mutation options at ~lines 220-228 — currently has NO onError at all)
- Modify: `packages/i18n/src/locales/en-US.json`, `packages/i18n/src/locales/en-GB.json`

**Interfaces:**

- Consumes: `useGraphQLMutation(document, options)` — options spread into react-query `useMutation`, so `retry`/`retryDelay` pass straight through (`packages/client/src/hooks/useGraphQL.ts:120-163`). `toast` from `'sonner'` (house convention, e.g. `SeriesHeader.tsx:59-64`). react-query global default is `retry: false` (`packages/client/src/client.ts:9`), so per-mutation retry is additive and scoped.

- [ ] **Step 1: Add locale keys**

In `en-US.json` and `en-GB.json`, next to the existing `readerScene`-adjacent keys (search for `"reader"` sections; if none fits, add a top-level block matching surrounding style):

```json
"readerToasts": {
	"progressSyncFailed": "Failed to save reading progress. Your position may not be synced."
}
```

- [ ] **Step 2: Image reader — retry + toast**

In `BookReaderScene.tsx`, replace the mutation options:

```tsx
	const { mutate } = useGraphQLMutation(mutation, {
		retry: 3,
		retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 15_000),
		onError: (err) => {
			console.error(err)
			toast.error(t('readerToasts.progressSyncFailed'))
		},
		onSuccess: () => {
			lastSyncedElapsedRef.current = pendingSyncedElapsedRef.current
		},
	})
```

Add imports: `import { toast } from 'sonner'` and the locale hook `const { t } = useLocaleContext()` (import `useLocaleContext` from `@stump/i18n` — check the file's existing imports first; `BookReaderScene` may not use i18n yet).

- [ ] **Step 3: EPUB reader — same treatment**

In `EpubJsReader.tsx` mutation options (which today only have `onSuccess`):

```tsx
	const { mutate } = useGraphQLMutation(mutation, {
		retry: 3,
		retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 15_000),
		onError: (err) => {
			console.error(err)
			toast.error(t('readerToasts.progressSyncFailed'))
		},
		onSuccess: () => {
			lastSyncedElapsedRef.current = timer.getCurrentTime()
			client.invalidateQueries({
				queryKey: ['epubJsReader', id],
			})
		},
	})
```

Same import notes as Step 2.

- [ ] **Step 4: Verify**

`check-types` + `web build` PASS. Live failure test: open a book in the reader, stop the server (`kill` the longbox_server process), turn a page → after ~7s of retries a toast appears. Restart server, turn a page → progress saves again.

- [ ] **Step 5: Commit**

```bash
git add packages/browser packages/i18n
git commit -m "fix(reader): surface reading-progress sync failures

Progress mutations previously swallowed errors (onError was
console.error only; the EPUB reader had no error handler at all) —
silent data loss. Add bounded retry with backoff and a user-visible
toast on final failure. A durable offline outbox is deferred to the
planned offline-storage work.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task B2: Fix broken/invalid icon markup and dead preconnects

**Files:**

- Modify: `apps/web/src/index.html:60-96`

- [ ] **Step 1: Replace the icon link block**

The current block (verbatim in scouting notes) has: a 404'd href (`favicon-180x180-apple-touch-icon.png` — the real file is `favicon-apple-touch-icon-180x180.png`), invalid `rel="apple-touch-icon image_src"` values, and bogus `purpose` attributes on `<link>`. Replace lines 60-87 with:

```html
<link rel="shortcut icon" type="image/x-icon" href="/assets/favicon.ico" />
<link rel="icon" type="image/png" href="/assets/favicon-16x16.png" sizes="16x16" />
<link rel="icon" type="image/png" href="/assets/favicon-192x192.png" sizes="192x192" />
<link rel="apple-touch-icon" href="/assets/favicon-apple-touch-icon-180x180.png" sizes="180x180" />
```

(Apple ignores non-180 sizes on modern devices; the 192/512 stay in the manifest where they belong.)

- [ ] **Step 2: Remove dead CDN hints**

Delete both jsdelivr lines (95-96): `<link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin />` and `<link rel="dns-prefetch" href="//cdn.jsdelivr.net" />` — zero code references CDN assets (verified by grep in the investigation).

- [ ] **Step 3: Verify + commit**

`web build` PASS; `curl -s localhost:10801/ | grep apple-touch` shows the corrected filename after a boot test.

```bash
git add apps/web/src/index.html
git commit -m "fix(pwa): correct apple-touch-icon href and rel attrs, drop dead CDN preconnects

The apple-touch-icon pointed at a filename that does not exist
(favicon-180x180-apple-touch-icon.png vs the real
favicon-apple-touch-icon-180x180.png) and used invalid rel values.
cdn.jsdelivr.net hints referenced nothing in the codebase.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task B3: Precache fonts + splash so the shell is whole offline

**Files:**

- Modify: `apps/web/vite.config.ts` (workbox block, lines 53-62)

- [ ] **Step 1: Extend the workbox globs**

The generated SW precaches only `js/css/html/png` today — the preloaded Inter font and the splash gif 404 offline. Add explicit `globPatterns` to the `workbox` object:

```ts
			workbox: {
				inlineWorkboxRuntime: true,
				globPatterns: [
					'**/*.{js,css,html,ico,png,svg}',
					'assets/stump-splash.gif',
					'assets/fonts/inter/**/*.woff2',
				],
				navigateFallbackDenylist: [
					/^\/api(?:\/|$)/,
					/^\/opds(?:\/|$)/,
					/^\/kobo(?:\/|$)/,
					/^\/koreader(?:\/|$)/,
				],
				maximumFileSizeToCacheInBytes: 6 * 1024 * 1024, // 6MB
			},
```

Deliberately only Inter (the default/preloaded family) — precaching every font family in `assets/fonts/` would add megabytes for families most users never select. Note this in the commit body.

- [ ] **Step 2: Verify**

`npx -y yarn@1.22.21 web build`, then check the SW manifest: `grep -c woff2 apps/web/dist/sw.js` ≥ 1 and `grep -c stump-splash apps/web/dist/sw.js` = 1. Confirm the PWA build summary's precache count/size printed by vite-plugin-pwa grew only modestly (fonts ≈ a few hundred KB).

- [ ] **Step 3: Commit**

```bash
git add apps/web/vite.config.ts
git commit -m "fix(pwa): precache Inter woff2 files and splash gif

The app shell referenced fonts and a splash image that were never
precached, so even shell-only offline was broken. Only the
default/preloaded Inter family is included; other font families load
network-first to keep install size sane.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task B4: Update-available toast (kill the stranded-tab hazard)

**Files:**

- Modify: `apps/web/vite.config.ts` (`registerType`)
- Modify: `apps/web/src/index.tsx` (remove manual registration)
- Create: `apps/web/src/PWAUpdatePrompt.tsx`
- Modify: `apps/web/src/App.tsx`

**Interfaces:**

- Consumes: `useRegisterSW` from `virtual:pwa-register/react` (confirmed exported by installed vite-plugin-pwa 1.2.0); `toast` from `'sonner'` — a `<Toaster />` is already mounted globally by `StumpWebClient` (`packages/browser/src/App.tsx:109`), and sonner toasts are global, so a component in apps/web can fire them.

- [ ] **Step 1: Switch to prompt-mode updates**

In `vite.config.ts`: `registerType: 'autoUpdate'` → `registerType: 'prompt'`. Keep `injectRegister: null`.

- [ ] **Step 2: Create the prompt component**

`apps/web/src/PWAUpdatePrompt.tsx`:

```tsx
import { useEffect } from 'react'
import { toast } from 'sonner'
import { useRegisterSW } from 'virtual:pwa-register/react'

export default function PWAUpdatePrompt() {
	const {
		needRefresh: [needRefresh],
		updateServiceWorker,
	} = useRegisterSW()

	useEffect(() => {
		if (!needRefresh) return

		toast('A new version of Longbox is available', {
			id: 'pwa-update',
			duration: Infinity,
			action: {
				label: 'Reload',
				onClick: () => updateServiceWorker(true),
			},
		})
	}, [needRefresh, updateServiceWorker])

	return null
}
```

- [ ] **Step 3: Wire it into the app and remove the manual registration**

In `apps/web/src/index.tsx`: delete the entire `registerServiceWorkerWhenIdle` function, its invocation, and the `import { registerSW } from 'virtual:pwa-register'` line (the hook registers the SW itself). In `apps/web/src/App.tsx`, render the prompt (PROD-only, mirroring the old guard) next to `<StumpWebClient ...>`:

```tsx
{import.meta.env.PROD && <PWAUpdatePrompt />}
```

Check `apps/web/src/vite-env.d.ts` (or equivalent) references `vite-plugin-pwa/react` types; if `check-types` complains about the virtual module, add to the env d.ts: `/// <reference types="vite-plugin-pwa/react" />`.

- [ ] **Step 4: Verify**

`check-types` + `web build` PASS. Live update simulation: build, boot server, load app; make a trivial web change, rebuild (`web build`) while the tab stays open; within ~1min (or on focus) the toast appears; clicking Reload activates the new SW and reloads.

- [ ] **Step 5: Commit**

```bash
git add apps/web
git commit -m "feat(pwa): update-available toast instead of silent autoUpdate

autoUpdate + skipWaiting could strand open tabs whose old lazy chunks
(382 of them) were purged mid-session with no reload prompt. Switch to
prompt-mode registration via useRegisterSW and surface a persistent
reload toast.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Stream B gate

- [ ] Full verification per Global Constraints, plus the live failure/update simulations above.
- [ ] `superpowers:requesting-code-review` → `superpowers:finishing-a-development-branch`.

---

# STREAM C — ComicInfo parsing + write-back

Branch: `feat/comicinfo-enrichment`. Rust-only except one small settings-form toggle (C5, no file overlap with A/B). **TDD is mandatory here** (`superpowers:test-driven-development`): every parser change starts with a failing test. Test convention: in-file `#[cfg(test)] mod tests`; run `cargo test -p stump_core filesystem::media`.

**Scope note (differs from the one-line spec):** "enable ComicInfo.xml write-back" is _not_ pure parsing — no archive-write path exists in the codebase at all (only whole-dir repack for CBR→CBZ conversion). C4/C5 build a small, opt-in, atomic rewrite subsystem: CBZ/ZIP only (RAR is read-only by nature of the unrar crate; EPUB/PDF metadata write-back is out of scope), gated by a per-library setting that defaults **off**, temp-file + atomic rename so the original archive is never corrupted on failure. Prerequisites already present: `quick-xml 0.38` with the `serialize` feature (core/Cargo.toml:67) and `tempfile` (core/Cargo.toml:76).

### Task C1: Migration + entity columns (`comicvine_id`, `translators`, `write_comicinfo`)

**Files:**

- Create: `crates/migrations/src/m20260715_000000_comicinfo_enrichment.rs`
- Modify: `crates/migrations/src/lib.rs` (register the migration — mirror how `m20260207_000000_metadata_provider_integration` is listed)
- Modify: `crates/models/src/entity/media_metadata.rs` (2 new fields)
- Modify: `crates/models/src/entity/library_config.rs` (1 new field + default in `ActiveModelBehavior`)
- Modify: `crates/graphql/src/object/media_metadata.rs` (comma-list resolver for `translators`, mirroring `writers` at line 21)
- Regenerate: `crates/graphql/schema.graphql`

**Interfaces:**

- Produces: `media_metadata.comicvine_id: Option<String>` (Text, nullable — the parsed ComicVine issue ID; consumed by C3 and by Stream E's direct-lookup matching), `media_metadata.translators: Option<String>` (comma-joined Text, consumed by C2), `library_config.write_comicinfo: bool` (default false, consumed by C5).

- [ ] **Step 1: Write the migration** (SQLite requires one ALTER per column):

```rust
use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
	async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
		manager
			.alter_table(
				Table::alter()
					.table(MediaMetadata::Table)
					.add_column(ColumnDef::new(MediaMetadata::ComicvineId).text().null())
					.to_owned(),
			)
			.await?;
		manager
			.alter_table(
				Table::alter()
					.table(MediaMetadata::Table)
					.add_column(ColumnDef::new(MediaMetadata::Translators).text().null())
					.to_owned(),
			)
			.await?;
		manager
			.alter_table(
				Table::alter()
					.table(LibraryConfig::Table)
					.add_column(
						ColumnDef::new(LibraryConfig::WriteComicinfo)
							.boolean()
							.not_null()
							.default(false),
					)
					.to_owned(),
			)
			.await
	}

	async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
		manager
			.alter_table(
				Table::alter()
					.table(MediaMetadata::Table)
					.drop_column(MediaMetadata::ComicvineId)
					.to_owned(),
			)
			.await?;
		manager
			.alter_table(
				Table::alter()
					.table(MediaMetadata::Table)
					.drop_column(MediaMetadata::Translators)
					.to_owned(),
			)
			.await?;
		manager
			.alter_table(
				Table::alter()
					.table(LibraryConfig::Table)
					.drop_column(LibraryConfig::WriteComicinfo)
					.to_owned(),
			)
			.await
	}
}

#[derive(DeriveIden)]
enum MediaMetadata {
	Table,
	ComicvineId,
	Translators,
}

#[derive(DeriveIden)]
enum LibraryConfig {
	Table,
	WriteComicinfo,
}
```

Open the existing `m20260207_000000_metadata_provider_integration.rs` first and mirror its exact imports/idioms if they differ. Register in `crates/migrations/src/lib.rs` in the same list as the others.

- [ ] **Step 2: Entity fields**

`media_metadata.rs` — add alongside the other Text columns (translators mirrors `writers`, including `#[graphql(skip)]` since comma-joined strings get list resolvers):

```rust
	/// ComicVine issue ID parsed from embedded ComicTagger metadata (Notes/Web)
	#[sea_orm(column_type = "Text", nullable)]
	pub comicvine_id: Option<String>,
	#[sea_orm(column_type = "Text", nullable)]
	#[graphql(skip)]
	pub translators: Option<String>,
```

`library_config.rs` — add `pub write_comicinfo: bool,` next to `process_metadata` (line 33) and mirror the `ActiveModelBehavior` default at lines 121-122:

```rust
		if self.write_comicinfo.is_not_set() {
			self.write_comicinfo = Set(false);
		}
```

`crates/graphql/src/object/media_metadata.rs` — add a resolver next to `writers` (line 21), same comma-split shape:

```rust
	async fn translators(&self) -> Vec<String> {
		self.model
			.translators
			.as_deref()
			.map(comma_separated_list_to_vec_str)
			.unwrap_or_default()
	}
```

(Copy the exact helper the `writers` resolver uses — open the file and match it verbatim; the snippet above shows shape, the file shows the real helper name.)

- [ ] **Step 3: Compile, migrate, regen schema**

Run: `cargo check --workspace` → PASS.
Run: `cargo dump-schema` → `crates/graphql/schema.graphql` gains `comicvineId`/`translators` on `MediaMetadataModel` and `writeComicinfo` on the library config model.
Run: `npx -y yarn@1.22.21 workspace @stump/graphql codegen` → TS types regenerate.
Boot test with a scratch config dir (fresh DB runs all migrations): server starts clean.

- [ ] **Step 4: Commit**

```bash
git add crates/migrations crates/models crates/graphql packages/graphql
git commit -m "feat(metadata): add comicvine_id/translators columns and write_comicinfo library flag

Landing spots for the ComicInfo parser work: parsed ComicVine issue IDs
(the highest-precision matching signal for provider integrations),
ComicInfo v2.1 Translator credits, and the opt-in per-library gate for
ComicInfo.xml write-back.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task C2: Parse `LanguageISO`, `GTIN`, `Translator` (TDD)

**Files:**

- Modify: `core/src/filesystem/media/metadata.rs` (struct + `into_active_model` + tests)

**Interfaces:**

- Consumes: `string_list_deserializer` (core/src/utils/serde.rs), existing serde-alias pattern.
- Produces: `ProcessedMediaMetadata.gtin: Option<String>`, `.translators: Option<Vec<String>>`; `language` now also reads `LanguageISO`. `into_active_model` maps `translators` → new column and `gtin` → `identifier_isbn` **only when no explicit ISBN was parsed**.

- [ ] **Step 1: Write the failing tests** (in `metadata.rs`'s existing `#[cfg(test)] mod tests`, lines 442+):

```rust
	#[test]
	fn test_parse_language_iso() {
		let xml = r#"<?xml version="1.0"?><ComicInfo><LanguageISO>en</LanguageISO></ComicInfo>"#;
		let meta: ProcessedMediaMetadata = quick_xml::de::from_str(xml).unwrap();
		assert_eq!(meta.language, Some("en".to_string()));
	}

	#[test]
	fn test_parse_gtin_and_translator() {
		let xml = r#"<?xml version="1.0"?><ComicInfo><GTIN>9781779501127</GTIN><Translator>Jocelyne Allen, Zack Davisson</Translator></ComicInfo>"#;
		let meta: ProcessedMediaMetadata = quick_xml::de::from_str(xml).unwrap();
		assert_eq!(meta.gtin, Some("9781779501127".to_string()));
		assert_eq!(
			meta.translators,
			Some(vec!["Jocelyne Allen".to_string(), "Zack Davisson".to_string()])
		);
	}

	#[test]
	fn test_gtin_does_not_clobber_isbn() {
		let meta = ProcessedMediaMetadata {
			identifier_isbn: Some("1234".to_string()),
			gtin: Some("5678".to_string()),
			..Default::default()
		};
		let active = meta.into_active_model();
		assert_eq!(active.identifier_isbn.unwrap(), Some("1234".to_string()));
	}
```

- [ ] **Step 2: Run to verify failure**

Run: `cargo test -p stump_core filesystem::media::metadata` → FAIL (no `gtin`/`translators` fields; `LanguageISO` unread).

- [ ] **Step 3: Implement**

In the struct: extend the language attribute and add two fields (place next to `language`, line ~102):

```rust
	/// The language of the media. ComicInfo uses LanguageISO; the bare
	/// Language alias is kept for non-standard files already in the wild.
	#[serde(alias = "Language", alias = "LanguageISO")]
	pub language: Option<String>,
	/// GTIN (ISBN/EAN/UPC) — ComicInfo v2.1
	#[serde(alias = "GTIN")]
	pub gtin: Option<String>,
	/// The translator(s) of the associated media — ComicInfo v2.1
	#[serde(
		alias = "Translator",
		deserialize_with = "string_list_deserializer",
		default = "Option::default"
	)]
	pub translators: Option<Vec<String>>,
```

In `into_active_model` (line ~236 area):

```rust
			identifier_isbn: Set(self.identifier_isbn.or(self.gtin)),
			translators: Set(self.translators.map(|v| v.join(", "))),
```

(The existing `identifier_isbn: Set(self.identifier_isbn),` line is replaced by the `.or(self.gtin)` form. GTIN is a superset of ISBN — mapping to the ISBN identifier column follows Kavita/Komga precedent; note it in the doc comment.)

- [ ] **Step 4: Run tests to verify pass**

Run: `cargo test -p stump_core filesystem::media::metadata` → PASS (including all pre-existing tests — the extra `Language` alias must not break `test_should_parse_incomplete_metadata` etc.).

- [ ] **Step 5: Commit**

```bash
cargo fmt && git add core
git commit -m "feat(metadata): read LanguageISO, GTIN, and Translator from ComicInfo.xml

LanguageISO is the actual ComicInfo element (the previous Language-only
alias silently dropped language on spec-conforming files). GTIN maps to
identifier_isbn (Kavita/Komga precedent) without clobbering an explicit
ISBN; Translator is a v2.1 credit list.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task C3: Extract ComicTagger ComicVine IDs from Notes/Web (TDD)

**Files:**

- Modify: `core/src/filesystem/media/metadata.rs` (extraction fn + `#[serde(skip)]` field + tests)
- Modify: `core/src/filesystem/media/utils.rs` (`metadata_from_buf` hydrates the field)

**Interfaces:**

- Consumes: `regex` crate (already a core dependency, used in `utils/serde.rs`).
- Produces: `ProcessedMediaMetadata.comicvine_id: Option<String>`; `pub fn extract_comicvine_id(notes: Option<&str>, links: &[String]) -> Option<String>`; `into_active_model` sets the C1 column.

- [ ] **Step 1: Write the failing tests** (real ComicTagger formats — the repo's own fixture at `utils.rs:76` uses exactly these):

```rust
	#[test]
	fn test_extract_comicvine_id_from_notes() {
		let notes = "Tagged with ComicTagger 1.3.0-alpha.0 using info from Comic Vine on 2021-12-01 20:34:52.  [Issue ID 517895]";
		assert_eq!(
			extract_comicvine_id(Some(notes), &[]),
			Some("517895".to_string())
		);
	}

	#[test]
	fn test_extract_comicvine_id_from_web_url() {
		let links = vec!["https://comicvine.gamespot.com/delete-1/4000-517895/".to_string()];
		assert_eq!(extract_comicvine_id(None, &links), Some("517895".to_string()));
	}

	#[test]
	fn test_extract_comicvine_id_notes_wins_over_web() {
		let links = vec!["https://comicvine.gamespot.com/x/4000-999999/".to_string()];
		assert_eq!(
			extract_comicvine_id(Some("blah [Issue ID 517895]"), &links),
			Some("517895".to_string())
		);
	}

	#[test]
	fn test_extract_comicvine_id_malformed() {
		assert_eq!(extract_comicvine_id(Some("[Issue ID ]"), &[]), None);
		assert_eq!(extract_comicvine_id(Some("[Issue ID abc]"), &[]), None);
		assert_eq!(
			extract_comicvine_id(None, &["https://example.com/4000-not-cv/".to_string()]),
			None
		);
		assert_eq!(extract_comicvine_id(None, &[]), None);
	}

	#[test]
	fn test_extract_comicvine_id_multiple_takes_first() {
		assert_eq!(
			extract_comicvine_id(Some("[Issue ID 111] and [Issue ID 222]"), &[]),
			Some("111".to_string())
		);
	}

	#[test]
	fn test_metadata_from_buf_hydrates_comicvine_id() {
		// reuse the existing ComicTagger fixture string from
		// utils.rs test_should_parse_incomplete_metadata
		let metadata = metadata_from_buf(FIXTURE).unwrap();
		assert_eq!(metadata.comicvine_id, Some("517895".to_string()));
	}
```

(For the last test: the fixture literal already lives in `utils.rs:76` — extract it to a `const` in the tests mod so both tests share it, or add the assertion to the existing `test_should_parse_incomplete_metadata`.)

- [ ] **Step 2: Run to verify failure**

Run: `cargo test -p stump_core filesystem::media` → FAIL (`extract_comicvine_id` not found).

- [ ] **Step 3: Implement**

In `metadata.rs` — field (with the struct's other fields):

```rust
	/// ComicVine issue ID recovered from ComicTagger's Notes convention
	/// ("[Issue ID N]") or a comicvine.gamespot.com Web URL ("/4000-N/").
	/// Not a ComicInfo element; derived post-parse.
	#[serde(skip)]
	pub comicvine_id: Option<String>,
```

Extraction fn (same file, before the tests mod):

```rust
pub fn extract_comicvine_id(notes: Option<&str>, links: &[String]) -> Option<String> {
	static NOTES_RE: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
	static WEB_RE: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();

	let notes_re = NOTES_RE
		.get_or_init(|| Regex::new(r"\[Issue ID (\d+)\]").expect("valid regex"));
	let web_re = WEB_RE.get_or_init(|| {
		Regex::new(r"comicvine\.gamespot\.com/[^\s]*?/4000-(\d+)").expect("valid regex")
	});

	if let Some(caps) = notes.and_then(|n| notes_re.captures(n)) {
		return Some(caps[1].to_string());
	}

	links
		.iter()
		.find_map(|link| web_re.captures(link).map(|caps| caps[1].to_string()))
}
```

(`use regex::Regex;` — check existing imports.) In `into_active_model`, add `comicvine_id: Set(self.comicvine_id),`. In `utils.rs` `metadata_from_buf`, hydrate after a successful parse:

```rust
	match xml_from_str::<ProcessedMediaMetadata>(adjusted) {
		Ok(mut meta) => {
			meta.comicvine_id = crate::filesystem::media::metadata::extract_comicvine_id(
				meta.notes.as_deref(),
				meta.links.as_deref().unwrap_or(&[]),
			);
			Some(meta)
		},
		Err(err) => {
```

- [ ] **Step 4: Run tests to verify pass**

Run: `cargo test -p stump_core filesystem::media` → all PASS.

- [ ] **Step 5: Commit**

```bash
cargo fmt && git add core
git commit -m "feat(metadata): parse ComicTagger ComicVine IDs from Notes/Web

The highest-precision matching signal in tagged libraries was landing
verbatim in the notes column and being discarded. Notes '[Issue ID N]'
wins over Web URL '/4000-N/'; first match on multiples; malformed
input yields None. Stored on media_metadata.comicvine_id for provider
integrations to use as a direct-lookup key.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task C4: ComicInfo.xml serializer (TDD, round-trip)

**Files:**

- Create: `core/src/filesystem/media/comic_info.rs`
- Modify: `core/src/filesystem/media/mod.rs` (declare + re-export module — mirror how `metadata`/`utils` are declared)

**Interfaces:**

- Consumes: `media_metadata::Model` (DB row, comma-joined list strings), `quick_xml::se::to_string`.
- Produces: `pub struct ComicInfoXml` with `impl From<&media_metadata::Model>` and `pub fn to_xml_string(&self) -> Result<String, FileError>` returning a document with XML declaration. Consumed by C5.

- [ ] **Step 1: Write the failing round-trip test** (in the new file's `#[cfg(test)] mod tests`):

```rust
	use crate::filesystem::media::utils::metadata_from_buf;

	fn sample_model() -> media_metadata::Model {
		media_metadata::Model {
			title: Some("Delete".to_string()),
			series: Some("Delete".to_string()),
			number: Some(Decimal::from(1)),
			volume: Some(2016),
			summary: Some("A summary".to_string()),
			notes: Some("[Issue ID 517895]".to_string()),
			year: Some(2016),
			month: Some(3),
			day: Some(31),
			writers: Some("Jimmy Palmiotti, Justin Gray".to_string()),
			pencillers: Some("John Timms".to_string()),
			publisher: Some("1First Comics".to_string()),
			links: Some("https://comicvine.gamespot.com/delete-1/4000-517895/".to_string()),
			language: Some("en".to_string()),
			translators: Some("A Translator".to_string()),
			page_count: Some(27),
			..Default::default()
		}
	}

	#[test]
	fn test_serialize_produces_parseable_comicinfo() {
		let xml = ComicInfoXml::from(&sample_model()).to_xml_string().unwrap();
		assert!(xml.starts_with("<?xml version=\"1.0\" encoding=\"utf-8\"?>"));
		assert!(xml.contains("<Series>Delete</Series>"));
		assert!(xml.contains("<Writer>Jimmy Palmiotti, Justin Gray</Writer>"));
		assert!(xml.contains("<LanguageISO>en</LanguageISO>"));
		assert!(xml.contains("<Translator>A Translator</Translator>"));
		assert!(!xml.contains("<Tags")); // None fields are omitted, not emitted empty
	}

	#[test]
	fn test_round_trip_through_parser() {
		let model = sample_model();
		let xml = ComicInfoXml::from(&model).to_xml_string().unwrap();
		let parsed = metadata_from_buf(&xml).expect("round-tripped XML must parse");
		assert_eq!(parsed.series, Some("Delete".to_string()));
		assert_eq!(parsed.number, Some(1f64));
		assert_eq!(parsed.volume, Some(2016));
		assert_eq!(parsed.language, Some("en".to_string()));
		assert_eq!(
			parsed.writers,
			Some(vec!["Jimmy Palmiotti".to_string(), "Justin Gray".to_string()])
		);
		assert_eq!(parsed.comicvine_id, Some("517895".to_string()));
	}
```

- [ ] **Step 2: Run to verify failure** — `cargo test -p stump_core comic_info` → FAIL (module doesn't exist).

- [ ] **Step 3: Implement the serializer**

`comic_info.rs` — a dedicated serialize-only struct (do NOT reuse `ProcessedMediaMetadata`: its serde attrs are deserialize-shaped, its field names would serialize as snake_case, and several ComicInfo element names are singular where our fields are plural):

```rust
use models::entity::media_metadata;
use serde::Serialize;
use serde_with::skip_serializing_none;

use crate::filesystem::error::FileError;

/// ComicInfo.xml (Anansi Project) serialization target. Field order follows
/// the published schema; None fields are omitted entirely.
#[skip_serializing_none]
#[derive(Debug, Default, Serialize)]
#[serde(rename = "ComicInfo")]
pub struct ComicInfoXml {
	#[serde(rename = "Title")]
	pub title: Option<String>,
	#[serde(rename = "Series")]
	pub series: Option<String>,
	#[serde(rename = "Number")]
	pub number: Option<String>,
	#[serde(rename = "Volume")]
	pub volume: Option<i32>,
	#[serde(rename = "Summary")]
	pub summary: Option<String>,
	#[serde(rename = "Notes")]
	pub notes: Option<String>,
	#[serde(rename = "Year")]
	pub year: Option<i32>,
	#[serde(rename = "Month")]
	pub month: Option<i32>,
	#[serde(rename = "Day")]
	pub day: Option<i32>,
	#[serde(rename = "Writer")]
	pub writer: Option<String>,
	#[serde(rename = "Penciller")]
	pub penciller: Option<String>,
	#[serde(rename = "Inker")]
	pub inker: Option<String>,
	#[serde(rename = "Colorist")]
	pub colorist: Option<String>,
	#[serde(rename = "Letterer")]
	pub letterer: Option<String>,
	#[serde(rename = "CoverArtist")]
	pub cover_artist: Option<String>,
	#[serde(rename = "Editor")]
	pub editor: Option<String>,
	#[serde(rename = "Translator")]
	pub translator: Option<String>,
	#[serde(rename = "Publisher")]
	pub publisher: Option<String>,
	#[serde(rename = "Genre")]
	pub genre: Option<String>,
	#[serde(rename = "Tags")]
	pub tags: Option<String>,
	#[serde(rename = "Web")]
	pub web: Option<String>,
	#[serde(rename = "PageCount")]
	pub page_count: Option<i32>,
	#[serde(rename = "LanguageISO")]
	pub language_iso: Option<String>,
	#[serde(rename = "Format")]
	pub format: Option<String>,
	#[serde(rename = "AgeRating")]
	pub age_rating: Option<String>,
	#[serde(rename = "Characters")]
	pub characters: Option<String>,
	#[serde(rename = "Teams")]
	pub teams: Option<String>,
	#[serde(rename = "GTIN")]
	pub gtin: Option<String>,
	#[serde(rename = "StoryArc")]
	pub story_arc: Option<String>,
	#[serde(rename = "StoryArcNumber")]
	pub story_arc_number: Option<String>,
	#[serde(rename = "SeriesGroup")]
	pub series_group: Option<String>,
	#[serde(rename = "TitleSort")]
	pub title_sort: Option<String>,
}

impl From<&media_metadata::Model> for ComicInfoXml {
	fn from(m: &media_metadata::Model) -> Self {
		Self {
			title: m.title.clone(),
			title_sort: m.title_sort.clone(),
			series: m.series.clone(),
			series_group: m.series_group.clone(),
			number: m.number.map(|n| n.normalize().to_string()),
			volume: m.volume,
			summary: m.summary.clone(),
			notes: m.notes.clone(),
			year: m.year,
			month: m.month,
			day: m.day,
			writer: m.writers.clone(),
			penciller: m.pencillers.clone(),
			inker: m.inkers.clone(),
			colorist: m.colorists.clone(),
			letterer: m.letterers.clone(),
			cover_artist: m.cover_artists.clone(),
			editor: m.editors.clone(),
			translator: m.translators.clone(),
			publisher: m.publisher.clone(),
			genre: m.genres.clone(),
			tags: None, // tags are first-class entities, not on this row
			web: m.links.clone(),
			page_count: m.page_count,
			language_iso: m.language.clone(),
			format: m.format.clone(),
			age_rating: m.age_rating.map(|r| r.to_string()),
			characters: m.characters.clone(),
			teams: m.teams.clone(),
			gtin: m.identifier_isbn.clone(),
			story_arc: m.story_arc.clone(),
			story_arc_number: m.story_arc_number.map(|n| n.normalize().to_string()),
		}
	}
}

impl ComicInfoXml {
	pub fn to_xml_string(&self) -> Result<String, FileError> {
		let body = quick_xml::se::to_string(self)
			.map_err(|e| FileError::UnknownError(e.to_string()))?;
		Ok(format!(
			"<?xml version=\"1.0\" encoding=\"utf-8\"?>\n{body}"
		))
	}
}
```

Check `FileError`'s actual variants (`core/src/filesystem/error.rs`) — use an existing string-carrying variant or add `ComicInfoWriteFailed(String)` if `UnknownError` doesn't exist. Add `mod comic_info; pub use comic_info::ComicInfoXml;` to `core/src/filesystem/media/mod.rs` following the file's existing declarations. Note: `metadata_from_buf` is `pub(crate)` — the round-trip test lives in the same crate, so it's reachable.

- [ ] **Step 4: Run tests to verify pass** — `cargo test -p stump_core comic_info` → PASS. Also full: `cargo test -p stump_core filesystem::media` → PASS.

- [ ] **Step 5: Commit**

```bash
cargo fmt && git add core
git commit -m "feat(metadata): ComicInfo.xml serializer with round-trip tests

Dedicated serialize-only struct (Anansi element names, singular credit
elements, LanguageISO) built from the media_metadata row. Emits an XML
declaration and omits absent fields. Round-trip verified through the
existing parser including ComicVine ID recovery.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task C5: Atomic CBZ rewrite + mutation hook + settings toggle

**Files:**

- Modify: `core/src/filesystem/media/comic_info.rs` (add `write_comic_info_to_zip`)
- Modify: `crates/graphql/src/mutation/media_metadata.rs` (hook after DB save)
- Modify: the library-settings scanner-features form in `packages/browser` (find it: `grep -rn "processMetadata" packages/browser/src --include='*.tsx' --include='*.ts'` — mirror that toggle for `writeComicinfo`) + the GraphQL library-config input (`grep -rn "process_metadata" crates/graphql/src/input/`)

**Interfaces:**

- Consumes: C4's `ComicInfoXml`; `library_config.write_comicinfo` (C1); `zip` crate raw-copy API; `tempfile::NamedTempFile`.
- Produces: `pub fn write_comic_info_to_zip(path: &Path, xml: &str) -> Result<(), FileError>` — atomic, preserves all other entries byte-for-byte.

- [ ] **Step 1: Write the failing test** (uses the shared fixture helpers from `core/src/filesystem/media/mod.rs` tests mod, e.g. `get_test_cbz_path()` — copy the fixture to a tempdir first so the repo fixture is never mutated):

```rust
	#[test]
	fn test_write_comic_info_to_zip_atomic_replace() {
		let tmp = tempfile::tempdir().unwrap();
		let target = tmp.path().join("test.cbz");
		std::fs::copy(crate::filesystem::media::tests::get_test_cbz_path(), &target).unwrap();

		let before = zip::ZipArchive::new(std::fs::File::open(&target).unwrap()).unwrap();
		let before_names: Vec<String> = before.file_names().map(String::from).collect();
		let before_pages = before_names.iter().filter(|n| !n.ends_with(".xml")).count();

		let xml = ComicInfoXml {
			series: Some("Written Back".to_string()),
			..Default::default()
		}
		.to_xml_string()
		.unwrap();
		write_comic_info_to_zip(&target, &xml).unwrap();

		let mut after = zip::ZipArchive::new(std::fs::File::open(&target).unwrap()).unwrap();
		let after_pages = after
			.file_names()
			.filter(|n| !n.ends_with(".xml"))
			.count();
		assert_eq!(before_pages, after_pages, "non-metadata entries preserved");

		let mut contents = String::new();
		std::io::Read::read_to_string(
			&mut after.by_name("ComicInfo.xml").unwrap(),
			&mut contents,
		)
		.unwrap();
		assert!(contents.contains("<Series>Written Back</Series>"));

		// and it still parses through the normal read path
		use crate::filesystem::media::process::{FileProcessor, ZipProcessor};
		let meta = ZipProcessor::process_metadata(target.to_str().unwrap())
			.unwrap()
			.unwrap();
		assert_eq!(meta.series, Some("Written Back".to_string()));
	}
```

(Adjust the `ZipProcessor` import path to wherever the zip processor is exported — check `core/src/filesystem/media/format/zip.rs`'s struct name and mod re-exports.)

- [ ] **Step 2: Run to verify failure** — FAIL (`write_comic_info_to_zip` not found).

- [ ] **Step 3: Implement**

```rust
use std::{
	fs::File,
	io::Write,
	path::Path,
};

/// Atomically replace (or insert) ComicInfo.xml in a zip/cbz archive.
/// All other entries are copied byte-for-byte (raw, no recompression).
/// The original file is never modified in place: content is written to a
/// temp file in the same directory and renamed over the original only on
/// success.
pub fn write_comic_info_to_zip(path: &Path, xml: &str) -> Result<(), FileError> {
	let src = File::open(path)?;
	let mut archive = zip::ZipArchive::new(src)?;

	let dir = path.parent().ok_or_else(|| {
		FileError::UnknownError(format!("No parent directory for {path:?}"))
	})?;
	let mut tmp = tempfile::NamedTempFile::new_in(dir)?;

	{
		let mut writer = zip::ZipWriter::new(tmp.as_file_mut());

		for i in 0..archive.len() {
			let entry = archive.by_index_raw(i)?;
			let is_comic_info = Path::new(entry.name())
				.file_name()
				.map(|n| n == "ComicInfo.xml")
				.unwrap_or(false);
			if is_comic_info {
				continue;
			}
			writer.raw_copy_file(entry)?;
		}

		let options: zip::write::FileOptions<'_, ()> =
			zip::write::FileOptions::default()
				.compression_method(zip::CompressionMethod::Stored);
		writer.start_file("ComicInfo.xml", options)?;
		writer.write_all(xml.as_bytes())?;
		writer.finish()?;
	}

	// keep the original file's permissions
	let perms = std::fs::metadata(path)?.permissions();
	tmp.as_file().set_permissions(perms)?;

	tmp.persist(path)
		.map_err(|e| FileError::UnknownError(e.to_string()))?;

	Ok(())
}
```

API-name check: `by_index_raw` and `raw_copy_file` exist in the zip crate ≥0.6 but signatures shift between versions — check the installed version (`grep '^name = "zip"' -A1 Cargo.lock`) and its docs.rs page; the `FileOptions` generic parameter form above matches zip ≥1.0 (see `archive.rs:20` for how this workspace's version writes options). Map error variants to whatever `FileError` derives `From<zip::result::ZipError>`/`From<std::io::Error>` — `archive.rs` and `zip.rs` show the existing conversions.

- [ ] **Step 4: Run tests to verify pass** — `cargo test -p stump_core comic_info` → PASS.

- [ ] **Step 5: Hook into `update_media_metadata`**

In `crates/graphql/src/mutation/media_metadata.rs`, after `updated_metadata` is saved (post line ~49), fire best-effort write-back. The media row is already loaded (`model.media` — it has `path` and `extension`). Look up the owning library's config through the series → library relation (the pattern `library_config::Entity::find().filter(library_config::Column::LibraryId.eq(...))` appears in `core/src/filesystem/scanner/library_scan_job.rs:164`):

```rust
		// Best-effort ComicInfo.xml write-back for opt-in libraries.
		// Failure is logged, never fails the mutation: the DB row is the
		// source of truth and the next successful edit will retry.
		let should_write_back = matches!(
			model.media.extension.to_lowercase().as_str(),
			"cbz" | "zip"
		);
		if should_write_back {
			if let Some(config) = library_config_for_media(conn, &model.media).await? {
				if config.write_comicinfo {
					let xml = stump_core::filesystem::media::ComicInfoXml::from(&updated_metadata)
						.to_xml_string();
					let path = std::path::PathBuf::from(&model.media.path);
					match xml {
						Ok(xml) => {
							let result = tokio::task::spawn_blocking(move || {
								stump_core::filesystem::media::write_comic_info_to_zip(&path, &xml)
							})
							.await;
							if let Err(e) = result.map_err(|e| e.to_string()).and_then(|r| r.map_err(|e| e.to_string())) {
								tracing::error!(error = %e, media_id = %model.media.id, "ComicInfo write-back failed");
							}
						},
						Err(e) => {
							tracing::error!(error = %e, media_id = %model.media.id, "ComicInfo serialization failed");
						},
					}
				}
			}
		}
```

Write the small `library_config_for_media` helper in the same file (media → `series_id` → `series::Entity` → `library_id` → `library_config`), following the entity relations in `crates/models`. Verify the media entity field names (`path`, `extension`, `series_id`) in `crates/models/src/entity/media.rs` before writing it.

- [ ] **Step 6: Settings toggle**

GraphQL input: find where `process_metadata` appears in the library create/update input (`crates/graphql/src/input/`) and add `write_comicinfo: Option<bool>`/`bool` with identical plumbing. Regen: `cargo dump-schema`, then `npx -y yarn@1.22.21 workspace @stump/graphql codegen`. UI: `grep -rn "processMetadata" packages/browser/src` finds the scanner-features form section + zod schema; clone that toggle as `writeComicinfo` with label text `"Write metadata edits back to ComicInfo.xml (CBZ only)"` and description `"When enabled, saving metadata edits rewrites the ComicInfo.xml inside the archive. The file on disk is modified."`.

- [ ] **Step 7: Verify end-to-end**

`cargo check --workspace`, `cargo test -p stump_core`, `check-types`, `web build` → PASS. Live: create a library pointing at a scratch dir containing a copied `.cbz` with `process_metadata` + the new toggle on → edit a book's metadata in the UI → `unzip -p <file>.cbz ComicInfo.xml` shows the edit; re-scan picks it up. Then turn the toggle off → edits no longer touch the file.

- [ ] **Step 8: Commit** (two commits: Rust hook, then the TS toggle — keeps the Rust/TS separation convention):

```bash
cargo fmt && git add core crates
git commit -m "feat(metadata): opt-in atomic ComicInfo.xml write-back for CBZ

New write path: metadata edits rewrite ComicInfo.xml inside the
archive via temp-file + atomic rename (other entries copied raw,
original never corrupted on failure). Gated per-library by
write_comicinfo (default off); CBZ/ZIP only — CBR is read-only, and
EPUB/PDF write-back is out of scope. Best-effort: failure logs and
never fails the mutation.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
# then
git add packages
git commit -m "feat(settings): write_comicinfo library toggle

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Stream C gate

- [ ] `cargo test -p stump_core` full suite, `cargo check --workspace`, schema check (`cargo dump-schema -- --check`), typecheck, web build, live boot + write-back exercise (Step 7).
- [ ] `superpowers:requesting-code-review` → `superpowers:finishing-a-development-branch`.

---

# WAVE 2 — start only after Wave 1 is merged and reported to the user

---

# STREAM D — Book detail as peek overlay

Branch: `feat/book-peek-overlay`. All TypeScript. **Use `frontend-design:frontend-design` for the visual treatment** — note: the "longbox as physical object" direction mentioned in the Phase 2 prompt has NOT been started in this repo (no design doc or tokens exist); start it in this stream and record the direction in `docs/longbox-design-notes.md` so later UI work extends rather than restarts it.

**Pattern decision:** the classic React Router background-location modal-route pattern, adapted to this codebase's constraint (descendant `<Routes>` behind splats — there is no central route manifest). `AppRouter.tsx` is the single place both route trees meet, so the wiring lives there: render the main `<Routes>` against `state.backgroundLocation ?? location`, and when `backgroundLocation` is set, render an overlay route for `books/:id` on top. Deep links to `/books/:id` (no state) still get the full-page scene — the overlay never replaces the URL contract (investigation §1.5).

**Known trap (from code reading):** `packages/components` `Sheet.tsx` auto-fires `onClose` on every location change _including mount_ (`useEffect(() => onClose?.(), [location])`). A peek that opens _by navigating_ would instantly self-close. Use `SheetPrimitive` directly with local open-state instead of the `Sheet` wrapper.

### Task D1: Extract shared `BookOverviewContent`

**Files:**

- Create: `packages/browser/src/scenes/book/BookOverviewContent.tsx`
- Modify: `packages/browser/src/scenes/book/BookOverviewScene.tsx`

**Interfaces:**

- Produces: `BookOverviewContent({ id, variant }: { id: string; variant: 'page' | 'sheet' })` — everything `BookOverviewScene` renders today (thumbnail, `BookReaderLink`, `BookActionMenu`, `BookOverviewSceneHeader`, `BooksAfterCursor`, `MediaMetadataEditor`, `BookFileInformation`) minus the `SceneContainer`/`Helmet`/scroll-to-top wrapper, parameterized so the sheet variant can drop `BooksAfterCursor` and tighten the layout.

- [ ] **Step 1:** Move the body of `BookOverviewScene` (its full source is in the scouting notes — data via `useBookOverview(id)` + `useFragment(BookCardFragment, media)`) into `BookOverviewContent`, taking `id` as a prop instead of `useParams()`. `BookOverviewScene` becomes: `useParams()` → `SceneContainer` + `Helmet` + scroll-to-top effect + `<BookOverviewContent id={id} variant="page" />`. In the `sheet` variant, skip `BooksAfterCursor` and `BookFileInformation` (keep the permission-gated file info page-only).
- [ ] **Step 2:** `check-types` + `web build` PASS; live: `/books/:id` full page renders identically to before.
- [ ] **Step 3:** Commit: `refactor(book): extract BookOverviewContent for reuse in peek overlay`.

### Task D2: Background-location wiring + `BookPeekSheet`

**Files:**

- Modify: `packages/browser/src/AppRouter.tsx`
- Create: `packages/browser/src/scenes/book/BookPeekSheet.tsx`

**Interfaces:**

- Consumes: D1's `BookOverviewContent`; `SheetPrimitive` from `@stump/components` (`packages/components/src/sheet/primitives.tsx` — open it for the exact subcomponent API: `SheetPrimitive`, `.Content` with `position`/`size` props, `.Header`, `.Title`).
- Produces: navigation contract `state: { backgroundLocation: Location }` — any link that sets it opens the peek instead of the full page.

- [ ] **Step 1: AppRouter renders two trees**

In `AppRouter.tsx` (full current source in scouting notes), inside the component:

```tsx
import { Location, Route, Routes, useLocation } from 'react-router-dom'
// ...
const location = useLocation()
const backgroundLocation = (location.state as { backgroundLocation?: Location } | null)
	?.backgroundLocation
```

Pass `location={backgroundLocation ?? location}` to the existing `<Routes>`. After it (inside the same `RouterProvider`), add:

```tsx
{backgroundLocation && (
	<Routes>
		<Route path="/books/:id" element={<BookPeekSheet />} />
	</Routes>
)}
```

(`BookPeekSheet` lazy-imported like the sibling scenes.)

- [ ] **Step 2: The sheet**

`BookPeekSheet.tsx`:

```tsx
import { SheetPrimitive } from '@stump/components'
import { Suspense, useState } from 'react'
import { useNavigate, useParams } from 'react-router'

import BookOverviewContent from './BookOverviewContent'

export default function BookPeekSheet() {
	const { id } = useParams()
	const navigate = useNavigate()
	const [open, setOpen] = useState(true)

	const handleOpenChange = (isOpen: boolean) => {
		setOpen(isOpen)
		if (!isOpen) {
			navigate(-1)
		}
	}

	if (!id) return null

	return (
		<SheetPrimitive open={open} onOpenChange={handleOpenChange}>
			<SheetPrimitive.Content position="right" size="xl">
				<Suspense fallback={null}>
					<BookOverviewContent id={id} variant="sheet" />
				</Suspense>
			</SheetPrimitive.Content>
		</SheetPrimitive>
	)
}
```

Check `primitives.tsx` for the real `position`/`size` prop values and whether `Content` requires a `Header`/`Title` for a11y (Radix warns without a title — if so, render a visually-hidden title with the book name from the content component, or pass a `title` element). The reader entry inside the sheet (`BookReaderLink`) navigates to the reader route — that replaces the background location naturally; verify exit behavior still lands sensibly (Stream A's `state.from` capture handles it).

- [ ] **Step 3:** Live-verify both entry modes: card click → sheet over still-mounted grid (scroll position intact — this is the whole point); browser refresh on `/books/:id` → full page. Escape/overlay-click closes and returns to the grid.
- [ ] **Step 4:** Commit: `feat(nav): book detail opens as peek overlay over browse context`.

### Task D3: Cards opt into the peek

**Files:**

- Modify: `packages/browser/src/components/book/BookCard.tsx` (href built at lines 112-125; Stream A already added `state` passthrough + `useLocation` here)

- [ ] **Step 1:** Where A2 set `state={{ from: ... }}`, extend to `state={{ from: ..., backgroundLocation: location }}` — but ONLY for the overview link (the `paths.bookReader(...)` branch for `readingLink`/`skipBookOverview` must NOT set `backgroundLocation`; readers are full-page by design). Keep table-view (`components/book/table/columns.tsx:59`) as full-page links for now — flag as follow-up.
- [ ] **Step 2:** Live-verify from library books grid, series books grid, book search, and Home rails. `check-types` + `web build`.
- [ ] **Step 3:** Commit: `feat(nav): book cards open the peek overlay, preserving browse context`.

### Task D4: Visual polish via frontend-design

- [ ] Invoke `frontend-design:frontend-design` scoped to the sheet's internal layout (hero cover treatment, action row, metadata presentation). Establish the "longbox as physical object" direction here (bagged-and-boarded framing, spine/edge motifs — whatever the skill produces) and write the decisions to `docs/longbox-design-notes.md`. Constraint: theme-token-compatible with the existing themes (dark/light/ocean/etc. from index.html's theme classes); no new hard-coded colors.
- [ ] Commit separately: `style(book): peek overlay visual treatment`.

### Stream D gate

- [ ] `check-types`, `web build`, live click-through (grids, search, home rails, deep link, refresh-in-peek, escape/close, reader entry+exit from peek).
- [ ] `superpowers:requesting-code-review` → `superpowers:finishing-a-development-branch`.

---

# STREAM E — Metron metadata provider

Branch: `feat/metron-provider`. Rust + 3 small UI registry files + schema regen. **`security-auditor` pass required before merge** (Task E6). API facts verified against Metron's server-side filters and the official mokkari client (July 2026): base `https://metron.cloud/api/{resource}/`, HTTP **Basic auth**, limits **20 req/min + 5,000/day** with `Retry-After` on 429; issue list filters include `series_name` (icontains), `number` (iexact), `series_volume`, `series_year_began`, `cv_id`, `gcd_id`, `cover_year`; series list filters include `name`, `year_began`, `volume`, `cv_id`, `gcd_id`. Issue detail: `number`, `collection_title` (alias `title`), `story_titles` (alias `name`), `cover_date`, `store_date`, `image`, `desc`, `publisher`/`imprint`/`rating` (GenericItem `{id,name}`), `series` sub-object, `credits[{id, creator, role[]}]`, `arcs`/`characters`/`teams` (BaseResource `{id,name}`), `variants`, `isbn`/`upc`/`sku`, `cv_id`, `gcd_id`, `resource_url`. Data license: CC BY-SA 4.0 — add attribution in the provider UI card.

### Task E1: Registry plumbing (enum variant end-to-end)

**Files:**

- Modify: `crates/models/src/shared/enums.rs` (~line 468)
- Modify: `crates/integrations/metadata/src/lib.rs` (factory)
- Modify: `crates/integrations/metadata/src/providers/mod.rs`
- Create: `crates/integrations/metadata/src/providers/metron.rs` (stub for now — full client in E4)
- Modify: `packages/browser/src/scenes/settings/server/metadataIntegrations/providers/constants.ts`
- Modify: `.../metadataIntegrations/providers/ProviderLogo.tsx`
- Create: `packages/browser/public/assets/logos/metron.png` (simple self-made wordmark placeholder — do NOT copy Metron's logo asset without checking its mark usage; a plain text-on-transparent PNG is fine)
- Regenerate: `crates/graphql/schema.graphql` + TS codegen

**Interfaces:**

- Produces: `MetadataProvider::Metron` (serializes `"METRON"`), `supported_library_types() = &[LibraryType::Comic]`, factory arm `"METRON" => MetronClient::new(token, None)`, `PROVIDER_LABELS`/`LOGOS` entries. This is the change that makes `LibraryType::Comic` match a provider for the first time — the post-scan hook (`library_scan_job.rs:358-380`) starts firing for comic libraries once a Metron config is enabled.

- [ ] **Step 1:** Add the variant + arm:

```rust
pub enum MetadataProvider {
	/// Hardcover (https://hardcover.app)
	Hardcover,
	/// Metron (https://metron.cloud) — comics; data CC BY-SA 4.0
	Metron,
}
// supported_library_types:
			Self::Metron => &[LibraryType::Comic],
```

Stub `MetronClient` in `providers/metron.rs` (struct + `new(token: String, rate_limit: Option<u32>)` + `MetadataProvider` impl returning `Err(MetadataProviderError::Other("not implemented".into()))` from the four async methods, `id() = "metron"`, `name() = "Metron"`, `supported_media_types()` mirroring what hardcover returns for its types — open `types/mod.rs` for the `MediaType` variants). Export from `providers/mod.rs`; factory arm in `lib.rs`.

- [ ] **Step 2:** `cargo check --workspace` → PASS (the exhaustive `match self` in `supported_library_types` and the TS `Record<MetadataProvider, ...>` maps are compile-time forcing functions — TS will fail until constants.ts + ProviderLogo.tsx gain `Metron` entries). `cargo dump-schema`, `npx -y yarn@1.22.21 workspace @stump/graphql codegen`, add the two TS entries, `check-types` → PASS.
- [ ] **Step 3:** Commit: `feat(metadata): register Metron provider (comics) end-to-end`.

### Task E2: Widen `SearchQuery` for issue matching

**Files:**

- Modify: `crates/integrations/metadata/src/types/query.rs`
- Modify: `core/src/filesystem/metadata/fetch_job.rs` (~lines 464-473 and 642-651) and `core/src/filesystem/metadata/fetch.rs` (media search path ~191+)

**Interfaces:**

- Produces:

```rust
pub struct SearchQuery {
	pub title: String,
	pub author: Option<String>,
	pub isbn: Option<String>,
	pub year: Option<i32>,
	pub limit: Option<u32>,
	// comic-issue matching signals
	pub series_name: Option<String>,
	pub number: Option<String>,
	pub publisher: Option<String>,
	pub series_year: Option<i32>,
	/// Known ComicVine issue ID (from media_metadata.comicvine_id, Stream C) —
	/// providers that can resolve it directly should skip fuzzy search.
	pub comicvine_id: Option<String>,
}
```

(`Default` extends with `None`s. Hardcover ignores the new fields — no change needed there.)

- [ ] **Step 1:** Add fields; `cargo check` (the `..Default::default()` construction sites in fetch.rs/fetch_job.rs keep compiling).
- [ ] **Step 2:** Populate at the media search sites. The fetch job currently sends only `title`. Both media-path sites load the media row; extend the query the same way in both (`fetch_job.rs:642` shape):

```rust
							let query = SearchQuery {
								title: media_name.clone(),
								series_name: metadata.as_ref().and_then(|m| m.series.clone()),
								number: metadata
									.as_ref()
									.and_then(|m| m.number)
									.map(|n| n.normalize().to_string()),
								publisher: metadata.as_ref().and_then(|m| m.publisher.clone()),
								year: metadata.as_ref().and_then(|m| m.year),
								comicvine_id: metadata
									.as_ref()
									.and_then(|m| m.comicvine_id.clone()),
								limit: Some(10),
								..Default::default()
							};
```

Check what metadata is actually in scope at each site — if only the media row is loaded, join/fetch its `media_metadata` (the job already touches it for naming; follow the file's existing query style). The series path (`fetch_job.rs:464`) gains `series_year` from `series_metadata.year` if loaded.

- [ ] **Step 3:** `cargo check --workspace` + existing tests pass (`cargo test -p metadata_integrations`, `cargo test -p stump_core metadata`). Commit: `feat(metadata): comic-issue fields on SearchQuery, populated from parsed metadata`.

### Task E3: Comic fields on `ExternalMediaMetadata` + apply mapping

**Files:**

- Modify: `crates/integrations/metadata/src/types/metadata.rs`
- Modify: `core/src/filesystem/metadata/apply.rs` (`apply_media_fields` ~line 305, `build_media_metadata_insert` ~line 456)
- Check/modify: `crates/integrations/metadata/src/types/enums.rs` (`MetadataField` — add variants only if missing: `Pencillers`, `Inkers`, `Editors`, `Characters`, `Teams`, `StoryArc`, `Publisher`; open the file first, several likely exist)

**Interfaces:**

- Produces, on `ExternalMediaMetadata` (keeping the existing generic `artists` for Hardcover):

```rust
	pub pencillers: Option<Vec<String>>,
	pub inkers: Option<Vec<String>>,
	pub editors: Option<Vec<String>>,
	pub characters: Option<Vec<String>>,
	pub teams: Option<Vec<String>>,
	pub story_arc: Option<String>,
	pub imprint: Option<String>,
	pub publisher: Option<String>,
```

- [ ] **Step 1:** Add fields (struct derives `Default, SimpleObject` — additive and schema-safe; regen schema at the end).
- [ ] **Step 2:** Map them in `apply_media_fields` following the existing `merge_comma_list`/`merge_scalar` idioms verbatim (e.g. `merger.merge_comma_list(MetadataField::Characters, &model.characters, &ext.characters)` → `active.characters`; `merge_scalar(MetadataField::Publisher, &model.publisher, &ext.publisher)`; keep the existing `ext.artists → pencillers` mapping but let an explicit `ext.pencillers` win when present). Mirror in `build_media_metadata_insert`. Add the corresponding `apply_*_override` lines in the override block, matching the file's pattern.
- [ ] **Step 3:** `cargo test -p metadata_integrations` + `cargo check --workspace` → PASS. `cargo dump-schema` + TS codegen. Commit: `feat(metadata): comic credit/entity fields on external metadata + merge mapping`.

### Task E4: The Metron client (TDD on mapping; live tests `#[ignore]`d)

**Files:**

- Modify: `crates/integrations/metadata/src/rate_limit.rs` (add per-minute constructor)
- Modify: `crates/integrations/metadata/src/providers/metron.rs` (replace E1 stub)

**Interfaces:**

- Consumes: `build_client_with_retry` (already retries 429/5xx with exponential backoff — `client.rs:10-33`), widened `SearchQuery` (E2), comic fields (E3).
- Produces: a working `MetronClient` implementing the trait.

- [ ] **Step 1: Rate limiter — failing test first**

```rust
	#[test]
	fn test_rate_limiter_per_minute() {
		let limiter = RateLimiter::per_minute(20);
		assert!(limiter.try_acquire());
	}
```

Implement with governor's `Quota::per_minute(NonZeroU32)` — a `pub fn per_minute(requests: u32) -> Self` sibling of `new()`. (The 5,000/day sustained limit is left to the server's 429 + retry middleware; note this in a comment.)

- [ ] **Step 2: Client skeleton + auth**

Metron uses Basic auth (username + password), but the config store has a single `encrypted_api_token` (`metadata_provider_config.rs:19`) and the UI a single `apiToken` field. **Decision: encode credentials as `username:password` in that one token field** — no migration, no config-table change. Parse defensively:

```rust
const METRON_API_URL: &str = "https://metron.cloud/api";
const METRON_RATE_LIMIT_PER_MINUTE: u32 = 20;

pub struct MetronClient {
	client: ClientWithMiddleware,
	username: String,
	password: String,
	rate_limiter: RateLimiter,
}

impl MetronClient {
	pub fn new(token: String, rate_limit: Option<u32>) -> Result<Self, MetadataProviderError> {
		let (username, password) = token
			.split_once(':')
			.ok_or_else(|| {
				MetadataProviderError::Other(
					"Metron credentials must be 'username:password'".to_string(),
				)
			})?;
		Ok(Self {
			client: build_client_with_retry(reqwest::Client::new(), RetryClientConfig::default()),
			username: username.to_string(),
			password: password.to_string(),
			rate_limiter: RateLimiter::per_minute(
				rate_limit.unwrap_or(METRON_RATE_LIMIT_PER_MINUTE),
			),
		})
	}

	async fn get_json<T: serde::de::DeserializeOwned>(
		&self,
		path: &str,
		params: &[(&str, String)],
	) -> Result<T, MetadataProviderError> {
		self.rate_limiter.until_ready().await;
		let response = self
			.client
			.get(format!("{METRON_API_URL}/{path}/"))
			.basic_auth(&self.username, Some(&self.password))
			.query(params)
			.send()
			.await?
			.error_for_status()?;
		Ok(response.json::<T>().await?)
	}
}
```

Note the factory signature: `create_provider` returns `MetadataResult<Box<dyn ...>>`, so `MetronClient::new` returning `Result` fits — the E1 stub's arm becomes `"METRON" => Ok(Box::new(MetronClient::new(api_token, None)?)),`. **Never log the token/password**; `#[tracing::instrument(skip(self))]` on methods, and no `dbg!` (the Hardcover file has a stray `dbg!(&graphql_query)` at line ~112 — do not copy that pattern; E6 flags it).

- [ ] **Step 3: Response types + mapping — failing tests with JSON fixtures**

Deserialization structs (paginated lists are DRF-style `{count, next, previous, results}`):

```rust
#[derive(Debug, Deserialize)]
struct Paginated<T> {
	count: u32,
	results: Vec<T>,
}

#[derive(Debug, Deserialize)]
struct GenericItem {
	id: i64,
	name: String,
}

#[derive(Debug, Deserialize)]
struct IssueListItem {
	id: i64,
	issue: String, // display name, e.g. "Delete (2016) #1"
	number: String,
	cover_date: Option<String>,
	image: Option<String>,
	series: IssueListSeries,
	cv_id: Option<i64>,
	gcd_id: Option<i64>,
}

#[derive(Debug, Deserialize)]
struct IssueListSeries {
	name: String,
	volume: Option<i32>,
	year_began: Option<i32>,
}

#[derive(Debug, Deserialize)]
struct IssueDetail {
	id: i64,
	number: String,
	collection_title: Option<String>,
	story_titles: Option<Vec<String>>,
	cover_date: Option<String>,
	desc: Option<String>,
	image: Option<String>,
	publisher: Option<GenericItem>,
	imprint: Option<GenericItem>,
	series: IssueDetailSeries,
	credits: Option<Vec<Credit>>,
	arcs: Option<Vec<GenericItem>>,
	characters: Option<Vec<GenericItem>>,
	teams: Option<Vec<GenericItem>>,
	isbn: Option<String>,
	upc: Option<String>,
	page: Option<i32>,
	cv_id: Option<i64>,
	resource_url: Option<String>,
}

#[derive(Debug, Deserialize)]
struct IssueDetailSeries {
	id: i64,
	name: String,
	year_began: Option<i32>,
}

#[derive(Debug, Deserialize)]
struct Credit {
	creator: String,
	role: Vec<GenericItem>,
}
```

Write the failing unit tests first with an inline JSON fixture (construct a realistic `IssueDetail` JSON by hand from the field list above) covering `map_issue_detail`:

```rust
	#[test]
	fn test_map_issue_detail_credits_by_role() {
		let detail: IssueDetail = serde_json::from_str(ISSUE_DETAIL_FIXTURE).unwrap();
		let meta = map_issue_detail(detail);
		assert_eq!(meta.writers, Some(vec!["Jimmy Palmiotti".to_string()]));
		assert_eq!(meta.pencillers, Some(vec!["John Timms".to_string()]));
		assert_eq!(meta.characters, Some(vec!["Harley Quinn".to_string()]));
		assert_eq!(meta.year, Some(2016));
		assert_eq!(meta.month, Some(3));
	}
```

Then implement `fn map_issue_detail(detail: IssueDetail) -> ExternalMediaMetadata`: credits bucketed by case-insensitive role name (`writer` → writers, `penciller`/`penciler` → pencillers, `inker` → inkers, `colorist` → colorists, `letterer` → letterers, `cover` → cover_artists, `editor` → editors; anything else → artists), `cover_date` split into y/m/d (`"2016-03-01"` → `NaiveDate` parse), `desc` → summary, `story_titles.first()` else `collection_title` → title, arcs → `story_arc` (first, comma-joining the rest is acceptable too — pick one and test it), `image` → cover_url, `resource_url` → provider_url, `number` parsed to the f32 `number` when numeric.

- [ ] **Step 4: Trait implementation**

`search_media`: if `query.comicvine_id` is set → `GET issue/?cv_id=<id>`; a unique hit becomes a candidate with `confidence: 1.0` and a `ConfidenceFactor { factor: "comicvine_id_exact", weight: 1.0, matched: true }`, then fetch detail for it and return early (skip fuzzy scoring). Otherwise → `GET issue/?series_name=<series_name or title>&number=<number>` (+ `series_year_began` when `series_year` present), fetch detail per hit (cap at `limit`), and pass through `self.score_search(query, candidates)` like Hardcover does. `search_series`: `GET series/?name=<title>` (+ `year_began`). `fetch_media_metadata`: `GET issue/{id}/` → `map_issue_detail`. `fetch_series_metadata`: `GET series/{id}/` → map (name→title, `desc`→summary, `year_began`/`year_end`, publisher/imprint names, `issue_count`→volume_count, genres). Add `#[ignore = "Requires METRON_CREDENTIALS env var"]` live tests mirroring the Hardcover pattern (`get_test_client()` reading `METRON_CREDENTIALS` as `user:pass`).

- [ ] **Step 5:** `cargo test -p metadata_integrations` (unit tests green; ignored live tests compile). `cargo check --workspace`. Commit: `feat(metadata): Metron provider — Basic auth, 20/min limiter, cv_id direct lookup, role-bucketed credits`.

### Task E5: End-to-end verification against live Metron

- [ ] With real credentials in the env (`METRON_CREDENTIALS=user:pass cargo test -p metadata_integrations metron -- --ignored --nocapture`): search + fetch round-trip works, rate limiter keeps under 20/min.
- [ ] Live app test: enable Metron in Settings → Metadata Integrations (token field: `user:pass`), point a comic library at scratch CBZs from Stream C's test (which have `comicvine_id` parsed), trigger fetch → pending matches appear with the cv_id direct hit at confidence 1.0; accept → fields land per E3 mapping.
- [ ] Update the provider card UI copy: token-field helper text "Metron username and password, entered as username:password" + a CC BY-SA attribution line ("Metadata provided by metron.cloud, CC BY-SA 4.0") on the provider card. Commit UI copy separately (TS commit).

### Task E6: security-auditor pass (required before merge)

- [ ] Run the `security-auditor` agent over the stream's diff with this charter: credentials never logged (check `tracing::instrument` skips, no `dbg!`), Basic auth only over the hardcoded https base URL, encrypted-at-rest via the existing `encrypt_string`/`decrypt_string` path (no new plaintext persistence), rate limits respected locally (20/min) with server 429s honored by the retry middleware rather than hammered, fails closed on auth errors (401/403 → `Fatal`, not retried — verify `RetryOn429And5xx` treats 4xx as Fatal, it does per client.rs:24-27), and the `username:password`-in-one-field encoding is called out as an accepted tradeoff in the provider docs. Also flag the pre-existing `dbg!(&graphql_query)` in hardcover.rs for removal as a drive-by (separate tiny commit).
- [ ] Address findings, then stream gate: `cargo test -p metadata_integrations`, `cargo check --workspace`, `cargo dump-schema -- --check`, `check-types`, `web build`, live boot.
- [ ] `superpowers:requesting-code-review` → `superpowers:finishing-a-development-branch`.

---

# Self-review checklist (run after writing, before dispatch)

- [x] Spec coverage: both "fix now" items (progress-sync = B1 with regression-framing in commit; back/forward = A4 with required regression framing), all Wave 1 streams (A=A1-A4, B=B1-B4, C=C1-C5), Wave 2 (D=D1-D4, E=E1-E6), TDD for Stream C parser + write-back and E4 mapping, frontend-design in D4, security-auditor in E6, per-stream verification gates, Wave-1-merge checkpoint before Wave 2.
- [x] Deliberately out of scope (Wave 3, do not build): router consolidation/data router/ScrollRestoration (needs ADR first), IndexedDB outbox + offline download storage, iOS splash/maskable icon asset generation.
- [x] Known judgment calls encoded: GTIN→identifier_isbn (Kavita precedent, non-clobbering); Metron creds as `user:pass` in the single token field (no migration; security-auditor reviews); write-back is best-effort + opt-in + CBZ-only; only Inter fonts precached; B1 is retry+toast, not an outbox.
- [x] Type consistency: `comicvine_id: Option<String>` everywhere (C1 column, C3 struct field, E2 SearchQuery); `SearchQuery.number: Option<String>` (Metron numbers are strings like "1.MU"); `state.from` is a `string` (pathname+search), `state.backgroundLocation` is a `Location` object — the two coexist in one state object (D3).

# Execution

Per the Phase 2 prompt: Wave 1 = three parallel worktrees (`superpowers:using-git-worktrees` + `superpowers:dispatching-parallel-agents`), one stream each. Report to the user after Wave 1 merges, before starting Wave 2. Wave 2 = two parallel worktrees, same discipline.
