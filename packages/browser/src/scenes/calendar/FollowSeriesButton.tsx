import { cn, ToolTip } from '@longbox/components'
import { Bell, BellOff } from 'lucide-react'
import { MouseEvent } from 'react'

import { useFollowSeries } from '@/hooks/useFollowSeries'

type Props = {
	seriesId: string
	seriesName: string
	isFollowed: boolean
}

/**
 * Subscribe to (or unsubscribe from) the series an entry belongs to, without leaving the
 * calendar.
 *
 * This is what makes the "all series" view useful rather than merely informational: you
 * can see something coming that you are not tracking, and start tracking it right there.
 * Before this, following was reachable only from the series page's overflow menu.
 */
export default function FollowSeriesButton({ seriesId, seriesName, isFollowed }: Props) {
	const { setFollowing, isPending } = useFollowSeries()

	const label = isFollowed
		? `Unfollow ${seriesName}`
		: `Follow ${seriesName} to add it to your pull list`

	const handleClick = (event: MouseEvent) => {
		// The whole card is a link to the series; this control sits inside it and means
		// something else entirely.
		event.preventDefault()
		event.stopPropagation()
		setFollowing(seriesId, !isFollowed)
	}

	return (
		<ToolTip content={label}>
			<button
				type="button"
				aria-label={label}
				aria-pressed={isFollowed}
				disabled={isPending}
				onClick={handleClick}
				className={cn(
					// 32px box around a 14px glyph: the icon is small, the target is not.
					'h-8 w-8 flex shrink-0 items-center justify-center rounded-md',
					'disabled:opacity-50 motion-safe:transition-colors',
					'focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
					isFollowed
						? 'text-primary hover:bg-muted'
						: 'text-muted-foreground hover:bg-muted hover:text-foreground',
				)}
			>
				{isFollowed ? (
					<Bell className="h-3.5 w-3.5 fill-current" />
				) : (
					<BellOff className="h-3.5 w-3.5" />
				)}
			</button>
		</ToolTip>
	)
}
