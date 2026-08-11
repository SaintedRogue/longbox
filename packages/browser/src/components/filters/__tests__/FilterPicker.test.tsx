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

const seriesOverview = {
	publishers: ['DC', 'Image', 'Marvel'],
	imprints: ['Black Label', 'Vertigo'],
	bookTypes: ['Print', 'TPB'],
	statuses: ['Continuing', 'Ended'],
}

jest.mock('@longbox/client', () => ({
	useGraphQL: () => ({
		data: { mediaMetadataOverview: overview, seriesMetadataOverview: seriesOverview },
	}),
}))

const setFilters = jest.fn()
const setPage = jest.fn()

const renderPicker = (
	filters: IFilterContext['filters'] = {},
	entity: 'media' | 'series' = 'media',
) => {
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
			<FilterPicker entity={entity} />
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

	/**
	 * One write, not two. The picker used to follow `setFilters` with `setPage(1)`, and because
	 * both build their URL from the pre-click location the page reset navigated straight over
	 * the filter -- nothing applied. The page reset lives in `setFilters` now, so the picker
	 * must not call `setPage` at all; `useFilterScene` covers that the reset still happens.
	 *
	 * Mocking the two separately is exactly why this suite stayed green while the feature was
	 * broken, so the assertion is that `setPage` is *not* called.
	 */
	it('applies a value in a single write', () => {
		renderPicker()
		open()
		fireEvent.click(screen.getByText('Genre'))
		fireEvent.click(screen.getByText('Horror'))

		expect(setFilters).toHaveBeenCalledWith({ metadata: { genres: { likeAnyOf: ['Horror'] } } })
		expect(setPage).not.toHaveBeenCalled()
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

/**
 * The series tab of a library gets the same control. Its fields have a fixed vocabulary
 * rather than coming from `mediaMetadataOverview`, so nothing here depends on the query.
 */
describe('FilterPicker (series)', () => {
	const renderSeriesPicker = (filters: IFilterContext['filters'] = {}) =>
		renderPicker(filters, 'series')

	it('renders its trigger', () => {
		renderSeriesPicker()

		expect(screen.getByRole('button', { name: 'filters.buttons.filters' })).toBeInTheDocument()
	})

	it('lists the series fields', () => {
		renderSeriesPicker()
		open()

		expect(screen.getByText('Publisher')).toBeInTheDocument()
		expect(screen.getByText('Imprint')).toBeInTheDocument()
		expect(screen.getByText('Book type')).toBeInTheDocument()
		expect(screen.getByText('Status')).toBeInTheDocument()
		expect(screen.getByText('Read status')).toBeInTheDocument()
		expect(screen.getByText('Publication year')).toBeInTheDocument()
		expect(screen.getByText('Volume')).toBeInTheDocument()
		expect(screen.getByText('Age rating')).toBeInTheDocument()
	})

	/** Its options come from `seriesMetadataOverview`, not from the media one. */
	it('draws series values from the series overview', () => {
		renderSeriesPicker()
		open()
		fireEvent.click(screen.getByText('Imprint'))

		expect(screen.getByText('Vertigo')).toBeInTheDocument()
		expect(screen.getByText('Black Label')).toBeInTheDocument()
	})

	it('applies a publisher', () => {
		renderSeriesPicker()
		open()
		fireEvent.click(screen.getByText('Publisher'))
		fireEvent.click(screen.getByText('Image'))

		expect(setFilters).toHaveBeenCalledWith({
			metadata: { publisher: { likeAnyOf: ['Image'] } },
		})
	})

	it('applies a read status', () => {
		renderSeriesPicker()
		open()
		fireEvent.click(screen.getByText('Read status'))
		fireEvent.click(screen.getByText('Unread'))

		expect(setFilters).toHaveBeenCalledWith({ readingStatus: { isAnyOf: ['NOT_STARTED'] } })
	})

	it('does not offer media-only fields', () => {
		renderSeriesPicker()
		open()

		expect(screen.queryByText('Genre')).not.toBeInTheDocument()
		expect(screen.queryByText('File type')).not.toBeInTheDocument()
		expect(screen.queryByText('Cover artist')).not.toBeInTheDocument()
	})

	/** Sourced from the server now, so the value keeps the casing the data actually has. */
	it('applies a status', () => {
		renderSeriesPicker()
		open()
		fireEvent.click(screen.getByText('Status'))
		fireEvent.click(screen.getByText('Continuing'))

		expect(setFilters).toHaveBeenCalledWith({
			metadata: { status: { likeAnyOf: ['Continuing'] } },
		})
	})
})
