import {
	MediaModelOrdering,
	MediaOrderBy,
	OrderDirection,
	SeriesModelOrdering,
	SeriesOrderBy,
} from '@longbox/graphql'
import { toObjectParams, toUrlParams } from '@longbox/sdk'
import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMediaMatch } from 'rooks'

import { FilterInput, IFilterContext, Ordering, OrderingField } from './context'

type Return = IFilterContext

export const DEFAULT_SERIES_ORDER_BY: SeriesOrderBy[] = [
	{ series: { field: SeriesModelOrdering.Name, direction: OrderDirection.Asc } },
] as SeriesOrderBy[]

export const DEFAULT_MEDIA_ORDER_BY: MediaOrderBy[] = [
	{ media: { field: MediaModelOrdering.Name, direction: OrderDirection.Asc } },
] as MediaOrderBy[]

/**
 * Browse state (page, page size, ordering, filters, search) is written to the URL by
 * *replacing* the current history entry rather than pushing a new one.
 *
 * Pushing looks harmless per-write but compounds: paging 1 -> 5 stacked five entries and
 * typing a search stacked one per keystroke, so backing out of a list took a half-dozen
 * presses. Replacing keeps every one of these states deep-linkable and shareable while
 * leaving exactly one history entry for the list, so back means "leave this list" -- and
 * lands on the page the user was actually on, since that is what the entry now holds.
 */
const REPLACE_ENTRY = { replace: true } as const

export const useURLPageParams = () => {
	const [searchParams, setSearchParams] = useSearchParams()

	const is3XLScreenOrBigger = useMediaMatch('(min-width: 1600px)')
	const defaultPageSize = is3XLScreenOrBigger ? 40 : 20

	const pagination = useMemo(
		() => ({
			page: searchParams.get('page') ? parseInt(searchParams.get('page') as string) : 1,
			pageSize: searchParams.get('pageSize')
				? parseInt(searchParams.get('pageSize') as string)
				: defaultPageSize,
		}),
		[searchParams, defaultPageSize],
	)

	const setPage = useCallback(
		(page: number) => {
			setSearchParams((prev) => {
				prev.set('page', page.toString())
				return prev
			}, REPLACE_ENTRY)
		},
		[setSearchParams],
	)

	const setPageSize = useCallback(
		(pageSize: number) => {
			setSearchParams((prev) => {
				prev.set('pageSize', pageSize.toString())
				return prev
			}, REPLACE_ENTRY)
		},
		[setSearchParams],
	)

	return { ...pagination, setPage, setPageSize }
}

export const useURLKeywordSearch = () => {
	const [searchParams, setSearchParams] = useSearchParams()

	const search = useMemo(() => {
		const searchValue = searchParams.get('search')
		return searchValue ? decodeURIComponent(searchValue) : ''
	}, [searchParams])

	const setSearch = useCallback(
		(newSearch: string) => {
			setSearchParams((prev) => {
				if (newSearch) {
					prev.set('search', encodeURIComponent(newSearch))
				} else {
					prev.delete('search')
				}
				return prev
			}, REPLACE_ENTRY)
		},
		[setSearchParams],
	)

	const removeSearch = useCallback(() => {
		setSearchParams((prev) => {
			prev.delete('search')
			return prev
		}, REPLACE_ENTRY)
	}, [setSearchParams])

	return { search, setSearch, removeSearch }
}

/**
 * Keyword search is a server concern now, not a filter the client assembles.
 *
 * `useSearchMediaFilter`/`useSearchSeriesFilter` used to build an `_or` array of
 * three `contains` clauses here. Scenes pass the raw term to the `search`
 * argument on `media`/`series` instead, which covers far more fields, escapes
 * LIKE wildcards, and treats a multi-word query as separate terms. It is also
 * the only way OPDS and the web client can agree on what a match means -- they
 * previously drifted, with three different field sets between them.
 */

export function useFilterScene(): Return {
	const [searchParams, setSearchParams] = useSearchParams()
	// Derived from the URL rather than held alongside it. This was local state seeded to
	// `undefined`, so arriving at a list that already had `?search=...` -- a shared link, or a
	// back-navigation into a search you had run -- rendered an empty search box over filtered
	// results. The URL is the single source of truth; `useURLKeywordSearch` is the one reader.
	//
	// Normalised back to `undefined` when absent, which is load-bearing rather than tidiness.
	// Browse scenes reset to page 1 when the search changes, via `usePreviousIsDifferent` --
	// `value != null && value !== previous`. An empty string is not nullish, so on first render
	// ('' against undefined) it reads as a change and the scene resets the page, which would
	// make every deep link carrying ?page=5 snap back to page 1.
	const { search: urlSearch } = useURLKeywordSearch()
	const search = urlSearch || undefined

	const is3XLScreenOrBigger = useMediaMatch('(min-width: 1600px)')
	const defaultPageSize = is3XLScreenOrBigger ? 40 : 20

	/**
	 * An object representation of the url params without the excluded keys, such as
	 * orderBy, direction, search, page, and pageSize.
	 */
	const filters = useMemo(() => {
		const filtersJsonStr = searchParams.get('filters')
		const filters: FilterInput = filtersJsonStr ? JSON.parse(filtersJsonStr) : {}
		return filters
	}, [searchParams])

	/**
	 * An object representation of the ordering params
	 */
	const ordering = useMemo(
		() => ({
			orderBy: searchParams.get('orderBy') as OrderingField,
			direction: searchParams.get('direction') as OrderDirection,
		}),
		[searchParams],
	)

	/**
	 * An object representation of the pagination params
	 */
	const pagination = useMemo(
		() => ({
			page: searchParams.get('page') ? parseInt(searchParams.get('page') as string) : 1,
			pageSize: searchParams.get('pageSize')
				? parseInt(searchParams.get('pageSize') as string)
				: defaultPageSize,
		}),
		[searchParams, defaultPageSize],
	)

	const setOrdering = useCallback(
		(newOrdering: Ordering) => {
			setSearchParams(
				toUrlParams(
					{
						...pagination,
						...newOrdering,
						filters: JSON.stringify(filters),
					},
					undefined,
					{ removeEmpty: true },
				),
				REPLACE_ENTRY,
			)
		},
		[setSearchParams, pagination, filters],
	)

	const setPage = useCallback(
		(page: number) => {
			setSearchParams((prev) => {
				prev.set('page', page.toString())
				return prev
			}, REPLACE_ENTRY)
		},
		[setSearchParams],
	)

	/**
	 * Replace the current filters with the provided filters, and go back to the first page.
	 *
	 * The page reset belongs *here*, in the same write, rather than in a `setPage(1)` next to
	 * the call. `setSearchParams` builds its next URL from the location of the render it was
	 * created in, so two calls in one click both start from the pre-click params and the second
	 * navigate discards the first -- filters were set and then immediately thrown away by the
	 * page reset. One write, one navigate.
	 *
	 * Written as an updater over the existing params rather than a fresh object, so everything
	 * this function has no opinion about survives: `pageSize`, the collections `view` toggle,
	 * and in particular `search`, which a rebuilt-from-scratch param set used to drop -- picking
	 * a filter would silently clear the search box.
	 */
	const handleSetFilters = useCallback(
		(newFilters: FilterInput) => {
			setSearchParams((prev) => {
				const next = new URLSearchParams(prev)
				if (Object.keys(newFilters).length) {
					next.set('filters', JSON.stringify(newFilters))
				} else {
					next.delete('filters')
				}
				next.set('page', '1')
				return next
			}, REPLACE_ENTRY)
		},
		[setSearchParams],
	)

	/**
	 * Sets a single filter in the url with the provided value
	 */
	const handleSetSearch = useCallback(
		(value: string) => {
			setSearchParams((prev) => {
				const params = toObjectParams<Record<string, unknown>>(prev)
				params['search'] = value
				return toUrlParams(params)
			}, REPLACE_ENTRY)
		},
		[setSearchParams],
	)

	/**
	 * Removes a filter from the url
	 */
	const removeSearch = useCallback(() => {
		setSearchParams((prev) => {
			prev.delete('search')
			return prev
		}, REPLACE_ENTRY)
	}, [setSearchParams])

	return {
		filters,
		ordering,
		pagination,
		removeSearch,
		search,
		setSearch: handleSetSearch,
		setFilters: handleSetFilters,
		setOrdering,
		setPage,
	}
}

export function useMediaURLOrderBy(ordering: Ordering): MediaOrderBy[] {
	return useMemo(() => {
		// check for undefined values
		if (!ordering || !ordering.orderBy || !ordering.direction) {
			return DEFAULT_MEDIA_ORDER_BY
		}

		return [
			{
				media: {
					field: ordering.orderBy as MediaModelOrdering,
					direction: ordering.direction as OrderDirection,
				},
			},
		] as MediaOrderBy[]
	}, [ordering])
}
