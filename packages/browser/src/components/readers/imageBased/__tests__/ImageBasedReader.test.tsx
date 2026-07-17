import { ReadingDirection, ReadingImageScaleFit, ReadingMode } from '@stump/graphql'
import { act, render } from '@testing-library/react'

import ImageBasedReader from '../ImageBasedReader'
import { ImageReaderBookRef } from '../context'

// The paged reader is mocked so the test can observe exactly which page the reader hands it
// on each render, and drive a page change through the real `onPageChange` wiring.
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

const mockNavigate = jest.fn()
jest.mock('react-router', () => ({ useNavigate: () => mockNavigate }))

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
jest.mock('@/paths', () => ({ usePaths: () => ({ bookReader: () => '/books/1/reader' }) }))
jest.mock('@/stores/reader', () => ({
	useBookTimer: () => ({ getCurrentTime: () => 0, pause: jest.fn(), resume: jest.fn() }),
}))

const mockSetSettings = jest.fn()
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
		setSettings: mockSetSettings,
	}),
}))

const book = {
	id: 'book-1',
	resolvedName: 'A Comic',
	pages: 10,
	readProgress: null,
	libraryConfig: {
		defaultReadingImageScaleFit: ReadingImageScaleFit.Height,
		defaultReadingMode: ReadingMode.Paged,
		defaultReadingDir: ReadingDirection.Ltr,
	},
} as unknown as ImageReaderBookRef

describe('ImageBasedReader', () => {
	beforeEach(() => {
		mockPagedReader.mockClear()
		mockNavigate.mockClear()
	})

	const currentPageOfLastRender = () => mockPagedReader.mock.calls.at(-1)?.[0].currentPage
	const turnPageTo = (page: number) =>
		act(() => mockPagedReader.mock.calls.at(-1)?.[0].onPageChange(page))

	// Regression: the offline reader (OfflineBookReaderScene) renders with syncPageToUrl={false}
	// and no initialPage, so there is no navigate() round-trip to feed a new page back down as a
	// prop. The reader must drive the paged renderer from its own state, or offline paged reading
	// is stuck on page 1 forever.
	it('advances the paged reader when page changes are not synced to the URL', () => {
		render(<ImageBasedReader media={book} syncPageToUrl={false} />)

		expect(currentPageOfLastRender()).toBe(1)

		turnPageTo(2)

		expect(currentPageOfLastRender()).toBe(2)
		expect(mockNavigate).not.toHaveBeenCalled()
	})

	it('advances the paged reader and syncs the URL by default', () => {
		render(<ImageBasedReader media={book} initialPage={3} />)

		expect(currentPageOfLastRender()).toBe(3)

		turnPageTo(4)

		expect(currentPageOfLastRender()).toBe(4)
		expect(mockNavigate).toHaveBeenCalled()
	})

	// Browser back/forward and the out-of-range correction change the ?page= param -- and hence the
	// initialPage prop -- without the reader driving the change. When synced to the URL, the shown
	// page must follow.
	it('follows an externally changed page when synced to the URL', () => {
		const { rerender } = render(<ImageBasedReader media={book} initialPage={3} />)

		expect(currentPageOfLastRender()).toBe(3)

		rerender(<ImageBasedReader media={book} initialPage={6} />)

		expect(currentPageOfLastRender()).toBe(6)
	})

	// The offline reader has no URL, so a state page turn must not be clobbered by a stale prop.
	it('keeps its own page when unsynced, ignoring the initialPage prop', () => {
		const { rerender } = render(<ImageBasedReader media={book} syncPageToUrl={false} />)

		turnPageTo(2)
		expect(currentPageOfLastRender()).toBe(2)

		// A re-render for an unrelated reason must not reset the page the reader advanced to.
		rerender(<ImageBasedReader media={book} syncPageToUrl={false} />)
		expect(currentPageOfLastRender()).toBe(2)
	})
})
