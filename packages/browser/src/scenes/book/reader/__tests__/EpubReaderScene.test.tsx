import { fireEvent, render, screen } from '@testing-library/react'
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom'

import EpubReaderScene from '../EpubReaderScene'

/**
 * Same hazard as BookReaderScene: every ebook matches `/books/:id/epub-reader`, so an
 * ebook-to-ebook navigation reconciles one long-lived EpubJsReader rather than mounting a
 * fresh one. That reader seeds `lastSyncedElapsedRef` from the *current* book's progress and
 * tracks `latestProgressSeqRef` / `didRenderToScreen` in mount-only refs, all of which would
 * carry into the next book and mis-attribute its reading time.
 *
 * epub.js cannot render under jsdom, so the reader is stubbed with a mount counter and the
 * assertion is on instance identity -- "a different book gets a fresh reader" is the contract.
 */

const mockMountCount = jest.fn()

jest.mock('@/components/readers/epub/EpubJsReader', () => ({
	__esModule: true,
	default: ({ id }: { id: string }) => {
		// eslint-disable-next-line react-hooks/rules-of-hooks
		require('react').useEffect(() => mockMountCount(id), [])
		return <div data-testid="epub-reader" data-book={id} />
	},
}))
jest.mock('@longbox/client', () => ({
	useSDK: () => ({
		sdk: {
			cacheKeys: {
				bookReader: 'bookReader',
				bookOverview: 'bookOverview',
				inProgress: 'inProgress',
			},
		},
	}),
}))
jest.mock('@tanstack/react-query', () => ({
	useQueryClient: () => ({ invalidateQueries: jest.fn() }),
}))

const renderAtEbookA = () =>
	render(
		<MemoryRouter initialEntries={['/books/ebook-a/epub-reader?stream=false']}>
			<Link to="/books/ebook-b/epub-reader?stream=false">next ebook</Link>
			<Routes>
				<Route path="/books/:id/epub-reader" element={<EpubReaderScene />} />
			</Routes>
		</MemoryRouter>,
	)

describe('EpubReaderScene', () => {
	beforeEach(() => mockMountCount.mockClear())

	it('mounts a fresh reader for each ebook rather than reusing the previous one', () => {
		renderAtEbookA()
		expect(screen.getByTestId('epub-reader')).toHaveAttribute('data-book', 'ebook-a')
		expect(mockMountCount).toHaveBeenCalledTimes(1)

		fireEvent.click(screen.getByText('next ebook'))

		expect(screen.getByTestId('epub-reader')).toHaveAttribute('data-book', 'ebook-b')
		expect(mockMountCount).toHaveBeenNthCalledWith(2, 'ebook-b')
	})
})
