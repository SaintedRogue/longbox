# Mobile Reading Experience — Design

Date: 2026-07-17
Status: Approved (user delegated approval; implement through to `main`)

## Goal

Make Longbox's comic reader genuinely good on touch devices, with two named targets:

- **Pixel phones** (Pixel 6–9 class: ~412×915 CSS px, OLED, punch-hole camera, Android gesture navigation)
- **TCL NXTPAPER 11"** (~800×1340 CSS px portrait, matte "paper-like" LCD, Android, used for long-form eye-comfort reading)

Broad device support is in scope as the baseline; these two are the calibration points.

## Non-goals

- Rebuilding the reader architecture or the three reading modes.
- A native app. Longbox is deliberately a single installable PWA (README).
- Bottom navigation / information-architecture changes outside the reader.
- Changing the design language. Longbox has a mature 8-theme semantic token system; new work uses those tokens.

## Problems being solved

Ordered by impact on the two target devices. Each is a defect observed in code, not a speculative improvement.

### P0-1 — Offline paged reading is stuck on page 1 (correctness)

`ImageBasedReader.tsx:214` renders `<PagedReader currentPage={initialPage || 1} …/>`, passing the _initial_ page rather than the live `currentPage` state.

Online this is masked: `handleChangePage` calls `navigate(paths.bookReader(...))`, the `?page=` search param changes, `BookReaderScene` recomputes `initialPage`, and the new value flows down. The URL round-trip is acting as the state channel.

`OfflineBookReaderScene` renders `<ImageBasedReader media={media} syncPageToUrl={false} />` with **no** `initialPage` and no `navigate()`. So `initialPage` is permanently `undefined` → `PagedReader` receives `currentPage={1}` forever. Page turns update `ImageBasedReader`'s state and the context, but the paged renderer reads its frozen prop.

Downloading a comic to a phone and reading it offline in the default paged mode is the single most important mobile scenario, and it does not work.

**Fix:** pass the live `currentPage`. This is also correct online (the state and the URL hold the same value), and it removes the reader's hidden dependency on routing.

### P0-2 — No swipe-to-turn-page

`react-swipeable` is already a dependency and is used for exactly this in the EPUB reader (`EpubNavigationControls.tsx:63-70`). The image-based comic reader has none. On a phone, turning a page requires tapping a 10%-of-viewport edge strip (`PagedReader.tsx:343`, forced on for mobile at `:182-184`), competing with panzoom for the same pointer events.

Swiping is the universal comic-reader gesture. Its absence is the defining mobile complaint.

### P0-3 — Reader chrome is not touch- or notch-safe

- Touch targets: `ControlButton` → `IconButton size="sm"` → `size-8` (32px). Below Apple's 44pt and Material's 48dp. Pixel gesture navigation makes bottom-edge targets especially unforgiving.
- Safe areas: `index.html:196` sets `viewport-fit=cover`, but there is **zero** `env(safe-area-inset-*)` usage in the repo. The reader's `fixed top-0` header (`ReaderHeader.tsx:37`) and `fixed bottom-0` footer (`ReaderFooter.tsx:138`) sit under the punch-hole and the gesture bar.
- The header title (`ReaderHeader.tsx:54`) has no truncation, unlike its EPUB counterpart, so long titles squeeze the header row on narrow screens.

### P0-4 — Nothing serves the NXTPAPER use case

The NXTPAPER's whole proposition is a matte, low-fatigue, paper-like panel. Longbox's 8 themes are all colored (brand bronze `#c48259` etc.) with gradients. There is no high-contrast grayscale reading theme.

Separately, `prefers-reduced-motion` is respected **nowhere** in the repo despite heavy framer-motion use and an unconditional full-screen confetti burst (`AppLayout.tsx:274-283`). Motion on a slow-refresh matte panel smears badly.

### P1-1 — Grid density miscomputed on small screens

`useGridSize.ts:148-154` subtracts `SIDEBAR_WIDTH` (224px) from `innerWidth` when `innerWidth <= 768`, but the sidebar only renders at `md:` (≥768px, `SideBar.tsx:210`) — it subtracts the sidebar's width exactly when the sidebar is absent. `primary_navigation_mode` defaults to `SIDEBAR` server-side, so this is the out-of-the-box path.

### P1-2 — EPUB touch users can get trapped

`EpubReaderContainer.tsx:41-55` sets `controlsVisible` **only** from `onMouseEnter`/`onMouseLeave`. No touch path ever calls `setVisible(true)`; the one touch handler that touches visibility only calls `setVisible(false)` (`EpubNavigationControls.tsx:86`). After a touch user hides the controls, there is no discoverable way to bring them back.

### P1-3 — Breakpoint literal duplicated 20×

`useMediaMatch('(max-width: 768px)')` is retyped in 20 files with no shared hook; `NextInSeries.tsx:24` independently uses 640px.

## Design

### 1. Fix the paged-reader state channel

`ImageBasedReader.tsx`: pass `currentPage` (live state) to `PagedReader` instead of `initialPage || 1`.

`AnimatedPagedReader` keeps `initialPage` — its prop is genuinely named and used as an initial seed for the virtualized list.

Regression test: an offline-shaped render (`syncPageToUrl={false}`, no `initialPage`) must advance past page 1.

### 2. Swipe navigation, arbitrated by zoom

New `useSwipeNavigation` hook wrapping `react-swipeable` (already a dep — reuse, don't add).

**Arbitration rule.** Panzoom and swipe both want the pointer stream. Zoom level decides:

| Zoom state               | Horizontal drag   | Vertical drag | Pinch |
| ------------------------ | ----------------- | ------------- | ----- |
| At rest (scale ≤ 1.01)   | page turn (swipe) | native scroll | zoom  |
| Zoomed in (scale > 1.01) | pan               | pan           | zoom  |

Implementation:

- Track scale from panzoom (`getScale()`, refreshed on `panzoomzoom`/`panzoomend`).
- In `handlePointerDown`, skip `panzoom.handleDown` for touch pointers while at rest, so panzoom never starts a pan that would fight the swipe.
- Manage `touch-action` on the page-set element explicitly: `pan-y` at rest (vertical scroll stays native, horizontal is ours), `none` when zoomed (panzoom owns everything).
- `preventScrollOnSwipe: false` — vertical scrolling must never be hijacked. This is the `gesture-conflicts` rule from the UX guidance: don't override system/native scroll.

**Direction.** Reading direction (RTL) is already handled upstream by reversing `pageSets` in `ImageBasedReader.tsx:103-105`. So swipe maps to the same directional handlers the tap zones use — `onSwipedLeft → handleRightwardPageChange`, `onSwipedRight → handleLeftwardPageChange` — and RTL falls out for free. No direction logic in the hook.

**Preference.** New `swipeToNavigate: boolean` in `BookPreferences`, default `true`, alongside the existing `tapSidesToNavigate`. Follows the established store pattern and gives an escape hatch. Requires a store version bump (4 → 5).

Swipe is gesture-only, so per the `gesture-alternative` rule the visible tap zones remain as the discoverable path — this is additive, not a replacement.

### 3. Touch-safe, notch-safe reader chrome

- **Safe areas.** Add `safe-area-inset` support as reusable Tailwind v4 `@utility` declarations in `preset.css` (`pt-safe`, `pb-safe`, `pl-safe`, `pr-safe`, and combined insets), then apply to `ReaderHeader`, `ReaderFooter`, and `MobileTopBar`. Utilities live in the design system so the rest of the app can adopt them; this design only wires up the reader chrome + mobile top bar.
- **Touch targets.** `ControlButton` moves to a 44px minimum hit area. The _visual_ button stays `size-8` — expanding the hit area, not the artwork, keeps the reader's visual density while satisfying `touch-target-size`. Done by adding a `hitArea` variant to `IconButton` in the design system rather than one-off padding in the reader.
- **Title.** Add `line-clamp-1` + `min-w-0` to the header title, matching `EpubReaderHeader.tsx:49-56`.

### 4. Paper theme + reduced motion

- **`paper` theme.** A 9th theme class in `themes.css`: near-white `#fdfdfc` background, near-black `#111` foreground, neutral grayscale accents, hard high-contrast borders, no gradients. Registered in `THEME_CLASSES` (`useApplyTheme.ts`), `ThemeSelect`, and i18n. Not in `DARK_THEMES`, not in `THEMES_WITH_GRADIENTS`.
  Targets ≥7:1 (AAA) body contrast — this is a reading surface on a low-refresh matte panel, where AA is not enough.
- **Reduced motion.** Respect `prefers-reduced-motion` globally: a CSS `@media (prefers-reduced-motion: reduce)` block in `preset.css` that collapses transitions/animations, and gate the confetti burst (`AppLayout.tsx`) behind the same signal in JS, since a canvas animation can't be disabled by CSS.

### 5. Grid density fix

Remove the inverted sidebar-width subtraction in `useGridSize.ts`. The sidebar is not rendered below `md`, so no adjustment belongs there.

### 6. EPUB touch escape hatch

Give the epub reader's swipe/tap zone a visibility **toggle** rather than an unconditional `setVisible(false)`, matching the image reader's `toggleToolbar` semantics.

### 7. Shared breakpoint hook

`useIsMobile()` in `packages/browser/src/hooks`, wrapping the 768px match. Adopt it in the reader files this work already touches. **Not** a 20-file sweep — that's unrelated churn (see "Working in existing codebases": stay focused on what serves the goal).

## Testing

Jest + Testing Library, colocated in `__tests__/`, per existing convention.

- `ImageBasedReader`: offline-shaped render advances past page 1 (regression for P0-1).
- `useSwipeNavigation`: fires the correct handler per direction; no-ops when zoomed; no-ops when the preference is off.
- `useGridSize`: column count at 375/412/800/1024 px.
- `useApplyTheme`: `paper` applies and is cleanly removed; not treated as dark.
- Existing reader-control tests must stay green.

Verification beyond unit tests: build the web dist and drive the real reader in headless Chromium at Pixel and NXTPAPER viewports with touch emulation, exercising a real swipe. Unit tests cannot prove the panzoom/swipe arbitration works — that needs a real browser.

## Risks

- **Panzoom/swipe arbitration is the risky part.** Mitigated by the explicit `touch-action` management, the zoom gate, and browser-level verification rather than trusting unit tests.
- **Store version bump** (4 → 5) for `swipeToNavigate`. Additive with a default, so existing persisted state rehydrates fine.
- Rollback is a `git revert` of the merge; the user has explicitly accepted this.

## Out of scope (deliberate)

- Preload is unauthenticated (`usePreloadPage.ts:46-48`) and likely 401s under token auth — a real bug with a `// TODO: Fix on desktop` marker at `ImageBasedReader.tsx:169`, but it is an auth/caching defect, not a mobile-UX one. Noted for follow-up.
- `apps/expo` / `apps/desktop` stale `node_modules` are untracked local cruft; not this change's business.
- Reader-level font/e-ink options for EPUB.
- The 20-file breakpoint sweep.
