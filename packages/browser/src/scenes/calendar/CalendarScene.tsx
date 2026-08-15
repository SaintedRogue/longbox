import { useGraphQL } from '@longbox/client'
import { Button, cn, Heading, Text } from '@longbox/components'
import { CalendarScope, graphql } from '@longbox/graphql'
import { keepPreviousData } from '@tanstack/react-query'
import { CalendarCheck, ChevronLeft, ChevronRight } from 'lucide-react'
import { useMemo } from 'react'
import { Helmet } from 'react-helmet'
import { Link, useSearchParams } from 'react-router-dom'

import { SceneContainer } from '@/components/container'

import CalendarWeek, { CalendarWeekSkeleton } from './CalendarWeek'
import { weekRangeLabel } from './utils'

const query = graphql(`
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
			}
		}
	}
`)

const SCOPES = [
	[CalendarScope.Followed, 'My pull list'],
	[CalendarScope.All, 'All series'],
] as const

/**
 * Week and scope live in the URL rather than in component state.
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

	const update = (next: { week?: number; scope?: CalendarScope }) => {
		const merged = new URLSearchParams(params)
		// Both defaults are omitted rather than written, so the everyday URL stays clean.
		if (next.week !== undefined) {
			if (next.week === 0) merged.delete('week')
			else merged.set('week', String(next.week))
		}
		if (next.scope !== undefined) {
			if (next.scope === CalendarScope.Followed) merged.delete('scope')
			else merged.set('scope', next.scope)
		}
		// Paging a week is not a destination worth its own history entry.
		setParams(merged, { replace: true })
	}

	return { weekOffset, scope, update }
}

export default function CalendarScene() {
	const { weekOffset, scope, update } = useCalendarParams()

	const { data, isLoading, isPlaceholderData } = useGraphQL(
		query,
		['releaseCalendar', weekOffset, scope],
		{ weekOffset, scope },
		// Hold the previous week on screen while the next one loads, so paging shifts the
		// content instead of blanking the page and springing back.
		{ placeholderData: keepPreviousData },
	)

	const days = useMemo(() => data?.releaseCalendar ?? [], [data])
	const summary = useMemo(() => {
		const entries = days.flatMap((day) => day.entries)
		return { total: entries.length, owned: entries.filter((entry) => entry.inLibrary).length }
	}, [days])

	const rangeLabel = weekRangeLabel(days.map((day) => day.date))

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
					<div
						className="p-0.5 flex rounded-lg border border-border"
						role="group"
						aria-label="Calendar scope"
					>
						{SCOPES.map(([value, label]) => (
							<button
								key={value}
								type="button"
								aria-pressed={scope === value}
								className={cn(
									'px-3 py-1.5 text-sm rounded-md motion-safe:transition-colors',
									'focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
									scope === value
										? 'font-medium bg-muted text-foreground'
										: 'text-muted-foreground hover:text-foreground',
								)}
								onClick={() => update({ scope: value })}
							>
								{label}
							</button>
						))}
					</div>

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
				</div>
			</header>

			{isLoading ? (
				<CalendarWeekSkeleton />
			) : summary.total === 0 ? (
				<EmptyWeek scope={scope} />
			) : (
				// Dimmed rather than replaced: the week you were reading stays legible while
				// the next one arrives.
				<div className={cn(isPlaceholderData && 'opacity-60 motion-safe:transition-opacity')}>
					<CalendarWeek days={days} />
				</div>
			)}
		</SceneContainer>
	)
}

function EmptyWeek({ scope }: { scope: CalendarScope }) {
	return (
		<div className="gap-2 p-10 flex flex-col items-center rounded-lg border border-dashed border-border text-center">
			<CalendarCheck className="h-8 w-8 text-muted-foreground" />
			<Text className="font-medium">Nothing expected this week</Text>
			<Text size="sm" variant="muted" className="max-w-md">
				{scope === CalendarScope.Followed
					? 'Follow a series from its page menu to build your pull list. Releases appear after the next calendar sync.'
					: 'No provider-reported releases land in this window for your matched series.'}
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
