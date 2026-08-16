import { cn, Text } from '@longbox/components'

import { CalendarDay, CalendarEntry } from './CalendarEntryCard'
import { DAY_LABELS, dayNumber, isSameMonth, isToday } from './utils'

type Props = {
	days: CalendarDay[]
	/** ISO `YYYY-MM-01` of the month being shown; cells outside it are padding. */
	monthStart: string
	selectedDate: string | null
	onSelectDate: (date: string) => void
}

/** How many chips a cell shows before collapsing the rest into a count. */
const MAX_CHIPS = 3

/**
 * One release inside a month cell.
 *
 * A single line, because a month cell has room for about one line — the detail lives in
 * the day panel. The cover is a 16px sliver rather than a thumbnail: at this size it reads
 * as a colour cue that distinguishes one series from another at a glance, which is all a
 * chip needs to do.
 */
function EntryChip({ entry }: { entry: CalendarEntry }) {
	return (
		<div
			className={cn(
				'gap-1.5 px-1 py-0.5 flex w-full items-center rounded-sm',
				'bg-muted/60 motion-safe:transition-colors',
				entry.inLibrary && 'bg-success/10',
			)}
			title={`${entry.seriesName}${entry.number ? ` #${entry.number}` : ''}`}
		>
			{entry.coverUrl ? (
				<img
					src={entry.coverUrl}
					alt=""
					loading="lazy"
					width={12}
					height={16}
					className="h-4 w-3 rounded-xs shrink-0 object-cover"
				/>
			) : (
				<span
					className={cn(
						'h-1.5 w-1.5 shrink-0 rounded-full',
						entry.inLibrary ? 'bg-success' : 'bg-primary',
					)}
					aria-hidden
				/>
			)}

			<span className="min-w-0 text-xs flex-1 truncate text-foreground">
				{entry.seriesName}
				{entry.number ? (
					<span className="ml-0.5 text-muted-foreground tabular-nums">#{entry.number}</span>
				) : null}
			</span>
		</div>
	)
}

/**
 * The month, drawn the way a calendar draws one.
 *
 * The grid claims the remaining viewport height rather than sizing to its content: a
 * calendar that occupies the top third of a monitor and leaves the rest blank is the main
 * thing that made the old week view feel like a list wearing a grid's clothes.
 */
export default function CalendarMonthGrid({ days, monthStart, selectedDate, onSelectDate }: Props) {
	return (
		// Content-height on a phone so the day panel below gets the rest of the screen;
		// stretched on a desktop so the grid claims the viewport instead of floating in the
		// top third of it.
		<div className="gap-1 min-h-0 lg:flex-1 flex shrink-0 flex-col">
			<div className="grid grid-cols-7" aria-hidden>
				{DAY_LABELS.map((label) => (
					<Text
						key={label}
						size="xs"
						variant="muted"
						className="pb-1 font-semibold tracking-wide text-center uppercase"
					>
						{/* Just the initial below `sm`: "SUN" does not fit a 50px column. */}
						<span className="sm:hidden">{label.charAt(0)}</span>
						<span className="sm:inline hidden">{label}</span>
					</Text>
				))}
			</div>

			<div className="gap-1 min-h-0 grid flex-1 grid-cols-7 grid-rows-6">
				{days.map((day) => {
					const inMonth = isSameMonth(day.date, monthStart)
					const today = isToday(day.date)
					const selected = day.date === selectedDate
					// Against the true count, not the returned one: on a busy day the server
					// trims the list, and "+2 more" under a capped list would understate it.
					const overflow = day.total - MAX_CHIPS

					return (
						<button
							key={day.date}
							type="button"
							onClick={() => onSelectDate(day.date)}
							aria-pressed={selected}
							aria-label={`${day.date}, ${day.total} releases`}
							className={cn(
								// `min-h-11` is a 44px touch target on a phone, where rows size to
								// content; on a desktop the grid stretches and rows grow past it.
								'gap-0.5 p-1 min-h-11 sm:min-h-0 flex flex-col overflow-hidden rounded-md border text-left',
								'motion-safe:transition-colors',
								'focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
								inMonth ? 'border-border' : 'border-transparent bg-muted/20',
								selected && 'border-primary bg-primary/5',
								!selected && 'hover:bg-muted/40',
							)}
						>
							<div className="gap-1 flex shrink-0 items-center justify-between">
								<span
									className={cn(
										'text-xs font-semibold tabular-nums',
										today &&
											'px-1.5 py-0.5 rounded-full bg-primary leading-none text-primary-foreground',
										!today && (inMonth ? 'text-foreground' : 'text-muted-foreground/60'),
									)}
								>
									{dayNumber(day.date)}
								</span>
								{today && <span className="sr-only">(today)</span>}
							</div>

							{/*
							 * Below `sm` a column is ~50px, which truncates every title to a single
							 * letter and an ellipsis — noise rather than information. Dots say the
							 * same thing honestly, and the day panel below carries the detail.
							 */}
							{day.entries.length > 0 && (
								<div className="gap-0.5 sm:hidden flex flex-wrap items-center">
									{day.entries.slice(0, 3).map((entry, index) => (
										<span
											key={`${entry.seriesId ?? entry.seriesName}-${index}`}
											className={cn(
												'h-1.5 w-1.5 rounded-full',
												entry.inLibrary ? 'bg-success' : 'bg-primary',
											)}
											aria-hidden
										/>
									))}
									{day.total > 3 && (
										<Text size="xs" variant="muted" className="leading-none tabular-nums">
											+{day.total - 3}
										</Text>
									)}
								</div>
							)}

							<div className="gap-0.5 min-h-0 sm:flex hidden flex-1 flex-col overflow-hidden">
								{day.entries.slice(0, MAX_CHIPS).map((entry, index) => (
									<EntryChip
										key={`${entry.seriesId ?? entry.seriesName}-${entry.number ?? ''}-${index}`}
										entry={entry}
									/>
								))}
								{overflow > 0 && (
									<Text size="xs" variant="muted" className="px-1 shrink-0">
										+{overflow} more
									</Text>
								)}
							</div>
						</button>
					)
				})}
			</div>
		</div>
	)
}

/** Same six-row footprint, so switching months or loading never changes the page height. */
export function CalendarMonthSkeleton() {
	return (
		<div className="gap-1 min-h-0 grid flex-1 grid-cols-7 grid-rows-6" aria-hidden>
			{Array.from({ length: 42 }, (_, index) => (
				<div
					key={index}
					className="p-1 motion-safe:animate-pulse rounded-md border border-border bg-muted/30"
				/>
			))}
		</div>
	)
}
