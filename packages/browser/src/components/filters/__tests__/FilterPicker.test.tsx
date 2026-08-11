import { fireEvent, render, screen, within } from '@testing-library/react'

import { FilterContext, IFilterContext } from '../context'
import FilterPicker from '../picker/FilterPicker'

// Radix's popover measures its trigger; jsdom has no ResizeObserver to measure with.
global.ResizeObserver = class {
	observe() {}
	unobserve() {}
	disconnect() {}
} as unknown as typeof ResizeObserver

jest.mock('@longbox/i18n', () => ({ useLocaleContext: () => ({ t: (key: string) => key }) }))
jest.mock('rooks', () => ({ useMediaMatch: () => false }))
jest.mock('@/scenes/library/context', () => ({ useLibraryContextSafe: () => null }))
jest.mock('@/scenes/series', () => ({ useSeriesContextSafe: () => null }))

const overview = {
	genres: ['Horror', 'Science Fiction', 'Crime'],
	writers: ['Alan Moore', 'Grant Morrison'],
	pencillers: [],
	colorists: [],
	letterers: [],
	inkers: [],
	publishers: ['DC', 'Image'],
	editors: [],
	characters: [],
	teams: [],
	coverArtists: [],
	series: [],
}

jest.mock('@longbox/client', () => ({
	useGraphQL: () => ({ data: { mediaMetadataOverview: overview } }),
}))

const setFilters = jest.fn()
const setPage = jest.fn()

const renderPicker = (filters: IFilterContext['filters'] = {}) => {
	const value = {
		filters,
		ordering: {},
		pagination: { page: 1, pageSize: 20 },
		removeSearch: jest.fn(),
		search: '',
		setFilters,
		setOrdering: jest.fn(),
		setPage,
		setSearch: jest.fn(),
	} satisfies IFilterContext

	return render(
		<FilterContext.Provider value={value}>
			<FilterPicker entity="media" />
		</FilterContext.Provider>,
	)
}

const open = () => fireEvent.click(screen.getByRole('button', { name: 'filters.buttons.filters' }))

beforeEach(() => {
	setFilters.mockClear()
	setPage.mockClear()
})

describe('FilterPicker', () => {
	it('opens on the field list rather than on any one field’s values', () => {
		renderPicker()
		open()

		expect(screen.getByText('Genre')).toBeInTheDocument()
		expect(screen.getByText('Writer')).toBeInTheDocument()
		expect(screen.getByText('Publication year')).toBeInTheDocument()
		// A value, not a field -- it must take a second click to get here.
		expect(screen.queryByText('Horror')).not.toBeInTheDocument()
	})

	it('drills into a field to show its values', () => {
		renderPicker()
		open()
		fireEvent.click(screen.getByText('Genre'))

		expect(screen.getByText('Horror')).toBeInTheDocument()
		expect(screen.getByText('Science Fiction')).toBeInTheDocument()
		expect(screen.getByPlaceholderText('Search genre...')).toBeInTheDocument()
	})

	it('searches within the selected field’s values', () => {
		renderPicker()
		open()
		fireEvent.click(screen.getByText('Genre'))
		fireEvent.change(screen.getByPlaceholderText('Search genre...'), {
			target: { value: 'sci' },
		})

		expect(screen.getByText('Science Fiction')).toBeInTheDocument()
		expect(screen.queryByText('Horror')).not.toBeInTheDocument()
	})

	it('applies a value immediately, and resets to the first page', () => {
		renderPicker()
		open()
		fireEvent.click(screen.getByText('Genre'))
		fireEvent.click(screen.getByText('Horror'))

		expect(setFilters).toHaveBeenCalledWith({ metadata: { genres: { likeAnyOf: ['Horror'] } } })
		expect(setPage).toHaveBeenCalledWith(1)
	})

	it('adds to the selection rather than replacing it, for any-of semantics', () => {
		renderPicker({ metadata: { genres: { likeAnyOf: ['Horror'] } } })
		open()
		fireEvent.click(screen.getByText('Genre'))
		fireEvent.click(screen.getByText('Crime'))

		expect(setFilters).toHaveBeenCalledWith({
			metadata: { genres: { likeAnyOf: ['Horror', 'Crime'] } },
		})
	})

	it('toggles a selected value back off', () => {
		renderPicker({ metadata: { genres: { likeAnyOf: ['Horror', 'Crime'] } } })
		open()
		fireEvent.click(screen.getByText('Genre'))
		fireEvent.click(screen.getByText('Horror'))

		expect(setFilters).toHaveBeenCalledWith({ metadata: { genres: { likeAnyOf: ['Crime'] } } })
	})

	it('shows how many values a field has selected, in the field list', () => {
		renderPicker({ metadata: { genres: { likeAnyOf: ['Horror', 'Crime'] } } })
		open()

		const genreRow = screen.getByText('Genre').closest('[cmdk-item]')
		expect(genreRow).not.toBeNull()
		expect(within(genreRow as HTMLElement).getByText('2')).toBeInTheDocument()
	})

	it('badges the trigger with the number of active filters', () => {
		renderPicker({
			extension: { anyOf: ['cbz'] },
			metadata: { genres: { likeAnyOf: ['Horror'] } },
		})

		const trigger = screen.getByRole('button', { name: 'filters.buttons.filters' })
		expect(within(trigger).getByText('2')).toBeInTheDocument()
	})

	it('offers fields with a fixed vocabulary alongside the metadata ones', () => {
		renderPicker()
		open()
		fireEvent.click(screen.getByText('Read status'))

		expect(screen.getByText('Unread')).toBeInTheDocument()
		expect(screen.getByText('Reading')).toBeInTheDocument()
	})

	it('writes a read status as an enum value', () => {
		renderPicker()
		open()
		fireEvent.click(screen.getByText('Read status'))
		fireEvent.click(screen.getByText('Unread'))

		expect(setFilters).toHaveBeenCalledWith({ readingStatus: { isAnyOf: ['NOT_STARTED'] } })
	})

	/** Committing per keystroke would make `19` a live filter on the way to `1987`. */
	it('commits a range on blur, not on every keystroke', () => {
		renderPicker()
		open()
		fireEvent.click(screen.getByText('Publication year'))

		const from = screen.getByLabelText('Publication year from')
		fireEvent.change(from, { target: { value: '1987' } })
		expect(setFilters).not.toHaveBeenCalled()

		fireEvent.blur(from)
		expect(setFilters).toHaveBeenCalledWith({ metadata: { year: { gte: 1987 } } })
	})

	it('goes back to the field list from a field', () => {
		renderPicker()
		open()
		fireEvent.click(screen.getByText('Genre'))
		expect(screen.getByText('Horror')).toBeInTheDocument()

		fireEvent.click(screen.getByRole('button', { name: /Genre/ }))
		expect(screen.queryByText('Horror')).not.toBeInTheDocument()
		expect(screen.getByText('Writer')).toBeInTheDocument()
	})

	it('offers a clear only while something is filtered', () => {
		const { unmount } = renderPicker()
		open()
		expect(screen.queryByText('Clear filters')).not.toBeInTheDocument()
		unmount()

		renderPicker({ metadata: { genres: { likeAnyOf: ['Horror'] } } })
		open()
		fireEvent.click(screen.getByText('Clear filters'))
		expect(setFilters).toHaveBeenCalledWith({})
	})
})
