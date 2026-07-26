import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'

import BookCard from '../BookCard'

/**
 * A book card is a plain navigation to the book's own page.
 *
 * It used to attach `state.backgroundLocation`, which made the router render the book route
 * into a slide-over on top of whatever was behind it. The flag was set unconditionally, with
 * no way to opt out, so the "Next in series" strip *on a book page* peeked a book over a book
 * -- and the sheet variant did not render its own "Next in series", making it a dead end.
 *
 * `state.from` is still set: the reader headers read it to decide where their back arrow goes.
 */

// Narrow client mock plus stubs for the hooks BookCard reaches through. Spreading the real
// @longbox/client instead drags in ESM dependencies jest cannot parse, and the real store
// chain calls createAppStore at import time.
jest.mock('@longbox/client', () => ({
	formatBytes: () => '1 MB',
	getThumbnailTintColor: () => '#000',
}))
// gql.tada masks fragment data; unmask it to the literal object the test supplies.
jest.mock('@longbox/graphql', () => ({
	...jest.requireActual('@longbox/graphql'),
	graphql: () => ({}),
	useFragment: (_fragment: unknown, data: unknown) => data,
}))
jest.mock('@/hooks/usePreferences', () => ({
	usePreferences: () => ({ preferences: { thumbnailRatio: 'BOOK' } }),
}))
jest.mock('@/hooks/useTheme', () => ({
	useTheme: () => ({ getColor: () => undefined, isDarkVariant: false }),
}))
jest.mock('@/scenes/book/BooksAfterCursor', () => ({
	usePrefetchBooksAfterCursor: () => jest.fn(),
}))
jest.mock('../useBookOverview', () => ({ usePrefetchBook: () => jest.fn() }))
jest.mock('../../thumbnail/ThumbnailImage', () => ({ ThumbnailImage: () => null }))
jest.mock('@/context', () => ({
	Link: ({ to, state, children }: any) => (
		<a href={String(to)} data-testid="card" data-state={JSON.stringify(state ?? null)}>
			{children}
		</a>
	),
}))
jest.mock('@/components/entity', () => ({
	EntityCard: ({ href, state, title }: { href?: string; state?: unknown; title?: string }) => (
		<a href={href} data-testid="card" data-state={JSON.stringify(state ?? null)}>
			{title}
		</a>
	),
}))

function LocationProbe() {
	const location = useLocation()
	return <span data-testid="state">{JSON.stringify(location.state ?? null)}</span>
}

describe('BookCard navigation', () => {
	it('links to the book page without asking the router for an overlay', () => {
		render(
			<MemoryRouter initialEntries={['/libraries/lib-1/books?page=5']}>
				<Routes>
					<Route
						path="/libraries/:id/books"
						element={
							<BookCard
								fragment={
									{
										id: 'book-1',
										resolvedName: 'A Comic',
										pages: 10,
										size: 1024,
										status: 'READY',
										readProgress: null,
										thumbnail: { url: '/t', metadata: null },
										libraryConfig: { skipBookOverview: false },
									} as never
								}
							/>
						}
					/>
					<Route path="/books/:id" element={<LocationProbe />} />
				</Routes>
			</MemoryRouter>,
		)

		const state = JSON.parse(screen.getByTestId('card').getAttribute('data-state') ?? '{}')

		expect(state).not.toHaveProperty('backgroundLocation')
		// the return-path contract the reader headers depend on stays intact
		expect(state).toHaveProperty('from', '/libraries/lib-1/books?page=5')
	})
})
