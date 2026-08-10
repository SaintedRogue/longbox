import { useSDK } from '@longbox/client'
import { FragmentType, graphql, useFragment } from '@longbox/graphql'
import pluralize from 'pluralize'
import { memo } from 'react'

import EntityCard from '@/components/entity/EntityCard'
import { usePaths } from '@/paths'

/**
 * A library has a single thumbnail rather than a stack of book covers, so this
 * builds on `EntityCard` (as `SeriesCard` does) rather than `StackedSeriesCard`.
 */
export const LibraryCardFragment = graphql(`
	fragment LibraryCard on Library {
		id
		name
		emoji
		stats {
			seriesCount
			bookCount
		}
	}
`)

type Props = {
	fragment: FragmentType<typeof LibraryCardFragment>
}

const LibraryCard = memo(function LibraryCard({ fragment }: Props) {
	const data = useFragment(LibraryCardFragment, fragment)
	const { sdk } = useSDK()
	const paths = usePaths()

	const { seriesCount, bookCount } = data.stats
	const subtitle = `${seriesCount} ${pluralize('series', seriesCount)} · ${bookCount} ${pluralize(
		'book',
		bookCount,
	)}`

	return (
		<EntityCard
			title={data.emoji ? `${data.emoji} ${data.name}` : data.name}
			subtitle={subtitle}
			href={paths.librarySeries(data.id)}
			imageUrl={sdk.library.thumbnailURL(data.id)}
		/>
	)
})

export default LibraryCard
