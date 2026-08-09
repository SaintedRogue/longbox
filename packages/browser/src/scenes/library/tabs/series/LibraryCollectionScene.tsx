import { useSDK, useSuspenseGraphQL } from '@longbox/client'
import { Heading, Link, Text } from '@longbox/components'
import { graphql } from '@longbox/graphql'
import { ArrowLeft } from 'lucide-react'
import { useParams } from 'react-router'

import BookCard from '@/components/book/BookCard'
import { DynamicCardGrid } from '@/components/container'
import GenericEmptyState from '@/components/GenericEmptyState'
import { usePaths } from '@/paths'

import pluralizeStat from '../../../../utils/pluralize'

const query = graphql(`
	query LibraryCollectionScene($id: ID!) {
		bookGroupById(id: $id) {
			id
			name
			source
			bookCount
			books {
				id
				...BookCard
			}
		}
	}
`)

/**
 * One collection's books.
 *
 * Deliberately not paginated: a collection only exists for two or more books that share a
 * series identity, so these are small by construction — the largest on the library this was
 * built for holds 22.
 */
export default function LibraryCollectionScene() {
	const { collectionId, id: libraryId } = useParams()
	const paths = usePaths()
	const { sdk } = useSDK()

	const {
		data: { bookGroupById: collection },
	} = useSuspenseGraphQL(query, sdk.cacheKey('bookGroups', [collectionId]), {
		id: collectionId ?? '',
	})

	if (!collection) {
		return (
			<div className="px-4 pt-4 flex flex-1">
				<GenericEmptyState
					title="Collection not found"
					subtitle="It may have been renamed or removed by a re-detection."
				/>
			</div>
		)
	}

	return (
		<div className="gap-4 px-4 pt-4 flex flex-1 flex-col">
			<div className="gap-1 flex flex-col">
				<Link
					to={paths.libraryCollections(libraryId ?? '')}
					underline={false}
					className="gap-1.5 text-sm flex w-fit items-center text-muted-foreground hover:text-foreground"
				>
					<ArrowLeft className="h-4 w-4" aria-hidden="true" />
					All collections
				</Link>
				<Heading size="md">{collection.name}</Heading>
				<Text size="sm" variant="muted">
					{pluralizeStat('book', collection.bookCount)} grouped by metadata. Nothing moved on disk.
				</Text>
			</div>

			<DynamicCardGrid
				count={collection.books.length}
				renderItem={(index) => {
					const book = collection.books[index]
					if (!book) return null
					return <BookCard key={book.id} fragment={book} />
				}}
			/>
		</div>
	)
}
