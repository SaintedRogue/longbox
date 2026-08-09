import { useGraphQLMutation, useSDK, useSuspenseGraphQL } from '@longbox/client'
import { Button, Text } from '@longbox/components'
import { graphql, UserPermission } from '@longbox/graphql'
import { useCallback, useEffect, useRef, useState } from 'react'

import { DynamicCardGrid } from '@/components/container'
import GenericEmptyState from '@/components/GenericEmptyState'
import { StackedSeriesCard } from '@/components/series'
import { useAppContext } from '@/context'
import { usePaths } from '@/paths'

import pluralizeStat from '../../../../utils/pluralize'

const query = graphql(`
	query LibraryCollections($libraryId: ID!) {
		bookGroups(libraryId: $libraryId) {
			id
			name
			bookCount
			books {
				id
				thumbnail {
					url
					metadata {
						averageColor
						colors {
							color
							percentage
						}
						thumbhash
					}
				}
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
		}
	}
`)

type Props = {
	libraryId: string
}

/**
 * Collections shown in the same grid, with the same card, as series.
 *
 * A collection is a shelf of books exactly like a series is; it just isn't backed by a
 * folder. Rendering it in the series visual language rather than as its own carousel row is
 * the whole point — an earlier version stacked one horizontal list per collection above the
 * grid, which pushed the series list ~4,700px down the page and made every page of the
 * paginated grid look identical.
 */
export default function LibraryCollections({ libraryId }: Props) {
	const { sdk } = useSDK()
	const { checkPermission } = useAppContext()

	const {
		data: { bookGroups },
		refetch,
	} = useSuspenseGraphQL(query, sdk.cacheKey('bookGroups', [libraryId]), { libraryId })

	const { mutate: detect, isPending } = useGraphQLMutation(detectMutation, {
		onSuccess: () => refetch(),
	})

	const handleDetect = useCallback(() => detect({ libraryId }), [detect, libraryId])
	const canDetect = checkPermission(UserPermission.ScanLibrary)

	if (!bookGroups.length) {
		return (
			<div className="px-4 pt-4 flex flex-1">
				<div className="gap-4 col-span-full flex flex-1 flex-col items-center place-self-center">
					<GenericEmptyState
						title="No collections yet"
						subtitle="Detection groups books that share a series but not a folder, and leaves genuinely standalone books alone."
					/>
					{canDetect && (
						<Button variant="secondary" onClick={handleDetect} disabled={isPending}>
							{isPending ? 'Detecting…' : 'Detect collections'}
						</Button>
					)}
				</div>
			</div>
		)
	}

	return (
		<div className="gap-4 px-4 pt-4 flex flex-1 flex-col">
			<div className="gap-2 flex flex-wrap items-center justify-between">
				<Text size="sm" variant="muted">
					{pluralizeStat('collection', bookGroups.length)} grouped by metadata. Nothing moves on
					disk.
				</Text>
				{canDetect && (
					<Button variant="secondary" size="sm" onClick={handleDetect} disabled={isPending}>
						{isPending ? 'Detecting…' : 'Re-detect'}
					</Button>
				)}
			</div>

			<DynamicCardGrid
				count={bookGroups.length}
				renderItem={(index) => {
					const group = bookGroups[index]
					if (!group) return null
					return <CollectionCard key={group.id} group={group} libraryId={libraryId} />
				}}
			/>
		</div>
	)
}

type CollectionCardProps = {
	libraryId: string
	group: {
		id: string
		name: string
		bookCount: number
		books: {
			id: string
			thumbnail: React.ComponentProps<typeof StackedSeriesCard>['thumbnailData'][number]
		}[]
	}
}

function CollectionCard({ group, libraryId }: CollectionCardProps) {
	const paths = usePaths()
	const containerRef = useRef<HTMLDivElement>(null)
	const [width, setWidth] = useState<number | null>(null)

	// Mirrors LibrarySeriesCard: the stacked card needs a pixel width and the grid is resizable.
	useEffect(() => {
		if (!containerRef.current) return
		const observer = new ResizeObserver((entries) => {
			const entry = entries[0]
			if (entry) setWidth(entry.contentRect.width)
		})
		observer.observe(containerRef.current)
		setWidth(containerRef.current.offsetWidth)
		return () => observer.disconnect()
	}, [])

	return (
		<div ref={containerRef}>
			{width != null && (
				<StackedSeriesCard
					id={group.id}
					name={group.name}
					subtitle={pluralizeStat('book', group.bookCount)}
					isMissing={false}
					width={width}
					thumbnailData={group.books.slice(0, 3).map((book) => book.thumbnail)}
					to={paths.libraryCollection(libraryId, group.id)}
					disablePrefetch
				/>
			)}
		</div>
	)
}
