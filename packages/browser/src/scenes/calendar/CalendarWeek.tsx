import { cn } from '@longbox/components'

import CalendarEntryCard, { CalendarDay, DayHeading } from './CalendarEntryCard'
import { dayLabel, isToday } from './utils'

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
					<DayHeading date={day.date} count={day.total} />

					{day.entries.length ? (
						<div className="gap-1.5 flex flex-col">
							{day.entries.map((entry, index) => (
								<CalendarEntryCard
									key={`${entry.seriesId}-${entry.number ?? ''}-${index}`}
									entry={entry}
								/>
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
						<DayHeading date={day.date} count={day.total} />
					</div>

					<div className="gap-1.5 flex flex-col">
						{day.entries.map((entry, index) => (
							<CalendarEntryCard
								key={`${entry.seriesId}-${entry.number ?? ''}-${index}`}
								entry={entry}
							/>
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
