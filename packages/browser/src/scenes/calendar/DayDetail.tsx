import { Text } from '@longbox/components'

import CalendarEntryCard, { CalendarDay } from './CalendarEntryCard'
import { dayLabel } from './utils'

type Props = {
	day: CalendarDay | undefined
	date: string
	/** The whole visible month, so an empty day can point at what is actually next. */
	days: CalendarDay[]
}

/** How many upcoming entries to show when the chosen day itself is empty. */
const NEXT_UP_LIMIT = 4

/**
 * The selected day, in full.
 *
 * A month cell has room for a chip; this is where the cover, the issue title, the
 * in-library state and the subscribe control actually fit. Splitting it this way is what
 * keeps the grid a grid instead of letting it grow back into a list.
 */
export default function DayDetail({ day, date, days }: Props) {
	const entries = day?.entries ?? []
	// The server caps how many entries one day returns but always reports the true count,
	// so a busy new-comic Wednesday says how much it is not showing instead of quietly
	// looking like a short day.
	const total = day?.total ?? 0
	const trimmed = total - entries.length

	// Most days are empty, and a 320px panel saying "nothing here" is exactly the wasted
	// space this redesign is meant to remove. So an empty day answers the question the
	// reader actually has next.
	const nextUp = entries.length
		? []
		: days
				.filter((candidate) => candidate.date > date && candidate.entries.length > 0)
				.flatMap((candidate) => candidate.entries.map((entry) => ({ date: candidate.date, entry })))
				.slice(0, NEXT_UP_LIMIT)

	return (
		<aside
			aria-label={`Releases on ${dayLabel(date)}`}
			className="gap-2 p-3 min-h-0 lg:w-80 lg:flex-none flex flex-1 flex-col overflow-hidden rounded-lg border border-border bg-card"
		>
			<div className="gap-2 flex shrink-0 items-baseline justify-between">
				<Text className="font-medium">{dayLabel(date)}</Text>
				{total > 0 && (
					<Text size="xs" variant="muted" className="tabular-nums">
						{total} {total === 1 ? 'release' : 'releases'}
					</Text>
				)}
			</div>

			{entries.length ? (
				<div className="gap-1.5 min-h-0 flex flex-col overflow-y-auto">
					{entries.map((entry, index) => (
						<CalendarEntryCard
							key={`${entry.seriesId ?? entry.seriesName}-${entry.number ?? ''}-${index}`}
							entry={entry}
						/>
					))}

					{trimmed > 0 && (
						<Text size="xs" variant="muted" className="pt-1 text-center">
							{trimmed} more not shown. Followed and owned series are listed first.
						</Text>
					)}
				</div>
			) : (
				<div className="gap-2 min-h-0 flex flex-col overflow-y-auto">
					<Text size="sm" variant="muted">
						Nothing expected on this day.
					</Text>

					{nextUp.length > 0 && (
						<>
							<Text
								size="xs"
								variant="muted"
								className="pt-1 font-semibold tracking-wide uppercase"
							>
								Next up
							</Text>
							<div className="gap-1.5 flex flex-col">
								{nextUp.map(({ date: entryDate, entry }, index) => (
									<div key={`${entry.seriesId}-${index}`} className="gap-1 flex flex-col">
										<Text size="xs" variant="muted">
											{dayLabel(entryDate)}
										</Text>
										<CalendarEntryCard entry={entry} />
									</div>
								))}
							</div>
						</>
					)}
				</div>
			)}
		</aside>
	)
}
