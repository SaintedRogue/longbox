import { fireEvent, render, screen } from '@testing-library/react'
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom'

import BookReaderSceneContainer from '../BookReaderScene'

/**
 * Reading position must not leak between books.
 *
 * `/books/:id/reader` matches the same route pattern for every book, so on a book-to-book
 * navigation React reconciles the scene as one long-lived instance rather than mounting a
 * fresh one. ImageBasedReader seeds its page from a mount-only `useState` initializer, so
 * without an explicit remount the previous book's page survives into the next one.
 *
 * The real ImageBasedReader is used here on purpose -- only its leaf children are mocked.
 * Stubbing the reader itself makes these tests pass against the buggy code, because a
 * stateless stub re-reads `initialPage` on every render and hides the very state that leaks.
 *
 * Deliberately a separate file from BookReaderScene.test.tsx, which mocks `useNavigate`
 * globally and so cannot perform a real navigation.
 */

const BOOKS: Record<string, unknown> = {
	'book-a': {
		id: 'book-a',
		resolvedName: 'Book A',
		pages: 28,
		extension: 'cbz',
		readProgress: { page: 28, epubcfi: null, percentageCompleted: 100, elapsedSeconds: 900 },
	},
	'book-b': {
		id: 'book-b',
		resolvedName: 'Book B',
		pages: 30,
		extension: 'cbz',
		readProgress: null,
	},
}

jest.mock('@longbox/client', () => ({
	ARCHIVE_EXTENSION: /cbz|cbr|zip|rar/,
	EBOOK_EXTENSION: /epub/,
	PDF_EXTENSION: /pdf/,
	DEFAULT_BOOK_PREFERENCES: { doublePageBehavior: 'off' },
	useSDK: () => ({
		sdk: {
			cacheKeys: { inProgress: 'inProgress' },
			cacheKey: () => 'k',
			media: { bookPageURL: (id: string, page: number) => `/${id}/${page}` },
		},
	}),
	useGraphQLMutation: () => ({ mutate: jest.fn() }),
	useSuspenseGraphQL: (_q: unknown, _k: unknown, variables: { id: string }) => ({
		data: { mediaById: BOOKS[variables.id] ?? null },
	}),
}))
// Spread the real module: `paths.ts` pulls in @longbox/sdk, which reads `UserPermission` at
// import time, so replacing the whole module wholesale breaks the suite before it can run.
jest.mock('@longbox/graphql', () => ({
	...jest.requireActual('@longbox/graphql'),
	graphql: () => ({}),
}))
jest.mock('@longbox/i18n', () => ({ useLocaleContext: () => ({ t: (k: string) => k }) }))
jest.mock('@tanstack/react-query', () => ({
	useQueryClient: () => ({ invalidateQueries: jest.fn() }),
}))
jest.mock('@/offline/progressMutation', () => ({ UPDATE_READ_PROGRESS: 'M' }))
jest.mock('@/offline/progressOutbox', () => ({ enqueueProgress: jest.fn() }))

// --- leaves of the real ImageBasedReader ---------------------------------------------------
// Mocked at their deep paths, not via the `paged` / `continuous` barrels: the imageBased
// barrel re-exports straight from these files, so mocking only the barrels still drags the
// real ContinuousScrollReader (and the entity/store chain behind it) into the suite.
jest.mock('@/components/readers/imageBased/paged/PagedReader', () => ({
	__esModule: true,
	default: ({ currentPage }: { currentPage: number }) => (
		<div data-testid="paged-reader" data-current-page={String(currentPage)} />
	),
}))
jest.mock('@/components/readers/imageBased/paged/AnimatedPagedReader', () => ({
	__esModule: true,
	default: () => null,
}))
jest.mock('@/components/readers/imageBased/continuous/ContinuousScrollReader', () => ({
	__esModule: true,
	default: () => null,
}))
jest.mock('@/components/readers/imageBased/container', () => ({
	__esModule: true,
	default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))
jest.mock('@/components/readers/imageBased/useImageSizes', () => ({
	useImageSizes: () => ({ imageSizes: {}, setPageSize: jest.fn() }),
}))
jest.mock('@/hooks/usePreloadPage', () => ({ usePreloadPage: jest.fn() }))
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

const currentPage = () => screen.getByTestId('paged-reader').getAttribute('data-current-page')

const renderAtBookA = () =>
	render(
		<MemoryRouter initialEntries={['/books/book-a/reader']}>
			<Link to="/books/book-b/reader">next book</Link>
			<Routes>
				<Route path="/books/:id/reader" element={<BookReaderSceneContainer />} />
			</Routes>
		</MemoryRouter>,
	)

describe('BookReaderScene routing', () => {
	it('opens a book on its own saved progress page', () => {
		renderAtBookA()
		expect(currentPage()).toBe('28')
	})

	it("does not carry the previous book's page into the next book", () => {
		renderAtBookA()
		expect(currentPage()).toBe('28')

		fireEvent.click(screen.getByText('next book'))

		// Book B has no saved progress, so it opens on page 1 -- not on book A's page 28.
		expect(currentPage()).toBe('1')
	})
})
