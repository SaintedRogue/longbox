import { useEffect, useRef, useState } from 'react'

import { StackedSeriesCard } from '@/components/series'

import pluralizeStat from '../../../../utils/pluralize'

type Thumbnail = React.ComponentProps<typeof StackedSeriesCard>['thumbnailData'][number]

type Props = {
	set: {
		key: string
		title: string
		volumeCount: number
		volumes: { id: string; thumbnail: Thumbnail }[]
	}
	isExpanded: boolean
	onToggle: () => void
}

/**
 * One omnibus set, in the same visual language as a series or a collection.
 *
 * The card is a button rather than a link because the volumes open in place: an omnibus set
 * is not a destination of its own — there is nothing on a set's "page" that isn't already on
 * the card and in the volumes underneath it. A link would mean a navigation, a back button,
 * and a lost scroll position for something that amounts to revealing two more covers.
 */
export default function OmnibusCard({ set, isExpanded, onToggle }: Props) {
	const containerRef = useRef<HTMLDivElement>(null)
	const [width, setWidth] = useState<number | null>(null)

	// Mirrors CollectionCard and LibrarySeriesCard: the stacked card lays its covers out in
	// pixels, and the grid is resizable, so it needs a measured width rather than a class.
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
					id={set.key}
					name={set.title}
					subtitle={pluralizeStat('volume', set.volumeCount)}
					isMissing={false}
					width={width}
					thumbnailData={set.volumes.slice(0, 3).map((volume) => volume.thumbnail)}
					onPress={onToggle}
					isExpanded={isExpanded}
				/>
			)}
		</div>
	)
}
