import { useGraphQL } from '@longbox/client'
import { usePrevious } from '@longbox/components'
import { graphql } from '@longbox/graphql'
import { useEffect } from 'react'
import { Helmet } from 'react-helmet'

import { DynamicCardGrid } from '@/components/container'
import { Search } from '@/components/filters'
import { useURLKeywordSearch, useURLPageParams } from '@/components/filters/useFilterScene'
import GenericEmptyState from '@/components/GenericEmptyState'
import Pagination from '@/components/Pagination'

import CharacterCard from './CharacterCard'
import CharacterOrderSelect, {
	CharacterOrderOption,
	useURLCharacterOrdering,
} from './CharacterOrderSelect'

const query = graphql(`
	query CharactersScene($search: String, $orderBy: [CharacterOrderBy!]!, $pagination: Pagination!) {
		characters(search: $search, orderBy: $orderBy, pagination: $pagination) {
			nodes {
				name
				...CharacterCard
			}
			pageInfo {
				__typename
				... on OffsetPaginationInfo {
					currentPage
					totalPages
					pageSize
					pageOffset
					zeroBased
				}
			}
		}
	}
`)

function getQueryKey(
	page: number,
	pageSize: number,
	search: string | undefined,
	order: CharacterOrderOption,
) {
	return ['charactersScene', { order, page, pageSize, search }]
}

export default function CharactersScene() {
	const { page, pageSize, setPage } = useURLPageParams()
	const { search, setSearch } = useURLKeywordSearch()
	const { order, orderBy, setOrder } = useURLCharacterOrdering()

	const previousSearch = usePrevious(search)
	const differentSearch = previousSearch != null && previousSearch !== search
	useEffect(() => {
		if (differentSearch) {
			setPage(1)
		}
	}, [differentSearch, setPage])

	const { data, isLoading } = useGraphQL(query, getQueryKey(page, pageSize, search, order), {
		search: search || undefined,
		orderBy,
		pagination: {
			offset: {
				page,
				pageSize,
			},
		},
	})

	const nodes = data?.characters.nodes || []
	const pageInfo = data?.characters.pageInfo

	const currentPage = pageInfo?.__typename === 'OffsetPaginationInfo' ? pageInfo.currentPage : page
	const totalPages = pageInfo?.__typename === 'OffsetPaginationInfo' ? pageInfo.totalPages : 1

	return (
		<div className="pb-4 md:pb-0 flex flex-1 flex-col">
			<Helmet>
				<title>Longbox | Characters</title>
			</Helmet>

			<div className="gap-4 p-4 flex items-center justify-between">
				<Search
					initialValue={search}
					placeholder="Search characters"
					onChange={setSearch}
					isLoading={isLoading}
				/>

				<CharacterOrderSelect value={order} onChange={setOrder} />
			</div>

			<div className="px-4 flex flex-1">
				{!!nodes.length && (
					<DynamicCardGrid
						count={nodes.length}
						renderItem={(index) => (
							<CharacterCard key={nodes[index]!.name} fragment={nodes[index]!} />
						)}
					/>
				)}
				{!nodes.length && !isLoading && (
					<div className="col-span-full grid flex-1 place-self-center">
						<GenericEmptyState
							title={
								search
									? 'No characters match your search'
									: "It doesn't look like there are any characters here"
							}
							subtitle={
								search
									? 'Try a different search term'
									: 'Characters are populated from comic metadata as your library is scanned and matched'
							}
						/>
					</div>
				)}
			</div>

			{totalPages > 1 && (
				<Pagination
					position="bottom"
					pages={totalPages}
					currentPage={currentPage}
					onChangePage={setPage}
				/>
			)}
		</div>
	)
}
