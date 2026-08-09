import { useGraphQLMutation, useSDK, useSuspenseGraphQL } from '@longbox/client'
import { Button, Heading, Text } from '@longbox/components'
import { graphql, UserPermission } from '@longbox/graphql'
import { Suspense, useCallback } from 'react'

import BookCard from '@/components/book/BookCard'
import HorizontalCardList from '@/components/HorizontalCardList'
import { useAppContext } from '@/context'

const query = graphql(`
	query LibraryCollections($libraryId: ID!) {
		bookGroups(libraryId: $libraryId) {
			id
			name
			bookCount
			books {
				id
				...BookCard
			}
		}
	}
`)

const detectMutation = graphql(`
	mutation LibraryCollectionsDetect($libraryId: ID!) {
		detectBookGroups(libraryId: $libraryId) {
			groupsCreated
			groupsMatched
			groupsPruned
			booksGrouped
			booksStandalone
			booksLocked
		}
	}
`)

type Props = {
	libraryId: string
}

const noop = () => {}

/**
 * Virtual shelves for books that sit loose in the library root.
 *
 * These are not series -- nothing moved on disk and no folder exists for them. They are
 * shown above the series grid so a library whose root holds a pile of loose books reads
 * as collections plus standalone works, rather than as one junk series.
 */
export default function LibraryCollections({ libraryId }: Props) {
	return (
		<Suspense fallback={null}>
			<Collections libraryId={libraryId} />
		</Suspense>
	)
}

function Collections({ libraryId }: Props) {
	const { sdk } = useSDK()
	const { checkPermission } = useAppContext()

	const {
		data: { bookGroups },
		refetch,
	} = useSuspenseGraphQL(query, sdk.cacheKey('bookGroups', [libraryId]), {
		libraryId,
	})

	const { mutate: detect, isPending } = useGraphQLMutation(detectMutation, {
		onSuccess: () => refetch(),
	})

	const handleDetect = useCallback(() => detect({ libraryId }), [detect, libraryId])

	const canDetect = checkPermission(UserPermission.ScanLibrary)

	// Nothing to show and nothing the user could do about it.
	if (!bookGroups.length && !canDetect) {
		return null
	}

	return (
		<div className="gap-4 px-4 pt-4 flex flex-col">
			<div className="gap-2 flex flex-wrap items-center justify-between">
				<div>
					<Heading size="sm">Collections</Heading>
					<Text size="sm" variant="muted">
						Books grouped by their metadata. Nothing moves on disk.
					</Text>
				</div>
				{canDetect && (
					<Button variant="secondary" size="sm" onClick={handleDetect} disabled={isPending}>
						{isPending ? 'Detecting…' : 'Detect collections'}
					</Button>
				)}
			</div>

			{!bookGroups.length && (
				<Text size="sm" variant="muted">
					No collections yet. Detection groups loose books that share a series, and leaves genuinely
					standalone books alone.
				</Text>
			)}

			{bookGroups.map((group) => (
				<HorizontalCardList
					key={group.id}
					title={`${group.name} (${group.bookCount})`}
					items={group.books.map((book) => (
						<BookCard key={book.id} fragment={book} fullWidth={false} />
					))}
					// A collection only exists for books already loaded with it, so the whole
					// shelf is on screen and there is nothing further to page in.
					onFetchMore={noop}
				/>
			))}
		</div>
	)
}
