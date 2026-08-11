import { fireEvent, render, screen } from '@testing-library/react'
import * as mockReact from 'react'
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom'

import BookOverviewScene from '../BookOverviewScene'

/**
 * Book detail must not leak between books.
 *
 * `/books/:id` matches the same route pattern for every book, so on a book-to-book
 * navigation -- the "Next in series" strip is the common one -- React reconciles the scene
 * as one long-lived instance rather than mounting a fresh one. Everything under it that
 * seeds state from props in a mount-only `useState` initializer therefore keeps rendering
 * the book you came from: `MediaMetadataEditor` snapshots the metadata rows, the locked
 * fields and the form defaults; `ThumbnailImage` kept its load/error flags. The symptom is
 * a page that shows the *previously viewed* book while the URL already names the new one.
 *
 * `BookOverviewContent` is stubbed with a component that snapshots its `id` prop the same
 * way the real subtree does. A stateless stub would pass against the buggy code, because it
 * re-reads `id` on every render and hides the state that leaks -- the same trap called out
 * in BookReaderSceneContainer.test.tsx.
 */

const BOOKS: Record<string, unknown> = {
	'book-a': { id: 'book-a', resolvedName: 'Book A' },
	'book-b': { id: 'book-b', resolvedName: 'Book B' },
}

jest.mock('@/components/book', () => ({
	useBookOverview: (id: string) => ({ data: { mediaById: BOOKS[id] ?? null } }),
}))
jest.mock('@/components/container', () => ({
	SceneContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))
jest.mock('react-helmet', () => ({ Helmet: () => null }))
jest.mock('../BookOverviewContent', () => ({
	__esModule: true,
	// Stands in for the real subtree's mount-only snapshots (see the block comment above).
	// `React.useState` rather than a named import: jest hoists this factory above the
	// imports, so it may only reach bindings prefixed with `mock`.
	default: function MountSnapshotContent({ id }: { id: string }) {
		const [snapshotId] = mockReact.useState(id)
		return <div data-testid="content" data-book={snapshotId} />
	},
}))

const renderedBook = () => screen.getByTestId('content').getAttribute('data-book')

const renderAtBookA = () =>
	render(
		<MemoryRouter initialEntries={['/books/book-a']}>
			<Link to="/books/book-b">next book</Link>
			<Routes>
				<Route path="/books/:id" element={<BookOverviewScene />} />
			</Routes>
		</MemoryRouter>,
	)

describe('BookOverviewScene routing', () => {
	it('renders the book named by the route', () => {
		renderAtBookA()
		expect(renderedBook()).toBe('book-a')
	})

	it("does not carry the previous book's content into the next book", () => {
		renderAtBookA()
		expect(renderedBook()).toBe('book-a')

		fireEvent.click(screen.getByText('next book'))

		expect(renderedBook()).toBe('book-b')
	})
})
