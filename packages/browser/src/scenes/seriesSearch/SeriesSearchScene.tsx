import { PREFETCH_STALE_TIME, useGraphQL, useSDK } from '@longbox/client'
import { usePrevious } from '@longbox/components'
import {
	graphql,
	InterfaceLayout,
	OrderDirection,
	SeriesFilterInput,
	SeriesModelOrdering,
	SeriesOrderBy,
} from '@longbox/graphql'
import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Helmet } from 'react-helmet'
import { useShallow } from 'zustand/react/shallow'

import { DynamicCardGrid, GridSizeSlider } from '@/components/container'
import {
	FilterContext,
	FilterHeader,
	URLFilterContainer,
	URLFilterDrawer,
	URLOrdering,
	useFilterScene,
} from '@/components/filters'
import { Ordering } from '@/components/filters/context'
import {
	DEFAULT_SERIES_ORDER_BY,
	useURLKeywordSearch,
	useURLPageParams,
} from '@/components/filters/useFilterScene'
import GenericEmptyState from '@/components/GenericEmptyState'
import { LibrarySeriesCard, SeriesTable } from '@/components/series'
import { EntityTableColumnConfiguration } from '@/components/table'
import TableOrGridLayout from '@/components/TableOrGridLayout'
import useIsInView from '@/hooks/useIsInView'
import { usePreferences } from '@/hooks/usePreferences'
import { useSeriesLayout } from '@/stores/layout'

import SeriesAlphabet, { usePrefetchSeriesAlphabet } from './SeriesAlphabet'

const LAYOUT_KEY = 'series-search'

const query = graphql(`
	query SeriesSearchScene(
		$filter: SeriesFilterInput!
		$search: String
		$orderBy: [SeriesOrderBy!]!
		$pagination: Pagination!
	) {
		series(filter: $filter, search: $search, orderBy: $orderBy, pagination: $pagination) {
			nodes {
				id
				# Selected flat as well as via the fragment: fragment masking hides these
				# from the query result, and the table view reads them directly.
				resolvedName
				mediaCount
				percentageCompleted
				status
				...SeriesGridCard
			}
			pageInfo {
				__typename
				... on OffsetPaginationInfo {
					totalPages
					currentPage
					pageSize
					pageOffset
					zeroBased
				}
			}
		}
	}
`)

export type UsePrefetchSeriesSearchParams = {
	page?: number
	pageSize?: number
	filter?: SeriesFilterInput[]
	orderBy: SeriesOrderBy[]
}

function getQueryKey(
	page: number,
	pageSize: number,
	search: string | undefined,
	filters: SeriesFilterInput[] | undefined,
	orderBy: SeriesOrderBy[] | undefined,
) {
	return ['seriesSearch', { page, pageSize, search, filters, orderBy }]
}

export const usePrefetchSeriesSearch = () => {
	const { sdk } = useSDK()
	const client = useQueryClient()
	const { pageSize } = useURLPageParams()
	const { search } = useURLKeywordSearch()
	const prefetchAlphabet = usePrefetchSeriesAlphabet()

	return useCallback(
		(params: UsePrefetchSeriesSearchParams = { filter: [], orderBy: DEFAULT_SERIES_ORDER_BY }) => {
			const pageParams = { page: params.page || 1, pageSize: params.pageSize || pageSize }
			return Promise.all([
				client.prefetchQuery({
					queryKey: getQueryKey(
						pageParams.page,
						pageParams.pageSize,
						search,
						params.filter,
						params.orderBy,
					),
					queryFn: async () => {
						const response = await sdk.execute(query, {
							filter: {
								_and: params.filter,
							},
							search,
							orderBy: params.orderBy,
							pagination: {
								offset: {
									...pageParams,
								},
							},
						})
						return response
					},
					staleTime: PREFETCH_STALE_TIME,
				}),
				prefetchAlphabet(),
			])
		},
		[client, pageSize, search, sdk, prefetchAlphabet],
	)
}

function useSeriesURLOrderBy(ordering: Ordering): SeriesOrderBy[] {
	return useMemo(() => {
		if (!ordering || !ordering.orderBy || !ordering.direction) {
			return DEFAULT_SERIES_ORDER_BY
		}

		return [
			{
				series: {
					field: ordering.orderBy as SeriesModelOrdering,
					direction: ordering.direction as OrderDirection,
				},
			},
		] as SeriesOrderBy[]
	}, [ordering])
}

/**
 * Every series on the server, across libraries.
 *
 * Adapted from `LibrarySeriesScene` without the library scoping, the collections
 * toggle (collections belong to a library) or `useRememberBrowsePosition` -- this
 * is the top of the hierarchy, so there is no "up" to return to.
 */
export default function SeriesSearchScene() {
	const {
		filters: seriesFilters,
		ordering,
		pagination: { page, pageSize: pageSizeMaybeUndefined },
		setPage,
		...rest
	} = useFilterScene()
	const pageSize = pageSizeMaybeUndefined || 20
	const filters = seriesFilters as SeriesFilterInput
	const orderBy = useSeriesURLOrderBy(ordering)
	const { search } = useURLKeywordSearch()

	// Guarded rather than a bare inequality: `''` is not nullish, so on first
	// render an absent search reads as a change and would snap a deep-linked
	// `?page=5` back to page 1.
	const previous = usePrevious(search)
	const differentSearch = previous != null && search !== previous
	useEffect(() => {
		if (differentSearch) {
			setPage(1)
		}
	}, [differentSearch, setPage])

	const [startsWith, setStartsWith] = useState<string | undefined>(undefined)
	const onSelectLetter = useCallback(
		(letter?: string) => {
			setStartsWith(letter)
			setPage(1)
		},
		[setPage],
	)

	const {
		preferences: { enableAlphabetSelect },
	} = usePreferences()

	const resolvedFilters = useMemo(
		() => [
			filters,
			...(startsWith
				? [
						{
							_or: [{ name: { startsWith } }, { metadata: { title: { startsWith } } }],
						},
					]
				: []),
		],
		[filters, startsWith],
	)

	const prefetch = usePrefetchSeriesSearch()

	const onPrefetchLetter = useCallback(
		(letter: string) => {
			prefetch({
				page: 1,
				pageSize,
				filter: [
					filters,
					{
						_or: [
							{ name: { startsWith: letter } },
							{ metadata: { title: { startsWith: letter } } },
						],
					},
				],
				orderBy,
			})
		},
		[prefetch, pageSize, orderBy, filters],
	)

	const { layoutMode, setLayout, columns, setColumns } = useSeriesLayout(
		LAYOUT_KEY,
		useShallow((state) => ({
			columns: state.columns,
			layoutMode: state.layout,
			setColumns: state.setColumns,
			setLayout: state.setLayout,
		})),
	)

	const { data, isLoading } = useGraphQL(
		query,
		getQueryKey(page, pageSize, search, resolvedFilters, orderBy),
		{
			filter: {
				_and: resolvedFilters,
			},
			search,
			orderBy,
			pagination: {
				offset: {
					page,
					pageSize,
				},
			},
		},
	)

	// Memoised rather than `data?.series.nodes || []`: the fallback allocates a
	// fresh array on every render, so `duplicateNames` below would recompute each
	// time and hand every card a new `Set`.
	const nodes = useMemo(() => data?.series.nodes ?? [], [data])
	const pageInfo = data?.series.pageInfo || {
		__typename: 'OffsetPaginationInfo',
		totalPages: 1,
		currentPage: 1,
		pageSize: pageSize,
		pageOffset: (page - 1) * pageSize,
		zeroBased: false,
	}

	// Series are named after their leaf directory, so `Marvel/Hulk` and `DC/Hulk`
	// are both "Hulk". Only the names that actually collide on this page get their
	// library appended -- flagging every card would be noise, since collisions are
	// rare. Collisions split across two pages go unflagged; catching those needs a
	// server-side count of series sharing a name.
	const duplicateNames = useMemo(() => {
		const counts = new Map<string, number>()
		for (const node of nodes) {
			counts.set(node.resolvedName, (counts.get(node.resolvedName) ?? 0) + 1)
		}
		return new Set([...counts.entries()].filter(([, count]) => count > 1).map(([name]) => name))
	}, [nodes])

	const [containerRef, isInView] = useIsInView<HTMLDivElement>()

	if (pageInfo.__typename !== 'OffsetPaginationInfo') {
		throw new Error('Invalid pagination type, expected OffsetPaginationInfo')
	}

	const previousPage = usePrevious(pageInfo.currentPage)
	const shouldScroll = !!previousPage && previousPage !== pageInfo.currentPage
	useEffect(() => {
		if (!isInView && shouldScroll) {
			containerRef.current?.scrollIntoView({
				behavior: 'smooth',
				block: 'nearest',
				inline: 'start',
			})
		}
	}, [shouldScroll, isInView, containerRef])

	const hasFilters = Object.keys(filters || {}).length > 0 || !!search

	const renderContent = () => {
		if (layoutMode === InterfaceLayout.Grid) {
			return (
				<URLFilterContainer
					currentPage={pageInfo.currentPage || 1}
					pages={pageInfo.totalPages || 1}
					onChangePage={setPage}
					onPrefetchPage={(page) => {
						prefetch({
							page,
							pageSize,
							filter: resolvedFilters,
							orderBy,
						})
					}}
				>
					<div className="px-4 pt-4 flex flex-1">
						{!!nodes.length && (
							<DynamicCardGrid
								count={nodes.length}
								renderItem={(index) => (
									<LibrarySeriesCard
										key={nodes[index]!.id}
										fragment={nodes[index]!}
										showLibraryBadge={duplicateNames.has(nodes[index]!.resolvedName)}
									/>
								)}
							/>
						)}
						{!nodes.length && !isLoading && (
							<div className="col-span-full grid flex-1 place-self-center">
								<GenericEmptyState
									title={
										hasFilters
											? 'No series match your search'
											: "It doesn't look like there are any series here"
									}
									subtitle={
										hasFilters
											? 'Try removing some filters to see more series'
											: 'Do you have any libraries scanned yet?'
									}
								/>
							</div>
						)}
					</div>
				</URLFilterContainer>
			)
		}

		return (
			<SeriesTable
				layoutKey={LAYOUT_KEY}
				items={nodes || []}
				render={(props) => (
					<URLFilterContainer
						currentPage={pageInfo.currentPage || 1}
						pages={pageInfo.totalPages || 1}
						onChangePage={setPage}
						onPrefetchPage={(page) => {
							prefetch({
								page,
								pageSize,
								filter: resolvedFilters,
								orderBy,
							})
						}}
						tableControls={
							<EntityTableColumnConfiguration
								entity="series"
								configuration={columns || []}
								onSave={setColumns}
							/>
						}
						{...props}
					/>
				)}
			/>
		)
	}

	return (
		<FilterContext.Provider
			value={{
				filters,
				ordering,
				pagination: { page, pageSize },
				setPage,
				...rest,
			}}
		>
			<div className="pb-4 md:pb-0 flex flex-1 flex-col">
				<Helmet>
					<title>Longbox | Series</title>
				</Helmet>

				<section ref={containerRef} id="grid-top-indicator" className="h-0" />

				<FilterHeader
					isSearching={isLoading}
					layoutControls={<TableOrGridLayout layout={layoutMode} setLayout={setLayout} />}
					orderControls={<URLOrdering entity="series" />}
					sizeControls={layoutMode === InterfaceLayout.Grid ? <GridSizeSlider /> : undefined}
					filterControls={<URLFilterDrawer entity="series" />}
				/>

				{enableAlphabetSelect && (
					<SeriesAlphabet
						startsWith={startsWith}
						onSelectLetter={onSelectLetter}
						onPrefetchLetter={onPrefetchLetter}
					/>
				)}

				{renderContent()}
			</div>
		</FilterContext.Provider>
	)
}
