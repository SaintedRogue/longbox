# ADR-0001: Scroll restoration via a custom hook, not a data-router migration

## Status

Accepted (2026-07-16) — Wave 3a. (Supersedes the Phase 2 plan's framing of Wave 3 router work as "consolidate to a single data router.")

## Context

The Phase 1 investigation (`docs/longbox-investigation.md` §1) flagged two related web-UI pains:

1. **Scroll position is never restored** — navigating back to a list you drilled out of lands you at the top.
2. **Getting lost on drill-down** — the six sibling routers unmount parent context on navigation.

The Phase 2 plan deferred the fix to Wave 3 and framed it as "migrate to a single React Router **data router** (`createBrowserRouter`) so we get real `<ScrollRestoration>` and a single route manifest," with an explicit instruction to write this ADR first "given the size and risk."

Since then, Waves 1–2 changed the picture, and a precise re-read of the current router (React Router DOM **6.30.3**, `<BrowserRouter>` + declarative `<Routes>`) surfaced facts that undercut the migration's premise:

**Fact 1 — the app does not scroll the window.** Scrolling happens inside an OverlayScrollbars-injected viewport element tagged `data-artificial-scroll="true"` (set up on `<main id="main">` in `AppLayout.tsx:62-104`); when the user disables pretty scrollbars, `#main` itself (`overflow-y-auto`) is the scroller. React Router's built-in `<ScrollRestoration>` only saves/restores **`window`** scroll. It would therefore do nothing here. The one existing scroll-to-top in the app already reaches the real scroller manually: `BookOverviewScene.tsx:20-24` does `document.querySelector('[data-artificial-scroll="true"]') || document.getElementById('main')`.

**Fact 2 — `<ScrollRestoration>` is data-router-only.** It functions only under `createBrowserRouter`/`RouterProvider`. So adopting it _requires_ the full migration — and per Fact 1, even after migrating it still wouldn't restore the app's actual scroll container. The headline benefit of the migration is not real.

**Fact 3 — the migration is large and risky.** The router state map found: six sub-routers that add/remove routes from **runtime permission/role/env** state (`LibraryRouter`, `SeriesRouter`, `SettingsRouter` ×6 flags, `BookClubRouter`, `SmartListRouter`, `UserSmartListRouter`); up to **four** levels of descendant `<Routes>`; root-level `useNavigate`/`useLocation` above `AppRouter` feeding auth redirects (`App.tsx:27-28`); auth and page data resolved by **react-query inside layouts** (`useSuspenseGraphQL`), not route loaders; and the Stream D **background-location peek** (`<Routes location={backgroundLocation ?? location}>` rendered twice — `AppRouter.tsx:76`, `AppLayout.tsx:258`) which **has no native data-router equivalent** and would have to be re-expressed or abandoned.

**Fact 4 — the "getting lost" pain is already largely addressed.** Stream A shipped breadcrumbs + web back/forward buttons; Stream D converted the highest-value unmount case (book detail) into a peek overlay that never unmounts the browse grid (and thus already preserves its scroll implicitly). What remains is scroll restoration on the navigations that _do_ unmount (e.g. library → series → back, or a full-page book route → back).

**Forces:** deliver the user-facing scroll-restoration fix; do not regress the peek overlay or the ~30 pathname-regex shell couplings the map catalogued (`AppLayout` reader-hide, per-header tab-active, settings sidebar); keep risk proportional to value; leave the door open to a data router later if loaders / a single route manifest ever become needed.

## Decision

**Do not migrate to a data router now.** Implement scroll restoration as a **custom hook** mounted in `AppLayout`, keyed by `location.key`, operating on the app's actual scroll container (`[data-artificial-scroll="true"]` → `#main` fallback), using `useNavigationType()` (available in the component API) to restore on `POP` and reset to top on `PUSH`.

Keep the existing `<BrowserRouter>` + declarative `<Routes>` structure, the six descendant sub-routers, the Stream D peek pattern, and the pathname-regex shell couplings **unchanged**.

## Rationale

- It **actually delivers the goal.** A custom hook against the real scroller restores scroll; `<ScrollRestoration>` would not (Facts 1–2).
- **Risk is proportional to value.** The hook is one file plus a mount point; the migration is a multi-day refactor touching every router, the root nav hooks, the auth/data model, and the peek pattern — for a benefit that doesn't materialize.
- **Preserves what already works.** The peek overlay (Stream D), the base-path `usePaths`/`RouterContext` split, and every `startsWith`/regex nav-active check keep working untouched.
- **Reversible / non-blocking.** Nothing here forecloses a future data-router migration; if loaders, a central route manifest, or route-aware shell config ever become genuinely needed, this ADR can be superseded. Those benefits are **not needed today** (data is fetched fine via react-query; the shell couplings, while fragile, are not broken).

## Consequences

### Positive

- Scroll position restored on back/forward for the primary scroller, with a small, testable, self-contained hook.
- Zero change to routing structure → no risk to the peek overlay, deep-linking, permission-gated routes, or the shell couplings.
- The one latent bug found in passing (`CreateLibraryScene.tsx:110` scrolls `window` instead of the app scroller) can be fixed by reusing the same "resolve the real scroller" helper.

### Negative / accepted limitations

- **We do not get** a single route manifest, route loaders, or `useMatches`-driven shell config. The ~30 pathname-regex couplings remain (fragile but functional) — explicitly **out of scope**; touching them is risk without user-facing benefit.
- **The scroller is nuanced and the hook must account for it:**
  - Primary scroller is the OS viewport (`[data-artificial-scroll="true"]`); falls back to `#main` when pretty scrollbars are disabled. The OS instance re-inits on theme/pref changes, so the hook must resolve the scroller lazily each time, not cache the element.
  - `SettingsLayout.tsx:56` creates its **own** independent `overflow-y-auto` scroller inside the outlet — settings sub-navigation scroll is a separate container. V1 targets the primary app scroller; settings-internal restoration is a documented follow-up, not a blocker.
  - Some grids virtualize inside their own scroll containers (`LibrarySeriesGrid`, `SeriesBookGrid`); where a page scrolls its own inner container rather than `#main`, V1 restores what it can (the app scroller) and treats inner-container restoration as out of scope.
- **Async content height:** restoring after `POP` must tolerate content that hasn't laid out to full height yet (Suspense/react-query). The hook restores in a layout effect and retries briefly (a bounded `requestAnimationFrame`/ResizeObserver loop) so a cache-hit list (the common back-navigation case, where react-query renders synchronously at full height) restores cleanly, and a slow list converges without an infinite loop.
- Position store is per-session (a `Map`/`sessionStorage` keyed by `location.key`), matching React Router's own `<ScrollRestoration>` semantics; it does not survive a full reload (nor should it — a reloaded deep link should land at top).

## Alternatives considered

- **A. Full `createBrowserRouter` migration + `<ScrollRestoration>`** — _rejected._ Does not restore the app's real scroll container (Facts 1–2); highest-risk change in the codebase (Fact 3); would force re-expressing or dropping the peek pattern. Revisit only if loaders / central route manifest become required.
- **C. Keep the declarative router but also refactor the pathname-regex couplings into a route-config table** — _deferred._ Orthogonal to scroll; adds real surface area to a set of couplings that currently work. No user-facing benefit now.
