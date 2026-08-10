import { useGraphQL } from '@longbox/client'
import { usePrevious } from '@longbox/components'
import { graphql } from '@longbox/graphql'
import { useEffect } from 'react'
import { Helmet } from 'react-helmet'

import { DynamicCardGrid } from '@/components/container'
import { Search } from '@/components/filters'
import { useURLKeywordSearch, useURLPageParams } from '@/components/filters/useFilterScene'
import GenericEmptyState from '@/components/GenericEmptyState'
import LibraryCard from '@/components/library/LibraryCard'
import Pagination from '@/components/Pagination'

/**
 * `libraries` takes a `search` argument directly rather than a filter DSL, so
 * this follows `CharactersScene`'s shape rather than the filter-driven browse
 * scenes. Grid only, deliberately: a server has a handful of libraries, not
 * thousands, so a table with column configuration would be machinery without a
 * use.
 */
const query = graphql(`
	query LibrarySearchScene($search: String, $pagination: Pagination!) {
		libraries(search: $search, pagination: $pagination) {
			nodes {
				id
				...LibraryCard
			}
			pageInfo {
				__typename
				... on OffsetPaginationInfo {
					currentPage
					totalPages
				}
			}
		}
	}
`)

function getQueryKey(page: number, pageSize: number, search: string | undefined) {
	return ['librarySearchScene', { page, pageSize, search }]
}

export default function LibrarySearchScene() {
	const { page, pageSize, setPage } = useURLPageParams()
	const { search, setSearch } = useURLKeywordSearch()

	// Guarded rather than a bare inequality: `''` is not nullish, so an absent
	// search would read as a change on first render and reset a deep-linked page.
	const previousSearch = usePrevious(search)
	const differentSearch = previousSearch != null && previousSearch !== search
	useEffect(() => {
		if (differentSearch) {
			setPage(1)
		}
	}, [differentSearch, setPage])

	const { data, isLoading } = useGraphQL(query, getQueryKey(page, pageSize, search), {
		search: search || undefined,
		pagination: {
			offset: {
				page,
				pageSize,
			},
		},
	})

	const nodes = data?.libraries.nodes || []
	const pageInfo = data?.libraries.pageInfo

	const currentPage = pageInfo?.__typename === 'OffsetPaginationInfo' ? pageInfo.currentPage : page
	const totalPages = pageInfo?.__typename === 'OffsetPaginationInfo' ? pageInfo.totalPages : 1

	return (
		<div className="pb-4 md:pb-0 flex flex-1 flex-col">
			<Helmet>
				<title>Longbox | Libraries</title>
			</Helmet>

			<div className="gap-4 p-4 flex items-center justify-between">
				<Search
					initialValue={search}
					placeholder="Search libraries"
					onChange={setSearch}
					isLoading={isLoading}
				/>
			</div>

			<div className="px-4 flex flex-1">
				{!!nodes.length && (
					<DynamicCardGrid
						count={nodes.length}
						renderItem={(index) => <LibraryCard key={nodes[index]!.id} fragment={nodes[index]!} />}
					/>
				)}
				{!nodes.length && !isLoading && (
					<div className="col-span-full grid flex-1 place-self-center">
						<GenericEmptyState
							title={search ? 'No libraries match your search' : "You don't have any libraries yet"}
							subtitle={
								search
									? 'Try a different search term'
									: 'Create a library to start scanning your collection'
							}
						/>
					</div>
				)}
			</div>

			{totalPages > 1 && (
				<div className="p-4">
					<Pagination
						position="bottom"
						pages={totalPages}
						currentPage={currentPage}
						onChangePage={setPage}
					/>
				</div>
			)}
		</div>
	)
}
