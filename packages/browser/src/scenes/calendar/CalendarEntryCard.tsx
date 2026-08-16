import { cn, Text } from '@longbox/components'
import { ReleaseCalendarQuery } from '@longbox/graphql'
import { BookCheck } from 'lucide-react'
import { Link } from 'react-router-dom'

import { usePaths } from '@/paths'

import FollowSeriesButton from './FollowSeriesButton'
import { dayNumber, isToday, weekdayLabel } from './utils'

export type CalendarDay = ReleaseCalendarQuery['releaseCalendar'][number]
export type CalendarEntry = CalendarDay['entries'][number]

/**
 * One expected issue. Shared by the week grid and the upcoming list, which differ in how
 * they group entries but not in what an entry *is*.
 *
 * "In library" is stated with an icon *and* a word rather than a colour, because a colour
 * alone is invisible to anyone who cannot distinguish it — and here it is the difference
 * between "you own this" and "this is coming".
 */
export default function CalendarEntryCard({ entry }: { entry: CalendarEntry }) {
	const paths = usePaths()

	const innerClassName = cn(
		'gap-2.5 p-2 min-w-0 flex flex-1 items-center rounded-md',
		'focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
	)

	const body = (
		<>
			{entry.coverUrl ? (
				<img
					src={entry.coverUrl}
					alt=""
					loading="lazy"
					width={32}
					height={48}
					className="h-12 w-8 rounded-xs shrink-0 object-cover"
				/>
			) : (
				// Reserved rather than omitted: a missing cover must not reflow the row.
				<div className="h-12 w-8 rounded-xs shrink-0 bg-muted" aria-hidden />
			)}

			<div className="min-w-0 flex-1">
				<Text size="sm" className="font-medium line-clamp-2">
					{entry.seriesName}
					{entry.number ? (
						<span className="ml-1 text-muted-foreground tabular-nums">#{entry.number}</span>
					) : null}
				</Text>

				{entry.title && (
					<Text size="xs" variant="muted" className="truncate">
						{entry.title}
					</Text>
				)}

				{entry.inLibrary && (
					<span className="gap-1 mt-0.5 flex items-center text-success">
						<BookCheck className="h-3 w-3 shrink-0" />
						<Text size="xs" className="text-success">
							In library
						</Text>
					</span>
				)}
			</div>
		</>
	)

	return (
		<div
			className={cn(
				'gap-1 pr-1 flex items-center rounded-md',
				'bg-muted/40 hover:bg-muted motion-safe:transition-colors',
			)}
		>
			{/*
			 * No series id means nothing in this library corresponds to the release. It is
			 * still a real release and still belongs on the calendar — there is just nowhere
			 * to navigate to and nothing to subscribe to, so it renders as plain content
			 * rather than as a link that would go nowhere.
			 */}
			{entry.seriesId ? (
				<Link to={paths.seriesOverview(String(entry.seriesId))} className={innerClassName}>
					{body}
				</Link>
			) : (
				<div className={innerClassName}>{body}</div>
			)}

			{entry.seriesId && (
				<FollowSeriesButton
					seriesId={String(entry.seriesId)}
					seriesName={entry.seriesName}
					isFollowed={entry.isFollowed}
				/>
			)}
		</div>
	)
}

/** Weekday + date number, with today called out by a filled pill rather than a tint. */
export function DayHeading({ date, count }: { date: string; count: number }) {
	const today = isToday(date)

	return (
		<div className="gap-2 flex items-baseline justify-between">
			<div className="gap-1.5 flex items-baseline">
				<Text size="xs" variant="muted" className="font-semibold tracking-wide uppercase">
					{weekdayLabel(date)}
				</Text>
				<span
					className={cn(
						'text-sm font-semibold tabular-nums',
						today && 'px-1.5 py-0.5 rounded-full bg-primary leading-none text-primary-foreground',
					)}
				>
					{dayNumber(date)}
				</span>
				{today && <span className="sr-only">(today)</span>}
			</div>

			{count > 0 && (
				<Text size="xs" variant="muted" className="tabular-nums">
					{count}
				</Text>
			)}
		</div>
	)
}
