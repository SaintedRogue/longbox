# Reader Navigation & History — Design

Date: 2026-07-17
Status: Design approved (approach + polish chosen); pending spec review

## Goal

Make browser/OS **Back** exit the comic reader to the book's info page instead of
stepping backward one page at a time, and make **Forward** re-enter the reader at the
reader's resumed position. Reading position stops being a browser-history index and
becomes what it always should have been: saved reading progress.

Secondary (light polish, opted in): an always-visible reading-progress indicator so
position is legible without opening the toolbar.

## Non-goals

- EPUB and native-PDF readers. They never write page state to the URL (`epubcfi` /
  native paging), so they are already correct and out of scope.
- Rebuilding reader chrome, gestures, or the three reading modes.
- Page-level deep links / shareable `?page=N` URLs. The user explicitly chose to drop
  these; incoming `?page=` params are **not** honored.
- Any new touch gesture (swipe-to-exit etc.) — the panzoom/swipe pointer arbitration is
  deliberately delicate and stays untouched.

## Problem being solved

The online image-based (comic/CBZ/CBR/streamed-PDF) reader treats the current page as a
URL search param and **pushes** a new history entry on every turn.

- `paths.bookReader()` builds `/books/:id/reader?page=N` (`paths.ts:78-82`).
- `ImageBasedReader.handleChangePage` calls `navigate(paths.bookReader(...))` with no
  `replace` on every paged turn (`ImageBasedReader.tsx:143`).
- `BookReaderScene` derives the start page from `search.get('page')`
  (`BookReaderScene.tsx:99,206`) and pushes two more entries on entry: the initial
  `?page=1` landing (`:219-220`) and an out-of-range clamp (`:221-222`).

Net effect: reading a 40-page book leaves ~40 stacked history entries, so browser/OS
Back crawls page-by-page and never cleanly leaves the reader. The app's own in-reader
back arrow already sidesteps this by targeting a captured `from` location rather than
`navigate(-1)` (`ReaderHeader.tsx:26`) — that asymmetry is the tell that history is
polluted.

The codebase already contains the correct pattern: `OfflineBookReaderScene` renders
`<ImageBasedReader … syncPageToUrl={false} />` and resumes purely from stored progress,
touching neither the URL nor history. This design promotes that behavior to the online
reader and removes the now-redundant URL-page machinery entirely (the "clean removal"
option).

## Approach

Reading position lives in `ImageBasedReader`'s `currentPage` state and is persisted to
the server on every turn (the existing `updateProgress` → retry/outbox pipeline,
`BookReaderScene.tsx:151-189`). The reader route holds exactly **one** history entry, so
Back exits to book info and Forward re-enters, resuming from saved progress.

### Change 1 — `BookReaderScene.tsx`: resume from progress, not the URL

- Compute the start page from a **one-shot start signal** (router `state`, see Change 3)
  falling back to saved progress, clamped to the book's bounds, with no dependence on
  `?page=`:
  ```
  const startPage = (location.state as { startPage?: number } | null)?.startPage
  initialPage = clamp(startPage ?? book.readProgress?.page ?? 1, 1, book.pages)
  ```
  The `startPage` channel exists so explicit "Read from beginning" / incognito restarts
  can force page 1 even when saved progress is mid-book, without putting page in the URL
  or history. It is one-shot: on refresh it is gone and the reader resumes from progress,
  which is correct (by then progress reflects where the user actually is).
- Delete the two page-pushing `navigate()` calls: the `?page=1` initial landing
  (`:219-220`) and the out-of-range correction (`:221-222`). The clamp above subsumes
  both, in state, adding zero history entries.
- Keep the ebook → `/epub-reader` and pdf(non-streaming) → `/pdf-reader` redirects, but
  make them `{ replace: true }`. They currently **push**, so Back from the EPUB/PDF
  reader lands on `/reader`, which immediately redirects forward again — a back-trap.
  `replace` removes it.
- `updateProgress`, the mutation/retry/outbox logic, and `isIncognito`/`stream` handling
  are unchanged. Incognito continues to persist nothing (so it resumes at page 1, which
  is correct for incognito).

### Change 2 — `ImageBasedReader.tsx`: sever the URL coupling

- The online reader was the only `syncPageToUrl={true}` caller (the offline reader passes
  `false`). Remove the prop and all code it gated: the per-turn `navigate()` branch
  (`:142-144`), the URL→state resync effect (`:69-73`), and the now-unused `useNavigate` /
  `usePaths` imports. Page state is sourced solely from `currentPage`, exactly as the
  offline reader already runs. `OfflineBookReaderScene` (and its test) drop the now-gone
  `syncPageToUrl={false}` prop.
- No change needed for the paged renderers themselves: the controlled `PagedReader`
  already reads `currentPage` state (`:231`), and the **animated** `AnimatedPagedReader`
  is uncontrolled — it seeds its own internal page from `initialPage` once
  (`AnimatedPagedReader.tsx:33`) and self-drives, staying in sync via `onPageChanged` →
  `handleChangePage`. So `initialPage` (stable resume page) remains the correct prop for
  it, and there is no pinning bug to fix.

### Change 3 — `paths.ts`: stop building `?page=`

- Remove the `page` handling from `bookReader()` (`:78-80`) and the `page` field from
  `BookReaderParams`. `incognito`, `stream`, and `animated` params are retained. The
  image-reader URL becomes `/books/:id/reader` (plus mode flags when set).
- Update callers that pass `page` — `BookReaderLink.tsx`, `BookActionMenu.tsx` — to stop
  passing it, preserving restart intent via router `state.startPage`:
  - `BookReaderLink` (Read / Continue / Read again): every `page` value it builds already
    equals resume-from-progress (Read again only fires when there is no active progress,
    so it defaults to 1). Drop `page`; **no** `startPage` needed. "Continue reading" now
    points at `/books/:id/reader` and resumes from progress on arrival.
  - `BookActionMenu` → "Continue reading": drop `page`; resumes from progress.
  - `BookActionMenu` → "Read from beginning" and "Incognito mode": drop `page: 1` from the
    URL and instead pass `state: { ...from, startPage: 1 }` so they force page 1 even over
    mid-book progress. Incognito keeps its `incognito=true` URL flag (a legitimate,
    persistent mode) and still starts at 1 via `startPage`.

### Change 4 — Always-visible progress indicator (polish)

- Add a small component (`ReaderProgressLine`) rendered inside `ControlsOverlay`
  alongside the existing chrome. It renders a **hairline progress bar pinned to the
  bottom edge**, full width, filled to `currentPage / book.pages`.
- It is visible **only when `showToolBar` is false** — i.e. exactly when the sliding
  footer (which carries its own richer `ProgressBar`, `ReaderFooter.tsx:167`) is hidden.
  The two are mutually exclusive, so bars never stack; the line mirrors the footer's
  0.2s framer-motion fade, inverted.
- Reads `currentPage` / `book.pages` from `useImageBaseReaderContext`, which updates in
  both paged and continuous modes, so the indicator is correct in every reading mode.
- Honors RTL fill direction (matching `ReaderFooter`'s `inverted` logic) and the
  bottom safe-area inset (`--spacing-safe-bottom`) so it clears the home indicator.
- Minimal by intent: a thin bar only, no page-count text over the page art (the "N of M"
  text already lives in the full footer).

## Resulting behavior

| Action                    | Before                       | After                                      |
| ------------------------- | ---------------------------- | ------------------------------------------ |
| Turn pages                | one history entry per page   | no history entries; state + saved progress |
| Browser/OS Back           | steps back one page          | exits to book info (`/books/:id`)          |
| Browser Forward           | steps forward one page       | re-enters reader, resumed at last page     |
| Refresh in reader         | reopens same `?page=`        | reopens at last **saved** page (≈ current) |
| Back from EPUB/PDF reader | hits `/reader` redirect trap | exits cleanly (redirects now `replace`)    |
| Position while reading    | hidden unless toolbar open   | hairline bar always visible                |

## Edge cases

- **Turn-then-immediately-refresh** resumes at the last _saved_ page. The progress
  mutation fires synchronously on each turn, so the unsaved window is a single page and
  the user accepted this trade-off.
- **Incognito** persists nothing; resumes at page 1 by design.
- **Continuous scroll** already stripped `?page=` and never synced; it now aligns with
  paged mode and the progress line works there via `currentPage`.
- **Old `?page=` bookmarks** are ignored (resume from progress) — an accepted
  consequence of dropping page-level deep links.
- **"Read from beginning" over mid-book progress** starts at page 1 via `state.startPage`;
  refreshing that session thereafter resumes from progress (by then updated), not page 1.

## Testing

- Update `ImageBasedReader.test.tsx`: the `syncPageToUrl` regression tests
  (`:83-96,109-120,122-132`) are removed with the prop; add/retain coverage that page
  changes update `currentPage` and never call `navigate` for paging.
- Add a `BookReaderScene` test: `initialPage` derives from `readProgress.page`, clamps to
  `book.pages`, defaults to 1 when progress is absent, and prefers `location.state.startPage`
  when present (the "Read from beginning" restart); no page-pushing `navigate`.
- Manual/Playwright: read several pages, press browser Back → book info; Forward →
  reader at resumed page; verify EPUB/PDF Back exits cleanly; verify the hairline bar
  shows while reading and yields to the footer bar when the toolbar opens.

## Files touched

- `packages/browser/src/scenes/book/reader/BookReaderScene.tsx`
- `packages/browser/src/components/readers/imageBased/ImageBasedReader.tsx`
- `packages/browser/src/paths.ts`
- `packages/browser/src/scenes/book/BookReaderLink.tsx`
- `packages/browser/src/scenes/book/BookActionMenu.tsx`
- `packages/browser/src/components/readers/imageBased/container/ControlsOverlay.tsx`
- `packages/browser/src/components/readers/imageBased/container/ReaderProgressLine.tsx` (new)
- `packages/browser/src/scenes/downloads/OfflineBookReaderScene.tsx` (drop `syncPageToUrl` prop)
- `packages/browser/src/components/readers/imageBased/__tests__/ImageBasedReader.test.tsx`
- `packages/browser/src/scenes/downloads/__tests__/OfflineBookReaderScene.test.tsx` (drop sync assertion)
- (new) `resolveInitialPage` unit test + `ReaderProgressLine` test
