import { useInfiniteGraphQL } from '@longbox/client'
import { Input } from '@longbox/components'
import { BookCardFragment, graphql } from '@longbox/graphql'
import { useState } from 'react'
import { useDebouncedValue } from 'rooks'

import { VirtualizedCardGrid } from '../container/DynamicCardGrid'
import Spinner from '../Spinner'
import BookCard from './BookCard'

type Props = {
	onBookSelect?: (book: BookCardFragment) => void
}

// TODO(bookclub): Refactor this component

const query = graphql(`
	query BookSearchOverlay($pagination: Pagination, $search: String) {
		media(pagination: $pagination, search: $search) {
			nodes {
				id
				...BookCard
			}
			pageInfo {
				__typename
				... on CursorPaginationInfo {
					currentCursor
					nextCursor
					limit
				}
			}
		}
	}
`)

/**
 *  A component that renders a paginated grid of books with a search bar and (optionally)
 *  a filter slide over. Must be used within a `FilterProvider`.
 */
export default function BookSearch({ onBookSelect }: Props) {
	const [search, setSearch] = useState('')
	const [debouncedValue] = useDebouncedValue(search, 500)

	// Local state rather than the URL, deliberately: this is a transient picker
	// opened from a modal, so putting its term in the URL would leave history
	// entries behind for a search the user never navigated to.
	const { data, isLoading, fetchNextPage } = useInfiniteGraphQL(
		query,
		['bookOverlay', debouncedValue],
		{
			search: debouncedValue,
		},
		{
			enabled: !!debouncedValue,
		},
	)

	const books = data?.pages.flatMap((page) => page.media.nodes) || []

	return (
		<div className="gap-y-4 flex flex-1 flex-col">
			<Input
				placeholder="Search for a book..."
				value={search}
				onChange={(e) => setSearch(e.target.value)}
			/>

			{isLoading && (
				<div className="flex flex-1 items-center justify-center">
					<Spinner />
				</div>
			)}

			<VirtualizedCardGrid
				count={books.length}
				renderItem={(index) => (
					<BookCard
						key={books[index]!.id}
						fragment={books[index]!}
						onSelect={() => onBookSelect?.(books[index]! as BookCardFragment)}
					/>
				)}
				onEndReached={fetchNextPage}
			/>
		</div>
	)
}
