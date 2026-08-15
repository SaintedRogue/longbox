import { cn, Text } from '@longbox/components'
import { ReleaseCalendarQuery } from '@longbox/graphql'
import { BookCheck } from 'lucide-react'
import { Link } from 'react-router-dom'

import { usePaths } from '@/paths'

import { dayLabel, dayNumber, isToday, weekdayLabel } from './utils'

type CalendarDay = ReleaseCalendarQuery['releaseCalendar'][number]
type CalendarEntry = CalendarDay['entries'][number]

/**
 * One expected issue.
 *
 * "In library" is stated with an icon *and* a word rather than a colour, because a colour
 * alone is invisible to anyone who cannot distinguish it — and here it is the difference
 * between "you own this" and "this is coming".
 */
function EntryCard({ entry }: { entry: CalendarEntry }) {
	const paths = usePaths()

	return (
		<Link
			to={paths.seriesOverview(String(entry.seriesId))}
			className={cn(
				'gap-2.5 p-2 flex items-center rounded-md',
				'bg-muted/40 hover:bg-muted motion-safe:transition-colors',
				'focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
			)}
		>
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
				// Reserved rather than omitted: a missing cover must not reflow the row it is in.
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
		</Link>
	)
}

/** Weekday + date number, with today called out by a filled pill rather than a tint. */
function DayHeading({ date, count }: { date: string; count: number }) {
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

/**
 * Desktop: seven columns, one per day.
 *
 * An empty day is a faint rule rather than an empty bordered box — seven identical boxes
 * with nothing in them is most of what the old grid drew on a quiet week, and it made the
 * page read as broken rather than as calm.
 */
function WeekColumns({ days }: { days: CalendarDay[] }) {
	return (
		<div className="gap-2 lg:grid-cols-7 lg:grid hidden grid-cols-1">
			{days.map((day) => (
				<section
					key={day.date}
					aria-label={dayLabel(day.date)}
					className={cn(
						'gap-2 p-2 min-h-32 flex flex-col rounded-lg border',
						isToday(day.date) ? 'border-primary/40 bg-primary/5' : 'border-border',
					)}
				>
					<DayHeading date={day.date} count={day.entries.length} />

					{day.entries.length ? (
						<div className="gap-1.5 flex flex-col">
							{day.entries.map((entry, index) => (
								<EntryCard key={`${entry.seriesId}-${entry.number ?? ''}-${index}`} entry={entry} />
							))}
						</div>
					) : (
						<div className="flex flex-1 items-center justify-center" aria-hidden>
							<span className="w-6 h-px bg-border" />
						</div>
					)}
				</section>
			))}
		</div>
	)
}

/**
 * Mobile: an agenda of only the days that have something on them.
 *
 * The old grid collapsed to one column, which on a quiet week meant scrolling past seven
 * empty boxes to find two releases. A calendar with nothing on Tuesday does not need to
 * say so on a phone.
 */
function AgendaList({ days }: { days: CalendarDay[] }) {
	const withEntries = days.filter((day) => day.entries.length > 0)

	return (
		<div className="gap-5 lg:hidden flex flex-col">
			{withEntries.map((day) => (
				<section key={day.date} aria-label={dayLabel(day.date)} className="gap-2 flex flex-col">
					<div
						className={cn(
							'gap-2 pb-1.5 flex items-baseline border-b',
							isToday(day.date) ? 'border-primary/40' : 'border-border',
						)}
					>
						<DayHeading date={day.date} count={day.entries.length} />
					</div>

					<div className="gap-1.5 flex flex-col">
						{day.entries.map((entry, index) => (
							<EntryCard key={`${entry.seriesId}-${entry.number ?? ''}-${index}`} entry={entry} />
						))}
					</div>
				</section>
			))}
		</div>
	)
}

export default function CalendarWeek({ days }: { days: CalendarDay[] }) {
	return (
		<>
			<WeekColumns days={days} />
			<AgendaList days={days} />
		</>
	)
}

/**
 * Shaped like the real grid so paging a week doesn't change the page height. Without this
 * the layout collapses and springs back on every arrow press.
 */
export function CalendarWeekSkeleton() {
	return (
		<div className="gap-2 lg:grid-cols-7 grid grid-cols-1" aria-hidden>
			{Array.from({ length: 7 }, (_, index) => (
				<div
					key={index}
					className="gap-2 p-2 min-h-32 flex flex-col rounded-lg border border-border"
				>
					<div className="h-3 w-12 rounded motion-safe:animate-pulse bg-muted" />
					{index % 3 === 0 && (
						<div className="h-14 motion-safe:animate-pulse w-full rounded-md bg-muted" />
					)}
				</div>
			))}
		</div>
	)
}
