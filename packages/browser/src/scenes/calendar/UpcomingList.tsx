import { cn, Text } from '@longbox/components'

import CalendarEntryCard, { CalendarDay, DayHeading } from './CalendarEntryCard'
import { dayLabel, isToday, monthLabel } from './utils'

/**
 * Everything coming, grouped by day.
 *
 * Not a grid at any width: this answers "what's next" rather than "what does this week
 * look like", and a run of empty dates carries no information in that framing. The server
 * only returns days that have something on them.
 */
export default function UpcomingList({ days }: { days: CalendarDay[] }) {
	return (
		<div className="gap-5 flex flex-col">
			{days.map((day, index) => {
				const month = monthLabel(day.date)
				// A heading only where the month actually turns over, so a long list stays
				// orientable without repeating the same word above every group. Derived by
				// looking back at the previous day rather than by carrying a running value:
				// mutating across iterations is exactly what react-compiler rejects, and the
				// lookback is pure.
				const previous = index > 0 ? days[index - 1] : undefined
				const showMonth = !previous || month !== monthLabel(previous.date)

				return (
					<div key={day.date} className="gap-2 flex flex-col">
						{showMonth && (
							<Text
								size="xs"
								variant="muted"
								className="mt-2 font-semibold tracking-wide first:mt-0 uppercase"
							>
								{month}
							</Text>
						)}

						<section aria-label={dayLabel(day.date)} className="gap-2 flex flex-col">
							<div
								className={cn(
									'gap-2 pb-1.5 flex items-baseline border-b',
									isToday(day.date) ? 'border-primary/40' : 'border-border',
								)}
							>
								<DayHeading date={day.date} count={day.total} />
							</div>

							<div className="gap-1.5 sm:grid-cols-2 xl:grid-cols-3 grid grid-cols-1">
								{day.entries.map((entry, index) => (
									<CalendarEntryCard
										key={`${entry.seriesId}-${entry.number ?? ''}-${index}`}
										entry={entry}
									/>
								))}
							</div>
						</section>
					</div>
				)
			})}
		</div>
	)
}

/** Matches the list's rhythm, so switching views doesn't jump the page height. */
export function UpcomingListSkeleton() {
	return (
		<div className="gap-5 flex flex-col" aria-hidden>
			{Array.from({ length: 3 }, (_, group) => (
				<div key={group} className="gap-2 flex flex-col">
					<div className="h-3 w-24 rounded motion-safe:animate-pulse bg-muted" />
					<div className="gap-1.5 sm:grid-cols-2 xl:grid-cols-3 grid grid-cols-1">
						{Array.from({ length: 2 }, (_, card) => (
							<div key={card} className="h-16 motion-safe:animate-pulse rounded-md bg-muted" />
						))}
					</div>
				</div>
			))}
		</div>
	)
}
