# ADR-0002: Book detail is a page, not a peek overlay

## Status

Accepted (2026-07-25). Supersedes the Stream D "peek overlay" decision recorded in
[ADR-0001](./0001-router-and-scroll-restoration.md) §22/§24/§38. The scroll-restoration decision
in ADR-0001 — a custom hook rather than a data-router migration — still stands, and this change
makes it load-bearing rather than supplementary.

## Context

ADR-0001 recorded the peek overlay as a solved problem: book detail rendered into a right-hand
slide-over while the browse grid kept rendering behind it, so drilling into a book never unmounted
the list and its scroll survived implicitly. Mechanically it worked by rendering the route tree
twice — `AppRouter` matched the main `<Routes>` against `state.backgroundLocation` while a second
`<Routes>` in `AppLayout` matched the real URL and rendered `BookPeekSheet`.

In use it did not hold up, for three reasons.

**It had no opt-out.** `BookCard` set `backgroundLocation` unconditionally
(`BookCard.tsx:176-186`), so _every_ book card anywhere opened a peek. That included the
"Next in series" strip, which is rendered only on a book page — so tapping the next book peeked a
book on top of a book. There was no browse context to preserve there; the overlay was pure cost.

**The peek was a dead end.** `BookOverviewContent` rendered `BooksAfterCursor` only in its `page`
variant, so the sheet had no "Next in series" of its own. Finishing book 1 and tapping book 2
produced a panel you could not continue from: reaching book 3 meant closing the panel, going back
to the series grid, and finding it manually.

**It was inconsistent.** Grids peeked; carousels, tables, the home-screen rows and the file
explorer all navigated full-page. The same card in two places did two different things, and
nothing in the UI explained which you would get.

The panel was also 83% of the viewport width on phones — a page wearing a panel's clothes, with a
close button where the system back gesture belonged.

## Decision

**Remove the peek overlay.** Every book link navigates to `/books/:id` as an ordinary page.

Deleted: `BookPeekSheet`, the overlay `<Routes>` in `AppLayout`, the `backgroundLocation` plumbing
and stale-state strip in `AppRouter`, and the `variant` prop on `BookOverviewContent`. Retained:
`state.from` on `BookCard`, which is a separate contract — the reader headers read it to place
their back arrow.

Browse grids now unmount on drill-down, so returning to one is a real POP restore. Three things had
to be true first, and were done before the removal:

1. **react-query defaults** (`staleTime: 30s`, `gcTime: 30m`). Previously `staleTime: 0` refetched
   every list on remount and the default 5-minute `gcTime` evicted anything older, so returning
   re-suspended and the grid rendered at zero height.
2. **A retry budget that outlasts a cold list** — `useScrollRestoration` extended from ~1s to ~3s,
   and made to abort on `wheel`/`touchstart`/`keydown` so it yields to a user who has started
   scrolling rather than snapping them back.
3. **Browse-position memory**, so "up" links return to the list as it was left rather than to page
   1 — the guarantee the peek used to provide by never unmounting the list at all.

## Consequences

### Positive

- One code path for book detail. A book card does the same thing everywhere.
- "Next in series" chains: book page → next book page → next again, no dead end.
- The system back gesture works on mobile, on a real page, instead of a close button on a panel.
- Two `<Routes>` trees rendering simultaneously — the single most surprising thing in the router,
  and the reason ADR-0001 judged a data-router migration infeasible — is gone. That migration is
  now merely large rather than blocked.

### Negative / accepted

- Scroll restoration is now the _only_ mechanism preserving grid position, where it previously had
  the peek as a backstop for the highest-traffic case. A regression in `useScrollRestoration` or in
  the cache defaults is now user-visible on every drill-down. Both are covered by tests
  (`useScrollRestoration.test.tsx`, `client.test.ts`), which is the mitigation.
- A cold list — one evicted after 30 minutes — still repaints from scratch on return, and scroll
  restoration converges only once the content reaches full height. The budget covers a slow list,
  but a genuinely failed refetch lands at the top.
- Returning to a grid re-renders it, which the peek avoided. Not measurable against the
  non-virtualized `DynamicCardGrid` at current page sizes, but it is real work that used to be
  skipped.
