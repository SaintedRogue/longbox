import { useGraphQL } from '@longbox/client'
import { Button, cn, Heading, Text } from '@longbox/components'
import { CalendarScope, graphql } from '@longbox/graphql'
import { keepPreviousData } from '@tanstack/react-query'
import { CalendarCheck, ChevronLeft, ChevronRight } from 'lucide-react'
import { useMemo } from 'react'
import { Helmet } from 'react-helmet'
import { Link, useSearchParams } from 'react-router-dom'

import { SceneContainer } from '@/components/container'

import CalendarSyncStatus from './CalendarSyncStatus'
import CalendarWeek, { CalendarWeekSkeleton } from './CalendarWeek'
import UpcomingList, { UpcomingListSkeleton } from './UpcomingList'
import { weekRangeLabel } from './utils'

const weekQuery = graphql(`
	query ReleaseCalendar($weekOffset: Int!, $scope: CalendarScope!) {
		releaseCalendar(weekOffset: $weekOffset, scope: $scope) {
			date
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

const SCOPES = [
	[CalendarScope.Followed, 'My pull list'],
	[CalendarScope.All, 'All series'],
] as const

const VIEWS = [
	['week', 'Week'],
	['upcoming', 'Upcoming'],
] as const

type CalendarView = (typeof VIEWS)[number][0]

/**
 * View, week and scope live in the URL rather than in component state.
 *
 * They are what the page *is*, so they should survive a reload, be linkable to someone
 * else, and respond to the back button. Holding them in `useState` quietly made all three
 * untrue.
 */
function useCalendarParams() {
	const [params, setParams] = useSearchParams()

	const weekOffset = Number.parseInt(params.get('week') ?? '0', 10) || 0
	const scope =
		params.get('scope') === CalendarScope.All ? CalendarScope.All : CalendarScope.Followed
	const view: CalendarView = params.get('view') === 'upcoming' ? 'upcoming' : 'week'

	const update = (next: { week?: number; scope?: CalendarScope; view?: CalendarView }) => {
		const merged = new URLSearchParams(params)
		// Every default is omitted rather than written, so the everyday URL stays clean.
		if (next.week !== undefined) {
			if (next.week === 0) merged.delete('week')
			else merged.set('week', String(next.week))
		}
		if (next.scope !== undefined) {
			if (next.scope === CalendarScope.Followed) merged.delete('scope')
			else merged.set('scope', next.scope)
		}
		if (next.view !== undefined) {
			if (next.view === 'week') merged.delete('view')
			else merged.set('view', next.view)
			// A week offset means nothing in the upcoming list, and carrying it would put a
			// stale value back in play the moment you switched back.
			if (next.view === 'upcoming') merged.delete('week')
		}
		// Paging a week is not a destination worth its own history entry.
		setParams(merged, { replace: true })
	}

	return { weekOffset, scope, view, update }
}

export default function CalendarScene() {
	const { weekOffset, scope, view, update } = useCalendarParams()
	const isWeekView = view === 'week'

	const week = useGraphQL(
		weekQuery,
		['releaseCalendar', weekOffset, scope],
		{ weekOffset, scope },
		// Hold the previous week on screen while the next one loads, so paging shifts the
		// content instead of blanking the page and springing back.
		{ placeholderData: keepPreviousData, enabled: isWeekView },
	)
	const upcoming = useGraphQL(
		upcomingQuery,
		['upcomingReleases', scope],
		{ scope },
		{ placeholderData: keepPreviousData, enabled: !isWeekView },
	)

	const days = useMemo(
		() =>
			isWeekView ? (week.data?.releaseCalendar ?? []) : (upcoming.data?.upcomingReleases ?? []),
		[isWeekView, week.data, upcoming.data],
	)
	const summary = useMemo(() => {
		const entries = days.flatMap((day) => day.entries)
		return { total: entries.length, owned: entries.filter((entry) => entry.inLibrary).length }
	}, [days])

	const active = isWeekView ? week : upcoming
	const rangeLabel = isWeekView ? weekRangeLabel(days.map((day) => day.date)) : 'Next 90 days'

	return (
		<SceneContainer className="gap-5 flex flex-col">
			<Helmet>
				<title>Longbox | Calendar</title>
			</Helmet>

			<header className="gap-3 flex flex-wrap items-end justify-between">
				<div className="gap-0.5 flex flex-col">
					<Heading size="sm">Release calendar</Heading>
					<Text size="sm" variant="muted" className="tabular-nums">
						{rangeLabel}
						{summary.total > 0 && (
							<>
								{' · '}
								{summary.total} {summary.total === 1 ? 'release' : 'releases'}
								{summary.owned > 0 && ` · ${summary.owned} in library`}
							</>
						)}
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

					{isWeekView && (
						<div className="gap-1 flex items-center">
							<Button
								size="icon"
								variant="ghost"
								aria-label="Previous week"
								onClick={() => update({ week: weekOffset - 1 })}
							>
								<ChevronLeft className="h-4 w-4" />
							</Button>
							<Button
								size="sm"
								variant="ghost"
								disabled={weekOffset === 0}
								onClick={() => update({ week: 0 })}
							>
								Today
							</Button>
							<Button
								size="icon"
								variant="ghost"
								aria-label="Next week"
								onClick={() => update({ week: weekOffset + 1 })}
							>
								<ChevronRight className="h-4 w-4" />
							</Button>
						</div>
					)}
				</div>
			</header>

			{active.isLoading ? (
				isWeekView ? (
					<CalendarWeekSkeleton />
				) : (
					<UpcomingListSkeleton />
				)
			) : summary.total === 0 ? (
				<EmptyState scope={scope} isWeekView={isWeekView} />
			) : (
				// Dimmed rather than replaced: what you were reading stays legible while the
				// next answer arrives.
				<div
					className={cn(active.isPlaceholderData && 'opacity-60 motion-safe:transition-opacity')}
				>
					{isWeekView ? <CalendarWeek days={days} /> : <UpcomingList days={days} />}
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
						'px-3 py-1.5 text-sm rounded-md motion-safe:transition-colors',
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

function EmptyState({ scope, isWeekView }: { scope: CalendarScope; isWeekView: boolean }) {
	const followedScope = scope === CalendarScope.Followed

	return (
		<div className="gap-2 p-10 flex flex-col items-center rounded-lg border border-dashed border-border text-center">
			<CalendarCheck className="h-8 w-8 text-muted-foreground" />
			<Text className="font-medium">
				{isWeekView ? 'Nothing expected this week' : 'Nothing expected yet'}
			</Text>
			<Text size="sm" variant="muted" className="max-w-md">
				{followedScope
					? 'Your pull list is empty or quiet. Switch to All series to see everything coming, and follow anything you want to track.'
					: 'No provider-reported releases land in this window for your matched series. A sync may not have run yet.'}
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
