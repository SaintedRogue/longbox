import { fireEvent, render, screen } from '@testing-library/react'
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom'

import { browseSceneKey, useBrowseHistoryStore } from '@/stores/browseHistory'

import { useBrowseReturnPath, useRememberBrowsePosition } from '../useBrowseHistory'

/**
 * The two halves of the return-to-place contract: browse scenes record where they were left,
 * and "up" links ask where to go back to.
 */

function BrowseScene({ sceneKey }: { sceneKey: string }) {
	useRememberBrowsePosition(sceneKey)
	return <Link to="/books/book-1">open a book</Link>
}

function UpLink({ sceneKey, fallback }: { sceneKey: string; fallback: string }) {
	const returnPath = useBrowseReturnPath(sceneKey, fallback)
	return <span data-testid="up-link">{returnPath}</span>
}

const renderApp = (entry: string, sceneKey: string, fallback: string) =>
	render(
		<MemoryRouter initialEntries={[entry]}>
			<Routes>
				<Route path="/libraries/:id/books" element={<BrowseScene sceneKey={sceneKey} />} />
				<Route path="/books/:id" element={<UpLink sceneKey={sceneKey} fallback={fallback} />} />
			</Routes>
		</MemoryRouter>,
	)

describe('browse history hooks', () => {
	beforeEach(() => useBrowseHistoryStore.setState({ lastVisited: {} }))

	it('sends an up-link back to the page the list was left on', () => {
		const key = browseSceneKey.library('lib-1')
		renderApp('/libraries/lib-1/books?page=5', key, '/libraries/lib-1')

		fireEvent.click(screen.getByText('open a book'))

		expect(screen.getByTestId('up-link')).toHaveTextContent('/libraries/lib-1/books?page=5')
	})

	it('falls back to the plain path when the list was never visited', () => {
		render(
			<MemoryRouter initialEntries={['/books/book-1']}>
				<Routes>
					<Route
						path="/books/:id"
						element={
							<UpLink sceneKey={browseSceneKey.library('never-seen')} fallback="/libraries/x" />
						}
					/>
				</Routes>
			</MemoryRouter>,
		)

		expect(screen.getByTestId('up-link')).toHaveTextContent('/libraries/x')
	})

	it('records the list path as well as the page, so the right tab is restored', () => {
		const key = browseSceneKey.library('lib-1')
		renderApp('/libraries/lib-1/books?page=2&orderBy=name', key, '/libraries/lib-1')

		expect(useBrowseHistoryStore.getState().lastVisited[key]).toBe(
			'/libraries/lib-1/books?page=2&orderBy=name',
		)
	})
})
