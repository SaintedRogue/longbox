import { render, screen } from '@testing-library/react'

import ReaderFooter from '../ReaderFooter'

const mockBookPageURL = jest.fn(
	(id: string, page: number, params?: { width?: number }) =>
		`/api/v2/media/${id}/page/${page}${params?.width ? `?width=${params.width}` : ''}`,
)

let mockCtx = {
	book: { id: 'b', pages: 4 },
	currentPage: 1,
	setCurrentPage: jest.fn(),
	imageSizes: {},
	setPageSize: jest.fn(),
	pageSets: [[0], [1], [2], [3]],
	timer: { getCurrentTime: () => 0 },
}
let mockPrefs = {
	settings: { showToolBar: false, preload: { ahead: 5, behind: 3 } },
	bookPreferences: {
		readingMode: 'PAGED',
		readingDirection: 'LTR',
		trackElapsedTime: false,
	},
}

jest.mock('../../context', () => ({
	useImageBaseReaderContext: () => mockCtx,
}))
jest.mock('@/scenes/book/reader/useBookPreferences', () => ({
	useBookPreferences: () => mockPrefs,
}))
jest.mock('@/hooks/usePreferences', () => ({
	usePreferences: () => ({ preferences: { thumbnailRatio: 0.6667 } }),
}))
jest.mock('@longbox/client', () => ({
	useSDK: () => ({ sdk: { media: { bookPageURL: mockBookPageURL } } }),
}))
jest.mock('@longbox/i18n', () => ({ formatHumanDuration: () => '0s' }))
jest.mock('@/components/entity', () => ({
	EntityImage: ({ src }: { src: string }) => <img src={src} alt="page preview" />,
}))
// The real Virtuoso measures the DOM, and jsdom reports every box as 0x0 -- it would render no
// items at all. This stand-in renders the whole list, which is what the assertions are about.
jest.mock('react-virtuoso', () => ({
	Virtuoso: ({
		data,
		itemContent,
	}: {
		data: number[][]
		itemContent: (idx: number, item: number[]) => React.ReactNode
	}) => (
		<div>
			{data.map((item, idx) => (
				<div key={idx}>{itemContent(idx, item)}</div>
			))}
		</div>
	),
}))

const previews = () => screen.queryAllByAltText('page preview')

describe('ReaderFooter', () => {
	beforeEach(() => {
		jest.clearAllMocks()
		mockCtx = {
			book: { id: 'b', pages: 4 },
			currentPage: 1,
			setCurrentPage: jest.fn(),
			imageSizes: {},
			setPageSize: jest.fn(),
			pageSets: [[0], [1], [2], [3]],
			timer: { getCurrentTime: () => 0 },
		}
		mockPrefs = {
			settings: { showToolBar: false, preload: { ahead: 5, behind: 3 } },
			bookPreferences: {
				readingMode: 'PAGED',
				readingDirection: 'LTR',
				trackElapsedTime: false,
			},
		}
	})

	/**
	 * The footer animates in and out rather than unmounting, so the strip used to start fetching a
	 * preview for every visible page the moment a book was opened -- competing with the page the
	 * reader was trying to paint, whether or not the toolbar was ever shown.
	 */
	it('fetches no previews until the toolbar has been shown', () => {
		render(<ReaderFooter />)
		expect(previews()).toHaveLength(0)
	})

	it('renders previews once the toolbar is shown', () => {
		const { rerender } = render(<ReaderFooter />)

		mockPrefs = { ...mockPrefs, settings: { ...mockPrefs.settings, showToolBar: true } }
		rerender(<ReaderFooter />)

		expect(previews()).toHaveLength(4)
	})

	/** Latched: dismissing the toolbar must not throw away previews about to be wanted again. */
	it('keeps previews mounted after the toolbar is dismissed again', () => {
		const { rerender } = render(<ReaderFooter />)

		mockPrefs = { ...mockPrefs, settings: { ...mockPrefs.settings, showToolBar: true } }
		rerender(<ReaderFooter />)
		mockPrefs = { ...mockPrefs, settings: { ...mockPrefs.settings, showToolBar: false } }
		rerender(<ReaderFooter />)

		expect(previews()).toHaveLength(4)
	})

	/**
	 * Previews are painted ~100 CSS px wide. Requesting the untouched source page for each one
	 * meant megabytes of 2000x3000 JPEG per thumbnail, decoded on the main thread.
	 */
	it('requests downscaled previews rather than full-resolution pages', () => {
		mockPrefs = { ...mockPrefs, settings: { ...mockPrefs.settings, showToolBar: true } }
		render(<ReaderFooter />)

		expect(previews()).not.toHaveLength(0)
		for (const preview of previews()) {
			expect(preview).toHaveAttribute('src', expect.stringContaining('width=320'))
		}
	})
})
