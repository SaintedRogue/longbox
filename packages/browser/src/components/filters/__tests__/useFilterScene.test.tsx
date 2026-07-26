import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, useLocation, useNavigationType } from 'react-router-dom'

import { FilterInput, Ordering } from '../context'
import { useFilterScene } from '../useFilterScene'

/**
 * Browse state lives in the URL, which is right -- but *how* it is written to the URL decides
 * whether the back button works. `setSearchParams` pushes by default, so paging 1 -> 5 used to
 * stack five history entries and typing a search stacked one per keystroke, leaving the user
 * pressing back a half-dozen times to escape a list.
 */

jest.mock('rooks', () => ({ useMediaMatch: () => false }))

function Harness() {
	const { pagination, search, setPage, setSearch, setOrdering, setFilters } = useFilterScene()
	const navigationType = useNavigationType()
	const location = useLocation()

	return (
		<div>
			<span data-testid="page">{String(pagination.page)}</span>
			<span data-testid="search">{search ?? ''}</span>
			<span data-testid="nav-type">{navigationType}</span>
			<span data-testid="query">{location.search}</span>
			<button onClick={() => setPage(5)}>set page</button>
			<button onClick={() => setSearch('batman')}>set search</button>
			<button onClick={() => setOrdering({ orderBy: 'NAME', direction: 'DESC' } as Ordering)}>
				set order
			</button>
			<button onClick={() => setFilters({ extension: { eq: 'cbz' } } as FilterInput)}>
				set filters
			</button>
		</div>
	)
}

const renderAt = (entry: string) =>
	render(
		<MemoryRouter initialEntries={[entry]}>
			<Harness />
		</MemoryRouter>,
	)

const navType = () => screen.getByTestId('nav-type').textContent

describe('useFilterScene', () => {
	describe('history hygiene', () => {
		it('replaces rather than pushes when changing page', () => {
			renderAt('/libraries/1/books?page=1')

			fireEvent.click(screen.getByText('set page'))

			expect(screen.getByTestId('page')).toHaveTextContent('5')
			expect(navType()).toBe('REPLACE')
		})

		it('replaces rather than pushes when searching', () => {
			renderAt('/libraries/1/books')
			fireEvent.click(screen.getByText('set search'))
			expect(navType()).toBe('REPLACE')
		})

		it('replaces rather than pushes when changing ordering', () => {
			renderAt('/libraries/1/books')
			fireEvent.click(screen.getByText('set order'))
			expect(navType()).toBe('REPLACE')
		})

		it('replaces rather than pushes when changing filters', () => {
			renderAt('/libraries/1/books')
			fireEvent.click(screen.getByText('set filters'))
			expect(navType()).toBe('REPLACE')
		})
	})

	describe('search seeding', () => {
		it('seeds the search value from the URL so returning to a list shows the active search', () => {
			renderAt(`/libraries/1/books?search=${encodeURIComponent('dark knight')}`)

			expect(screen.getByTestId('search')).toHaveTextContent('dark knight')
		})

		it('is empty when the URL carries no search', () => {
			renderAt('/libraries/1/books?page=2')

			expect(screen.getByTestId('search')).toBeEmptyDOMElement()
		})
	})
})
