import { useGraphQL } from '@longbox/client'
import { Button, cn, Heading, Text } from '@longbox/components'
import { CalendarScope, graphql } from '@longbox/graphql'
import { keepPreviousData } from '@tanstack/react-query'
import { CalendarCheck, ChevronLeft, ChevronRight } from 'lucide-react'
import { useMemo } from 'react'
import { Helmet } from 'react-helmet'
import { Link, useSearchParams } from 'react-router-dom'

import { SceneContainer } from '@/components/container'

import CalendarMonthGrid, { CalendarMonthSkeleton } from './CalendarMonthGrid'
import CalendarSyncStatus from './CalendarSyncStatus'
import CalendarWeek, { CalendarWeekSkeleton } from './CalendarWeek'
import DayDetail from './DayDetail'
import UpcomingList, { UpcomingListSkeleton } from './UpcomingList'
import { isSameMonth, todayIso, weekRangeLabel } from './utils'

const monthQuery = graphql(`
	query ReleaseCalendarMonth($monthOffset: Int!, $scope: CalendarScope!) {
		releaseCalendarMonth(monthOffset: $monthOffset, scope: $scope) {
			monthStart
			label
			days {
				date
				total
				entries {
					seriesId
					seriesName
					number
					title
					coverUrl
					inLibrary
					isFollowed
				}
			}
		}
	}
`)

const weekQuery = graphql(`
	query ReleaseCalendar($weekOffset: Int!, $scope: CalendarScope!) {
		releaseCalendar(weekOffset: $weekOffset, scope: $scope) {
			date
			total
			entries {
				seriesId
				seriesName
				number
				title
				coverUrl
				inLibrary
				isFollowed
			}
		}
	}
`)

const upcomingQuery = graphql(`
	query UpcomingReleases($scope: CalendarScope!) {
		upcomingReleases(scope: $scope) {
			date
			total
			entries {
				seriesId
				seriesName
				number
				title
				coverUrl
				inLibrary
				isFollowed
			}
		}
	}
`)

/**
 * Three genuinely different questions, not three filters on one.
 *
 * "My pull list" and "My library" are both about what you have; "All releases" is about
 * what exists, and is the only one that can show you something you do not already own.
 */
const SCOPES = [
	[CalendarScope.Followed, 'My pull list'],
	[CalendarScope.Library, 'My library'],
	[CalendarScope.Everything, 'All releases'],
] as const

/**
 * Opening on "All releases" rather than the pull list.
 *
 * The pull list is empty until you have followed something, so defaulting to it means a
 * brand-new calendar opens on nothing at all and reads as broken. "All releases" always has
 * something in it, and is also where following starts — you subscribe to a series by seeing
 * it come out. Kept as one constant because the URL writer below omits whichever value is
 * the default, and the two drifting apart would put a stale scope in every link.
 */
const DEFAULT_SCOPE = CalendarScope.Everything

const VIEWS = [
	['month', 'Month'],
	['week', 'Week'],
	['upcoming', 'Upcoming'],
] as const

type CalendarView = (typeof VIEWS)[number][0]

/**
 * Everything that decides what the page shows lives in the URL.
 *
 * These are what the page *is*, so they should survive a reload, be linkable to someone
 * else, and respond to the back button. Holding them in `useState` quietly made all three
 * untrue.
 */
function useCalendarParams() {
	const [params, setParams] = useSearchParams()

	const intParam = (key: string) => Number.parseInt(params.get(key) ?? '0', 10) || 0
	const rawView = params.get('view')
	const view: CalendarView = rawView === 'week' || rawView === 'upcoming' ? rawView : 'month'

	const update = (next: {
		month?: number
		week?: number
		scope?: CalendarScope
		view?: CalendarView
		date?: string | null
	}) => {
		const merged = new URLSearchParams(params)
		const set = (key: string, value: string, isDefault: boolean) =>
			isDefault ? merged.delete(key) : merged.set(key, value)

		// Every default is omitted rather than written, so the everyday URL stays `/calendar`.
		if (next.month !== undefined) set('month', String(next.month), next.month === 0)
		if (next.week !== undefined) set('week', String(next.week), next.week === 0)
		if (next.scope !== undefined) set('scope', next.scope, next.scope === DEFAULT_SCOPE)
		if (next.date !== undefined) set('date', next.date ?? '', !next.date)
		if (next.view !== undefined) {
			set('view', next.view, next.view === 'month')
			// Offsets and a selected day mean different things per view; carrying them across
			// would put a stale value back in play the moment you switched.
			merged.delete('month')
			merged.delete('week')
			merged.delete('date')
		}

		// Paging is not a destination worth its own history entry.
		setParams(merged, { replace: true })
	}

	return {
		monthOffset: intParam('month'),
		weekOffset: intParam('week'),
		scope: SCOPES.find(([value]) => value === params.get('scope'))?.[0] ?? DEFAULT_SCOPE,
		view,
		selectedDate: params.get('date'),
		update,
	}
}

export default function CalendarScene() {
	const { monthOffset, weekOffset, scope, view, selectedDate, update } = useCalendarParams()

	const month = useGraphQL(
		monthQuery,
		['releaseCalendarMonth', monthOffset, scope],
		{ monthOffset, scope },
		// Hold the current answer on screen while the next loads, so paging shifts content
		// rather than blanking the page and springing back.
		{ placeholderData: keepPreviousData, enabled: view === 'month' },
	)
	const week = useGraphQL(
		weekQuery,
		['releaseCalendar', weekOffset, scope],
		{ weekOffset, scope },
		{ placeholderData: keepPreviousData, enabled: view === 'week' },
	)
	const upcoming = useGraphQL(
		upcomingQuery,
		['upcomingReleases', scope],
		{ scope },
		{ placeholderData: keepPreviousData, enabled: view === 'upcoming' },
	)

	const active = view === 'month' ? month : view === 'week' ? week : upcoming
	const monthData = month.data?.releaseCalendarMonth

	const days = useMemo(() => {
		if (view === 'month') return monthData?.days ?? []
		if (view === 'week') return week.data?.releaseCalendar ?? []
		return upcoming.data?.upcomingReleases ?? []
	}, [view, monthData, week.data, upcoming.data])

	const summary = useMemo(() => {
		// Padding cells belong to neighbouring months and would inflate the count.
		const counted =
			view === 'month' && monthData
				? days.filter((day) => isSameMonth(day.date, monthData.monthStart))
				: days
		// Summed from each day's reported total rather than from the entries returned: a
		// busy day is trimmed for transport, and counting rows would under-report it.
		// `owned` counts rows, which is safe because owned entries sort ahead of the cap.
		const entries = counted.flatMap((day) => day.entries)
		return {
			total: counted.reduce((sum, day) => sum + day.total, 0),
			owned: entries.filter((e) => e.inLibrary).length,
		}
	}, [view, days, monthData])

	// Default to today when it is in view, so the panel opens on something relevant.
	const effectiveDate = useMemo(() => {
		if (selectedDate) return selectedDate
		if (!monthData) return todayIso()
		return isSameMonth(todayIso(), monthData.monthStart) ? todayIso() : monthData.monthStart
	}, [selectedDate, monthData])

	const rangeLabel =
		view === 'month'
			? (monthData?.label ?? '')
			: view === 'week'
				? weekRangeLabel(days.map((day) => day.date))
				: 'Next 90 days'

	const offset = view === 'month' ? monthOffset : weekOffset
	const step = (delta: number) =>
		view === 'month' ? update({ month: offset + delta }) : update({ week: offset + delta })

	return (
		<SceneContainer className={cn('gap-4 flex flex-col', view === 'month' && 'min-h-0 flex-1')}>
			<Helmet>
				<title>Longbox | Calendar</title>
			</Helmet>

			<header className="gap-3 flex shrink-0 flex-wrap items-end justify-between">
				<div className="gap-0.5 flex flex-col">
					<Heading size="sm">{rangeLabel || 'Release calendar'}</Heading>
					<Text size="sm" variant="muted" className="tabular-nums">
						{summary.total > 0
							? `${summary.total} ${summary.total === 1 ? 'release' : 'releases'}${
									summary.owned > 0 ? ` · ${summary.owned} in library` : ''
								}`
							: 'Nothing expected'}
					</Text>
				</div>

				<div className="gap-2 flex flex-wrap items-center">
					<CalendarSyncStatus />

					<Segmented
						label="Calendar view"
						options={VIEWS}
						selected={view}
						onSelect={(next) => update({ view: next })}
					/>
					<Segmented
						label="Calendar scope"
						options={SCOPES}
						selected={scope}
						onSelect={(next) => update({ scope: next })}
					/>

					{view !== 'upcoming' && (
						<div className="gap-1 flex items-center">
							<Button
								size="icon"
								variant="ghost"
								aria-label={view === 'month' ? 'Previous month' : 'Previous week'}
								onClick={() => step(-1)}
							>
								<ChevronLeft className="h-4 w-4" />
							</Button>
							<Button
								size="sm"
								variant="ghost"
								disabled={offset === 0}
								onClick={() => (view === 'month' ? update({ month: 0 }) : update({ week: 0 }))}
							>
								Today
							</Button>
							<Button
								size="icon"
								variant="ghost"
								aria-label={view === 'month' ? 'Next month' : 'Next week'}
								onClick={() => step(1)}
							>
								<ChevronRight className="h-4 w-4" />
							</Button>
						</div>
					)}
				</div>
			</header>

			{active.isLoading ? (
				view === 'month' ? (
					<CalendarMonthSkeleton />
				) : view === 'week' ? (
					<CalendarWeekSkeleton />
				) : (
					<UpcomingListSkeleton />
				)
			) : view === 'month' ? (
				<div
					className={cn(
						'gap-3 min-h-0 lg:flex-row flex flex-1 flex-col',
						month.isPlaceholderData && 'opacity-60 motion-safe:transition-opacity',
					)}
				>
					<CalendarMonthGrid
						days={days}
						monthStart={monthData?.monthStart ?? ''}
						selectedDate={effectiveDate}
						onSelectDate={(date) => update({ date })}
					/>
					<DayDetail
						date={effectiveDate}
						day={days.find((day) => day.date === effectiveDate)}
						days={days}
					/>
				</div>
			) : summary.total === 0 ? (
				<EmptyState scope={scope} view={view} />
			) : (
				<div
					className={cn(active.isPlaceholderData && 'opacity-60 motion-safe:transition-opacity')}
				>
					{view === 'week' ? <CalendarWeek days={days} /> : <UpcomingList days={days} />}
				</div>
			)}
		</SceneContainer>
	)
}

/**
 * A segmented control. `aria-pressed` toggle buttons rather than `role="tablist"`, which
 * would promise tab panels that do not exist.
 */
function Segmented<T extends string>({
	label,
	options,
	selected,
	onSelect,
}: {
	label: string
	options: readonly (readonly [T, string])[]
	selected: T
	onSelect: (value: T) => void
}) {
	return (
		<div className="p-0.5 flex rounded-lg border border-border" role="group" aria-label={label}>
			{options.map(([value, text]) => (
				<button
					key={value}
					type="button"
					aria-pressed={selected === value}
					className={cn(
						// Tighter on a phone: two of these plus the nav have to share a row that
						// would otherwise push the grid below the fold.
						'px-2 py-1 sm:px-3 sm:py-1.5 text-xs sm:text-sm rounded-md motion-safe:transition-colors',
						'focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
						selected === value
							? 'font-medium bg-muted text-foreground'
							: 'text-muted-foreground hover:text-foreground',
					)}
					onClick={() => onSelect(value)}
				>
					{text}
				</button>
			))}
		</div>
	)
}

function EmptyState({ scope, view }: { scope: CalendarScope; view: CalendarView }) {
	return (
		<div className="gap-2 p-10 flex flex-col items-center rounded-lg border border-dashed border-border text-center">
			<CalendarCheck className="h-8 w-8 text-muted-foreground" />
			<Text className="font-medium">
				{view === 'week' ? 'Nothing expected this week' : 'Nothing expected yet'}
			</Text>
			<Text size="sm" variant="muted" className="max-w-md">
				{scope === CalendarScope.Followed
					? 'Your pull list is empty or quiet. Switch to All releases to see everything coming, and follow anything you want to track.'
					: scope === CalendarScope.Library
						? 'Nothing lands in this window for the series in your library. Switch to All releases to see everything coming, matched or not.'
						: 'No releases at all in this window, which means the calendar has no provider data yet rather than that nothing is shipping. A sync may not have run.'}
			</Text>
			<Link
				to="/settings/jobs"
				className="text-sm text-primary hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
			>
				Check calendar sync
			</Link>
		</div>
	)
}
