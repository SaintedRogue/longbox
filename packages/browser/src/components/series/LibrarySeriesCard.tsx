import { FragmentType, graphql, useFragment } from '@longbox/graphql'
import { memo, useEffect, useRef, useState } from 'react'

import { StackedSeriesCard } from '@/components/series'

import pluralizeStat from '../../utils/pluralize'

/**
 * Extracted so the library-scoped and global series scenes render the same card
 * from the same selection. It previously read its shape straight off
 * `LibrarySeriesQuery`, which is exactly why a second query could not reuse it.
 *
 * `library` is selected here rather than by the caller because
 * `showLibraryBadge` needs it, and a series always has one.
 */
export const SeriesGridCardFragment = graphql(`
	fragment SeriesGridCard on Series {
		id
		resolvedName
		mediaCount
		percentageCompleted
		status
		# We fetch 2 and skip 1 because the first thumbnail _might_ be the same as the series thumbnail.
		# See https://github.com/stumpapp/stump/issues/899
		media(take: 2, skip: 1) {
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
		library {
			id
			name
		}
	}
`)

type Props = {
	fragment: FragmentType<typeof SeriesGridCardFragment>
	/**
	 * Append the owning library to the subtitle.
	 *
	 * Series are named after their leaf directory, so `Marvel/Hulk` and `DC/Hulk`
	 * are two rows both called "Hulk". Callers turn this on only for names that
	 * actually collide in the current result set - showing it unconditionally
	 * would add noise to the overwhelmingly common unique case.
	 */
	showLibraryBadge?: boolean
}

const LibrarySeriesCard = memo(function LibrarySeriesCard({
	fragment,
	showLibraryBadge = false,
}: Props) {
	const data = useFragment(SeriesGridCardFragment, fragment)
	const containerRef = useRef<HTMLDivElement>(null)
	const [width, setWidth] = useState<number | null>(null)

	// The cards in the traversal bits of the web app are resizable (to an extent), and so providing
	// a width to the stacked thumb component is a bit annoying. This should DEFINITELY be rethought, though,
	// because a resize observer for every card is probably not great for performance. Part of the problem
	// is that I mostly just copy/pasted the stacked series layouts but should maybe try positioning them with
	// css and percentages instead
	useEffect(() => {
		if (!containerRef.current) return

		const observer = new ResizeObserver((entries) => {
			const entry = entries[0]
			if (entry) {
				setWidth(entry.contentRect.width)
			}
		})

		observer.observe(containerRef.current)
		setWidth(containerRef.current.offsetWidth)

		return () => observer.disconnect()
	}, [])

	const thumbnailData = [data.thumbnail, ...data.media.map((m) => m.thumbnail)]
	const bookCount = pluralizeStat('book', data.mediaCount)
	const subtitle =
		showLibraryBadge && data.library ? `${bookCount} · ${data.library.name}` : bookCount

	return (
		<div ref={containerRef}>
			{width != null && (
				<StackedSeriesCard
					id={data.id}
					name={data.resolvedName}
					subtitle={subtitle}
					isMissing={data.status === 'MISSING'}
					width={width}
					thumbnailData={thumbnailData}
				/>
			)}
		</div>
	)
})

export default LibrarySeriesCard
