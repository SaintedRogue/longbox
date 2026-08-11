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
			<span data-testid="search-is-undefined">{String(search === undefined)}</span>
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
			<button onClick={() => setFilters({} as FilterInput)}>clear filters</button>
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

		it('reports "no search" as undefined, not as an empty string', () => {
			// Not cosmetic. Browse scenes reset to page 1 when the search changes, via
			// `usePreviousIsDifferent`, which is `value != null && value !== previous`. An empty
			// string is not nullish, so on first render ('' vs undefined) it reads as a change and
			// the scene resets the page -- meaning any deep link carrying ?page=5 would snap back
			// to page 1. `undefined` is what makes the first render a non-event.
			renderAt('/libraries/1/books?page=5')

			expect(screen.getByTestId('search-is-undefined')).toHaveTextContent('true')
		})
	})

	describe('applying filters', () => {
		/**
		 * The page reset has to happen *inside* this write. A caller that set filters and then
		 * called `setPage(1)` lost the filters outright: both calls build their URL from the
		 * location of the render they were made in, so the second navigate overwrote the first.
		 * That is what stopped the filter picker applying anything at all.
		 */
		it('resets to the first page when filters change', () => {
			renderAt('/libraries/1/books?page=5')

			fireEvent.click(screen.getByText('set filters'))

			expect(screen.getByTestId('page')).toHaveTextContent('1')
		})

		it('keeps the filters it was given', () => {
			renderAt('/libraries/1/books?page=5')

			fireEvent.click(screen.getByText('set filters'))

			expect(screen.getByTestId('query').textContent).toContain('extension')
		})

		/**
		 * Rebuilding the params from scratch dropped every key this function has no opinion
		 * about, so picking a filter silently cleared the search box.
		 */
		it('keeps an active search', () => {
			renderAt('/libraries/1/books?search=batman')

			fireEvent.click(screen.getByText('set filters'))

			expect(screen.getByTestId('search')).toHaveTextContent('batman')
		})

		it('keeps the page size', () => {
			renderAt('/libraries/1/books?pageSize=40')

			fireEvent.click(screen.getByText('set filters'))

			expect(screen.getByTestId('query').textContent).toContain('pageSize=40')
		})

		it('drops the filters param entirely when filters are cleared', () => {
			renderAt('/libraries/1/books?filters=%7B%22extension%22%3A%7B%22eq%22%3A%22cbz%22%7D%7D')

			fireEvent.click(screen.getByText('clear filters'))

			expect(screen.getByTestId('query').textContent).not.toContain('filters')
		})
	})
})
