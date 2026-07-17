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
