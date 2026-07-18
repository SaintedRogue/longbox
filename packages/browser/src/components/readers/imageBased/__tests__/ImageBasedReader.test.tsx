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
jest.mock('@longbox/client', () => ({
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
