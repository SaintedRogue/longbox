# Reader Navigation & History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make browser/OS Back exit the comic reader to the book's info page instead of stepping page-by-page, by removing page state from the URL and resuming from saved reading progress; add an always-visible reading-progress hairline.

**Architecture:** The online image-based reader stops pushing `?page=N` per turn and holds page in React state, exactly as the offline reader (`syncPageToUrl={false}`) already does. `BookReaderScene` derives its start page from a one-shot router-`state.startPage` signal (for "Read from beginning") falling back to saved `readProgress.page`. `paths.bookReader()` stops building `?page=`. A small `ReaderProgressLine` renders a bottom-edge fill, visible only while the toolbar is hidden.

**Tech Stack:** React 18, React Router v6 (`react-router-dom`), TypeScript, Jest + `@testing-library/react`, framer-motion, TailwindCSS (custom `z-[..]` + `--spacing-safe-*` CSS vars), `@stump/components` (`cn`, `ButtonOrLink`), `@stump/graphql` enums (`ReadingMode`, `ReadingDirection`).

## Global Constraints

- Package root for all commands: `packages/browser`. Run a single test: `yarn jest <relative-path>`. Run one test by name: `yarn jest <path> -t "<name>"`. All tests: `yarn test`. Typecheck: `yarn check-types`. Lint: `yarn lint`.
- Commit-message convention (from git history): `<type>(reader): <summary>` — e.g. `fix(reader): …`, `refactor(reader): …`, `feat(reader): …`.
- Reader files may carry `/* eslint-disable react-compiler/react-compiler */` and `// @ts-expect-error` before `className` on `motion.*` — preserve each file's existing directives and use the same `@ts-expect-error` idiom for new `motion.*` `className`s.
- Work on branch `fix/reader-book-level-history` (created in Task 0). Do not commit to `main`.
- Do not add page-level deep-link handling; incoming `?page=` params are intentionally ignored.

---

### Task 0: Branch and commit the approved spec

**Files:**

- Commit: `docs/superpowers/specs/2026-07-17-reader-navigation-history-design.md`

- [ ] **Step 1: Create the working branch**

```bash
cd /home/rogue/longbox
git checkout -b fix/reader-book-level-history
```

- [ ] **Step 2: Commit the spec**

```bash
git add docs/superpowers/specs/2026-07-17-reader-navigation-history-design.md
git commit -m "docs(reader): spec for book-level reader history & progress resume"
```

---

### Task 1: Remove the reader's URL-page sync

Sever `ImageBasedReader` from the URL: page lives only in `currentPage` state. This is the keystone — it stops the per-turn history push. The offline reader loses its now-redundant `syncPageToUrl={false}` prop.

**Files:**

- Modify: `packages/browser/src/components/readers/imageBased/ImageBasedReader.tsx`
- Modify: `packages/browser/src/scenes/downloads/OfflineBookReaderScene.tsx:61`
- Test: `packages/browser/src/components/readers/imageBased/__tests__/ImageBasedReader.test.tsx` (rewrite)
- Test: `packages/browser/src/scenes/downloads/__tests__/OfflineBookReaderScene.test.tsx` (drop sync assertion)

**Interfaces:**

- Produces: `ImageBasedReader` with props `{ media: ImageReaderBookRef; isIncognito?: boolean; initialPage?: number; onProgress?: (page: number, elapsedSeconds: number) => void }` — **no** `syncPageToUrl`. A page change updates internal `currentPage` state and calls `onProgress`; it never calls `navigate`.

- [ ] **Step 1: Rewrite the test to the new state-only contract**

Replace the entire contents of `__tests__/ImageBasedReader.test.tsx` with:

```tsx
import { act, render } from '@testing-library/react'

import { ImageReaderBookRef } from '../context'
import ImageBasedReader from '../ImageBasedReader'

// The paged reader is mocked so the test can observe which page the reader hands it on each
// render, and drive a page change through the real `onPageChange` wiring.
const mockPagedReader = jest.fn()
jest.mock('../paged', () => ({
	AnimatedPagedReader: () => null,
	PagedReader: (props: { currentPage: number; onPageChange: (page: number) => void }) => {
		mockPagedReader(props)
		return null
	},
}))
jest.mock('../continuous', () => ({ ContinuousScrollReader: () => null }))
jest.mock('../container', () => ({
	__esModule: true,
	default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))
jest.mock('@/hooks/usePreloadPage', () => ({ usePreloadPage: jest.fn() }))
jest.mock('../useImageSizes', () => ({
	useImageSizes: () => ({ imageSizes: {}, setPageSize: jest.fn() }),
}))
jest.mock('@stump/client', () => ({
	DEFAULT_BOOK_PREFERENCES: { doublePageBehavior: 'off' },
	useSDK: () => ({
		sdk: { media: { bookPageURL: (id: string, page: number) => `/${id}/${page}` } },
	}),
}))
jest.mock('@tanstack/react-query', () => ({
	useQueryClient: () => ({ invalidateQueries: jest.fn() }),
}))
jest.mock('rooks', () => ({ useWindowSize: () => ({ innerWidth: 412, innerHeight: 915 }) }))
jest.mock('@/stores/reader', () => ({
	useBookTimer: () => ({ getCurrentTime: () => 0, pause: jest.fn(), resume: jest.fn() }),
}))
jest.mock('@/scenes/book/reader/useBookPreferences', () => ({
	useBookPreferences: () => ({
		bookPreferences: {
			doublePageBehavior: 'off',
			readingMode: 'PAGED',
			readingDirection: 'LTR',
			trackElapsedTime: false,
			secondPageSeparate: false,
			imageScaling: { scaleToFit: 'HEIGHT' },
		},
		settings: { preload: { ahead: 1, behind: 1 }, showToolBar: false, animatedReader: false },
		setSettings: jest.fn(),
	}),
}))

const book = {
	id: 'book-1',
	resolvedName: 'A Comic',
	pages: 10,
	readProgress: null,
	libraryConfig: {
		defaultReadingImageScaleFit: 'HEIGHT',
		defaultReadingMode: 'PAGED',
		defaultReadingDir: 'LTR',
	},
} as unknown as ImageReaderBookRef

describe('ImageBasedReader', () => {
	beforeEach(() => mockPagedReader.mockClear())

	const currentPageOfLastRender = () => mockPagedReader.mock.calls.at(-1)?.[0].currentPage
	const turnPageTo = (page: number) =>
		act(() => mockPagedReader.mock.calls.at(-1)?.[0].onPageChange(page))

	it('seeds the paged reader from initialPage', () => {
		render(<ImageBasedReader media={book} initialPage={3} />)
		expect(currentPageOfLastRender()).toBe(3)
	})

	it('advances the paged reader from its own state on a page change', () => {
		render(<ImageBasedReader media={book} initialPage={3} />)
		turnPageTo(4)
		expect(currentPageOfLastRender()).toBe(4)
	})

	// No URL means later `initialPage` prop values (e.g. an unrelated re-render) must not
	// clobber the page the reader advanced to in its own state.
	it('keeps its own page across re-renders, ignoring later initialPage props', () => {
		const { rerender } = render(<ImageBasedReader media={book} initialPage={3} />)
		turnPageTo(2)
		expect(currentPageOfLastRender()).toBe(2)
		rerender(<ImageBasedReader media={book} initialPage={6} />)
		expect(currentPageOfLastRender()).toBe(2)
	})
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `yarn jest src/components/readers/imageBased/__tests__/ImageBasedReader.test.tsx`
Expected: FAIL — the third test fails because the current resync effect still follows the `initialPage` prop (reader shows 6, not 2).

- [ ] **Step 3: Remove the URL-sync machinery from `ImageBasedReader.tsx`**

In `ImageBasedReader.tsx`:

(a) Delete the two imports that are about to become unused:

```tsx
import { useNavigate } from 'react-router'
```

```tsx
import { usePaths } from '@/paths'
```

(b) Delete these two lines inside the component:

```tsx
	const paths = usePaths()
```

```tsx
	const navigate = useNavigate()
```

(c) Remove the `syncPageToUrl` prop from the `Props` type and the destructure so the type becomes:

```tsx
type Props = {
	/**
	 * The media which is being read
	 */
	media: ImageReaderBookRef
	/**
	 * Whether or not the reader is in incognito mode. If true, no progress will be reported.
	 */
	isIncognito?: boolean
	/**
	 * The initial page to start on, if any. This is 1-indexed, and defaults to 1 if not provided.
	 */
	initialPage?: number
	onProgress?: (page: number, elapsedSeconds: number) => void
}

export default function ImageBasedReader({ media, isIncognito, initialPage, onProgress }: Props) {
```

(d) Delete the URL→state resync effect entirely (the `useEffect` guarded by `syncPageToUrl && initialPage != null` and its doc comment):

```tsx
	/**
	 * When page changes are synced to the URL, ... state is the sole source of truth.
	 */
	useEffect(() => {
		if (syncPageToUrl && initialPage != null) {
			setCurrentPage(initialPage)
		}
	}, [syncPageToUrl, initialPage])
```

(e) Replace `handleChangePage` (and its doc comment) with the state-only version:

```tsx
	/**
	 * Handle a page change: update local state and report progress. The reader never writes
	 * page state to the URL — Back/Forward operate at the book level, and position is resumed
	 * from saved reading progress.
	 */
	const handleChangePage = useCallback(
		(newPage: number) => {
			setCurrentPage(newPage)

			if (!isIncognito) {
				const elapsedSeconds = timer.getCurrentTime()
				onProgress?.(newPage, elapsedSeconds)
			}
		},
		[isIncognito, timer, onProgress],
	)
```

Leave `renderReader` unchanged: `PagedReader` already receives `currentPage`, and `AnimatedPagedReader` is uncontrolled (it seeds from `initialPage` once and self-drives), so `initialPage` remains correct for it.

- [ ] **Step 4: Drop the `syncPageToUrl` prop from the offline reader**

In `OfflineBookReaderScene.tsx:61`, change:

```tsx
		return <ImageBasedReader media={media} syncPageToUrl={false} />
```

to:

```tsx
		return <ImageBasedReader media={media} />
```

- [ ] **Step 5: Update the offline scene test to drop the removed-prop assertion**

In `scenes/downloads/__tests__/OfflineBookReaderScene.test.tsx`:

Change the `ImageBasedReader` mock (remove `syncPageToUrl`):

```tsx
jest.mock('@/components/readers/imageBased', () => ({
	ImageBasedReader: ({
		media,
	}: {
		media: { id: string; libraryConfig?: { defaultReadingMode?: string } }
	}) => (
		<div data-testid="image-based-reader" data-reading-mode={media.libraryConfig?.defaultReadingMode}>
			{media.id}
		</div>
	),
}))
```

Rename the sync test and drop the sync assertion:

```tsx
	it("passes the user's persisted reading prefs to ImageBasedReader", () => {
		useDownloadStore.getState().setRecord(makeRecord({ bookId: 'book-1', format: 'cbz' }))
		useReaderStore.getState().setSettings({
			readingMode: ReadingMode.Paged,
			readingDirection: ReadingDirection.Rtl,
			imageScaling: { scaleToFit: ReadingImageScaleFit.Width },
		})

		renderAt('book-1')

		const reader = screen.getByTestId('image-based-reader')
		expect(reader).toHaveAttribute('data-reading-mode', ReadingMode.Paged)
	})
```

- [ ] **Step 6: Run both tests + typecheck**

Run: `yarn jest src/components/readers/imageBased/__tests__/ImageBasedReader.test.tsx src/scenes/downloads/__tests__/OfflineBookReaderScene.test.tsx`
Expected: PASS (all)
Run: `yarn check-types`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/browser/src/components/readers/imageBased/ImageBasedReader.tsx \
  packages/browser/src/components/readers/imageBased/__tests__/ImageBasedReader.test.tsx \
  packages/browser/src/scenes/downloads/OfflineBookReaderScene.tsx \
  packages/browser/src/scenes/downloads/__tests__/OfflineBookReaderScene.test.tsx
git commit -m "refactor(reader): hold page in reader state, not the URL"
```

---

### Task 2: Resume from saved progress in `BookReaderScene`

Derive the start page from `location.state.startPage ?? readProgress.page ?? 1` (clamped), delete the page-pushing entry `navigate()`s, and make the epub/pdf redirects `replace`. Extract the pure resolution logic so it is unit-testable without loading the scene's GraphQL module.

**Files:**

- Create: `packages/browser/src/scenes/book/reader/resolveInitialPage.ts`
- Create: `packages/browser/src/scenes/book/reader/__tests__/resolveInitialPage.test.ts`
- Modify: `packages/browser/src/scenes/book/reader/BookReaderScene.tsx`

**Interfaces:**

- Consumes: `ImageBasedReader` (Task 1) prop `initialPage?: number`.
- Produces: `export function resolveInitialPage(startPage: number | undefined, progressPage: number | null | undefined, pages: number): number` — returns `clamp(startPage ?? progressPage ?? 1, 1, max(1, pages))`.

- [ ] **Step 1: Write the failing unit test for `resolveInitialPage`**

Create `__tests__/resolveInitialPage.test.ts`:

```ts
import { resolveInitialPage } from '../resolveInitialPage'

describe('resolveInitialPage', () => {
	it('uses saved progress when there is no explicit start page', () => {
		expect(resolveInitialPage(undefined, 5, 10)).toBe(5)
	})

	it('prefers an explicit start page over saved progress (Read from beginning)', () => {
		expect(resolveInitialPage(1, 5, 10)).toBe(1)
	})

	it('defaults to page 1 when neither is present', () => {
		expect(resolveInitialPage(undefined, null, 10)).toBe(1)
		expect(resolveInitialPage(undefined, undefined, 10)).toBe(1)
	})

	it('clamps a stale progress page above the last page down to the last page', () => {
		expect(resolveInitialPage(undefined, 99, 10)).toBe(10)
	})

	it('clamps values below 1 up to 1', () => {
		expect(resolveInitialPage(undefined, -3, 10)).toBe(1)
	})
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `yarn jest src/scenes/book/reader/__tests__/resolveInitialPage.test.ts`
Expected: FAIL — cannot find module `../resolveInitialPage`.

- [ ] **Step 3: Implement the pure helper**

Create `resolveInitialPage.ts`:

```ts
/**
 * Resolve the 1-indexed page the reader should open on.
 *
 * Precedence: an explicit one-shot `startPage` (router state, e.g. "Read from beginning")
 * wins over saved reading progress, which wins over the default first page. The result is
 * clamped into the book's real page range so a stale progress value can never open an
 * out-of-range page.
 */
export function resolveInitialPage(
	startPage: number | undefined,
	progressPage: number | null | undefined,
	pages: number,
): number {
	const desired = startPage ?? progressPage ?? 1
	const lastPage = Math.max(1, pages)
	return Math.min(Math.max(1, desired), lastPage)
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `yarn jest src/scenes/book/reader/__tests__/resolveInitialPage.test.ts`
Expected: PASS.

- [ ] **Step 5: Rewire `BookReaderScene.tsx` to resume from progress/state**

(a) Update the react-router import to add `useLocation`:

```tsx
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
```

(b) Add the helper import alongside the existing local imports:

```tsx
import { resolveInitialPage } from './resolveInitialPage'
```

(c) Remove the now-unused `ReadingMode` from the `@stump/graphql` import and the `useBookPreferences` import — after this task neither `readingMode` nor `animatedReader` is used in the scene. The graphql import becomes:

```tsx
import { BookReaderSceneQuery, graphql } from '@stump/graphql'
```

Delete this import line:

```tsx
import { useBookPreferences } from './useBookPreferences'
```

(d) In the inner `BookReaderScene({ book })` component, read the one-shot start page. Just after `const [search] = useSearchParams()` add:

```tsx
	const location = useLocation()
	const startPage = (location.state as { startPage?: number } | null)?.startPage
```

(e) Delete the `page` search-param read:

```tsx
	const page = search.get('page')
```

(f) Delete the `useBookPreferences` destructure block:

```tsx
	const {
		bookPreferences: { readingMode, animatedReader },
	} = useBookPreferences({ book })
```

(g) Replace the old `initialPage` memo:

```tsx
	const initialPage = useMemo(() => (page ? parseInt(page, 10) : undefined), [page])
```

with:

```tsx
	const initialPage = useMemo(
		() => resolveInitialPage(startPage, book.readProgress?.page, book.pages),
		[startPage, book.readProgress?.page, book.pages],
	)
```

(h) Replace the redirect effect (the `useEffect` with the `EBOOK_EXTENSION` / `PDF_EXTENSION` / `ARCHIVE_EXTENSION` branches) with a redirect-only, `replace`-based version:

```tsx
	useEffect(() => {
		if (book.extension.match(EBOOK_EXTENSION)) {
			navigate(
				paths.bookReader(book.id, {
					epubcfi: book.readProgress?.epubcfi || null,
					isEpub: true,
				}),
				{ replace: true },
			)
		} else if (book.extension.match(PDF_EXTENSION) && !isStreaming) {
			navigate(paths.bookReader(book.id, { isPdf: true, isStreaming: false }), { replace: true })
		}
	}, [book, navigate, isStreaming])
```

Leave the render branch (`if (book.extension.match(ARCHIVE_EXTENSION) || book.extension.match(PDF_EXTENSION)) return <ImageBasedReader … initialPage={initialPage} … />`) unchanged; `initialPage` is now always a concrete clamped number.

- [ ] **Step 6: Run the helper test + typecheck**

Run: `yarn jest src/scenes/book/reader/__tests__/resolveInitialPage.test.ts`
Expected: PASS.
Run: `yarn check-types`
Expected: no errors (confirms no dangling references to `page`, `readingMode`, `animatedReader`, `ReadingMode`, or `useBookPreferences` in the scene).

- [ ] **Step 7: Commit**

```bash
git add packages/browser/src/scenes/book/reader/resolveInitialPage.ts \
  packages/browser/src/scenes/book/reader/__tests__/resolveInitialPage.test.ts \
  packages/browser/src/scenes/book/reader/BookReaderScene.tsx
git commit -m "fix(reader): resume from saved progress so Back exits to book info"
```

---

### Task 3: Remove `?page=` from reader URL construction

Drop the `page` param from `paths.bookReader()` and its type, update the two callers, and carry the "Read from beginning" / incognito restart intent via one-shot router `state.startPage`.

**Files:**

- Modify: `packages/browser/src/paths.ts`
- Modify: `packages/browser/src/scenes/book/BookReaderLink.tsx`
- Modify: `packages/browser/src/scenes/book/BookActionMenu.tsx`
- Test: `packages/browser/src/__tests__/paths.test.ts` (add a `paths.bookReader` block)

**Interfaces:**

- Consumes: `resolveInitialPage` precedence (Task 2) — `state.startPage` overrides progress.
- Produces: `paths.bookReader(id, params)` where `params` no longer has `page`; the image route is `/books/:id/reader?<flags>`. `BookActionMenu` restart items navigate with `state: { ...navigateState, startPage: 1 }`.

- [ ] **Step 1: Add failing `paths.bookReader` assertions**

Append to `src/__tests__/paths.test.ts`:

```ts
describe('paths.bookReader', () => {
	it('builds the image reader route with no page param', () => {
		expect(paths.bookReader('1')).toBe('/books/1/reader?')
	})

	it('keeps the incognito flag on the image reader route', () => {
		expect(paths.bookReader('1', { isIncognito: true })).toBe('/books/1/reader?incognito=true')
	})

	it('routes epub books to the epub reader', () => {
		expect(paths.bookReader('1', { isEpub: true })).toBe('/books/1/epub-reader?stream=false')
	})
})
```

If `paths.test.ts` does not already `import paths from '../paths'` at the top, add that import.

- [ ] **Step 2: Run it to verify it fails**

Run: `yarn jest src/__tests__/paths.test.ts -t "paths.bookReader"`
Expected: FAIL — the first assertion currently fails only if a page slips in; more importantly this locks the contract before the type change. (If it already passes, proceed — the type change in Step 3 is what enforces caller cleanup.)

- [ ] **Step 3: Remove `page` from `paths.ts`**

(a) In the `BookReaderParams` type, delete:

```ts
	page?: number
```

(b) In `bookReader`'s destructure, remove `page`:

```ts
	bookReader: (
		id: string,
		{ isEpub, isPdf, epubcfi, isAnimated, isStreaming, isIncognito }: BookReaderParams = {},
	) => {
```

(c) Delete the page-append block:

```ts
		if (page) {
			searchParams.append('page', page.toString())
		}
```

- [ ] **Step 4: Update `BookReaderLink.tsx`**

Change the progress destructure to drop `page`:

```tsx
		const { epubcfi } = readProgress || {}
```

Change the non-epub branch to build the reader route with no page (resume comes from progress; "Read again" has no active progress and therefore defaults to page 1):

```tsx
		} else {
			return paths.bookReader(id)
		}
```

- [ ] **Step 5: Update `BookActionMenu.tsx`**

(a) `continueReadingLink` — keep the `page > 0` guard, drop the arg:

```tsx
		} else if (!!page && page > 0) {
			return paths.bookReader(book.id)
		}
```

(b) `getReadFromBeginningLink` — drop `page: 1` from the URL:

```tsx
			return paths.bookReader(id, { isIncognito: incognito || undefined })
```

(c) Carry the restart intent in router state for both "Read from beginning" and "Incognito mode" items — change their `onClick`s to:

```tsx
							onClick: () =>
								navigate(getReadFromBeginningLink(false), {
									state: { ...navigateState, startPage: 1 },
								}),
```

```tsx
							onClick: () =>
								navigate(getReadFromBeginningLink(true), {
									state: { ...navigateState, startPage: 1 },
								}),
```

Leave the "Continue reading" item's `onClick` as `navigate(continueReadingLink, { state: navigateState })`.

- [ ] **Step 6: Run the paths test + typecheck**

Run: `yarn jest src/__tests__/paths.test.ts -t "paths.bookReader"`
Expected: PASS.
Run: `yarn check-types`
Expected: no errors — this proves no caller still passes `page` (the removed field would be a type error).

- [ ] **Step 7: Commit**

```bash
git add packages/browser/src/paths.ts \
  packages/browser/src/__tests__/paths.test.ts \
  packages/browser/src/scenes/book/BookReaderLink.tsx \
  packages/browser/src/scenes/book/BookActionMenu.tsx
git commit -m "refactor(reader): drop ?page= from reader URLs; restart via router state"
```

---

### Task 4: Always-visible reading-progress hairline

A minimal bottom-edge fill that reflects `currentPage / pages`, shown only while the toolbar (and its richer footer bar) is hidden, so the two never stack.

**Files:**

- Create: `packages/browser/src/components/readers/imageBased/container/ReaderProgressLine.tsx`
- Create: `packages/browser/src/components/readers/imageBased/container/__tests__/ReaderProgressLine.test.tsx`
- Modify: `packages/browser/src/components/readers/imageBased/container/ControlsOverlay.tsx`

**Interfaces:**

- Consumes: `useImageBaseReaderContext()` → `{ book: { id: string; pages: number }, currentPage: number }`; `useBookPreferences({ book })` → `{ settings: { showToolBar: boolean }, bookPreferences: { readingMode, readingDirection } }`.
- Produces: default-exported `ReaderProgressLine` React component.

- [ ] **Step 1: Write the failing component test**

Create `container/__tests__/ReaderProgressLine.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'

import ReaderProgressLine from '../ReaderProgressLine'

let mockCtx = { book: { id: 'b', pages: 10 }, currentPage: 5 }
let mockPrefs = {
	settings: { showToolBar: false },
	bookPreferences: { readingMode: 'PAGED', readingDirection: 'LTR' },
}

jest.mock('../../context', () => ({
	useImageBaseReaderContext: () => mockCtx,
}))
jest.mock('@/scenes/book/reader/useBookPreferences', () => ({
	useBookPreferences: () => mockPrefs,
}))

describe('ReaderProgressLine', () => {
	beforeEach(() => {
		mockCtx = { book: { id: 'b', pages: 10 }, currentPage: 5 }
		mockPrefs = {
			settings: { showToolBar: false },
			bookPreferences: { readingMode: 'PAGED', readingDirection: 'LTR' },
		}
	})

	it('exposes the current page as an accessible progressbar', () => {
		render(<ReaderProgressLine />)
		const bar = screen.getByRole('progressbar')
		expect(bar).toHaveAttribute('aria-valuenow', '5')
		expect(bar).toHaveAttribute('aria-valuemax', '10')
	})

	it('fills to the current-page percentage', () => {
		render(<ReaderProgressLine />)
		const fill = screen.getByRole('progressbar').firstChild as HTMLElement
		expect(fill).toHaveStyle({ width: '50%' })
	})

	it('is visible while the toolbar is hidden and hidden while it is shown', () => {
		const { rerender } = render(<ReaderProgressLine />)
		expect(screen.getByRole('progressbar')).toHaveAttribute('data-state', 'visible')

		mockPrefs = { ...mockPrefs, settings: { showToolBar: true } }
		rerender(<ReaderProgressLine />)
		expect(screen.getByRole('progressbar')).toHaveAttribute('data-state', 'hidden')
	})
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `yarn jest src/components/readers/imageBased/container/__tests__/ReaderProgressLine.test.tsx`
Expected: FAIL — cannot find module `../ReaderProgressLine`.

- [ ] **Step 3: Create the component**

Create `container/ReaderProgressLine.tsx`:

```tsx
import { cn } from '@stump/components'
import { ReadingDirection, ReadingMode } from '@stump/graphql'
import { motion } from 'framer-motion'

import { useBookPreferences } from '@/scenes/book/reader/useBookPreferences'

import { useImageBaseReaderContext } from '../context'

const transition = {
	hidden: { opacity: 0 },
	visible: { opacity: 1 },
}

/**
 * A hairline reading-progress fill pinned to the bottom edge. It is shown only while the
 * toolbar is hidden; when the toolbar opens, the full footer's own ProgressBar takes over,
 * so the two never stack. `pointer-events-none` keeps taps falling through to the page so
 * tap-to-toggle-toolbar still works.
 */
export default function ReaderProgressLine() {
	const { book, currentPage } = useImageBaseReaderContext()
	const {
		settings: { showToolBar },
		bookPreferences: { readingMode, readingDirection },
	} = useBookPreferences({ book })

	const lastPage = Math.max(1, book.pages)
	const pct = Math.min(100, Math.max(0, (currentPage / lastPage) * 100))
	const isRtl = readingDirection === ReadingDirection.Rtl && readingMode === ReadingMode.Paged

	return (
		<motion.div
			role="progressbar"
			aria-valuemin={1}
			aria-valuemax={book.pages}
			aria-valuenow={currentPage}
			data-state={showToolBar ? 'hidden' : 'visible'}
			// @ts-expect-error: className is valid on motion components in this setup
			className={cn('pointer-events-none fixed inset-x-0 bottom-0 z-[90] flex h-0.5', {
				'justify-end': isRtl,
			})}
			style={{ marginBottom: 'var(--spacing-safe-bottom, 0px)' }}
			initial={false}
			animate={showToolBar ? 'hidden' : 'visible'}
			variants={transition}
			transition={{ duration: 0.2, ease: 'easeInOut' }}
		>
			<div className="h-full bg-[#898d94]" style={{ width: `${pct}%` }} />
		</motion.div>
	)
}
```

- [ ] **Step 4: Wire it into `ControlsOverlay.tsx`**

Add the import (with the other local imports):

```tsx
import ReaderProgressLine from './ReaderProgressLine'
```

Render it as the last child inside the `<Fragment>`, after `<ReaderFooter />`:

```tsx
			<ReaderFooter />

			<ReaderProgressLine />
		</Fragment>
```

- [ ] **Step 5: Run the test, typecheck, and lint**

Run: `yarn jest src/components/readers/imageBased/container/__tests__/ReaderProgressLine.test.tsx`
Expected: PASS.
Run: `yarn check-types`
Expected: no errors.
Run: `yarn lint`
Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add packages/browser/src/components/readers/imageBased/container/ReaderProgressLine.tsx \
  packages/browser/src/components/readers/imageBased/container/__tests__/ReaderProgressLine.test.tsx \
  packages/browser/src/components/readers/imageBased/container/ControlsOverlay.tsx
git commit -m "feat(reader): always-visible reading-progress hairline"
```

---

### Task 5: Full verification

**Files:** none (verification + optional fixups).

- [ ] **Step 1: Full typecheck, lint, and test suite**

Run: `cd packages/browser && yarn check-types && yarn lint && yarn test`
Expected: all green. If lint reports formatting, run `yarn format` and re-run; commit any fixups as `style(reader): …`.

- [ ] **Step 2: End-to-end verification in a real browser**

Follow the live-verify setup (build the web dist, serve, authenticate, scan a small library) and, in the image-based reader, confirm:

- Turn several pages, then press browser/OS **Back** → lands on the book info page (`/books/:id`), not the previous page.
- Press browser **Forward** → re-enters the reader at the resumed (last) page.
- **Refresh** while reading → reopens at the last saved page.
- Open an EPUB or native-PDF book, then **Back** → exits cleanly (no `/reader` redirect flicker).
- Use the book menu's **"Read from beginning"** on a book with mid-book progress → opens at page 1.
- While reading with the toolbar hidden, the **hairline progress bar** is visible at the bottom edge and advances; opening the toolbar hides it in favor of the footer bar.

- [ ] **Step 3: Final commit if any fixups were needed**

```bash
git add -A && git commit -m "test(reader): verification fixups for book-level history"
```

---

## Self-Review

**Spec coverage:**

- "Resume from progress, not URL" → Task 2 (`resolveInitialPage` + rewire). ✓
- "One-shot `state.startPage` for restarts" → Task 2 (read) + Task 3 (`BookActionMenu` write). ✓
- "Sever URL coupling; remove `syncPageToUrl`, resync effect, per-turn navigate" → Task 1. ✓
- "EPUB/PDF redirects become `replace`" → Task 2, Step 5(h). ✓
- "Drop `?page=` from `paths.bookReader` + callers" → Task 3. ✓
- "Animated reader already correct (uncontrolled)" → Task 1, Step 3 note (no change). ✓
- "Always-visible progress indicator, hidden when toolbar shows, RTL + safe-area aware, both reading modes" → Task 4. ✓
- Testing plan (rewrite `ImageBasedReader.test.tsx`, offline test, `resolveInitialPage`, paths, E2E) → Tasks 1–5. ✓

**Placeholder scan:** No TBD/TODO; every code step shows full content. ✓

**Type consistency:** `resolveInitialPage(startPage, progressPage, pages)` signature identical across Task 2 definition, its test, and the `BookReaderScene` call site. `ImageBasedReader` prop set `{ media, isIncognito?, initialPage?, onProgress? }` consistent between Task 1 and its consumers. `state.startPage` written in Task 3 and read in Task 2 match. ✓
