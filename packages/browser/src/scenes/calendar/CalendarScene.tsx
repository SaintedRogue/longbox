import { useGraphQL } from '@longbox/client'
import { cx } from '@longbox/components'
import { CalendarScope, graphql } from '@longbox/graphql'
import { CalendarCheck, ChevronLeft, ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { Helmet } from 'react-helmet'
import { Link } from 'react-router-dom'

import { SceneContainer } from '@/components/container'
import { usePaths } from '@/paths'

import { dayLabel, isToday } from './utils'

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

export default function CalendarScene() {
	const paths = usePaths()
	const [weekOffset, setWeekOffset] = useState(0)
	const [scope, setScope] = useState<CalendarScope>(CalendarScope.Followed)

	const { data, isLoading } = useGraphQL(query, ['releaseCalendar', weekOffset, scope], {
		weekOffset,
		scope,
	})

	const days = data?.releaseCalendar ?? []
	const isEmptyWeek = days.every((day) => day.entries.length === 0)

	return (
		<SceneContainer className="gap-4 flex flex-col">
			<Helmet>
				<title>Longbox | Calendar</title>
			</Helmet>

			<div className="gap-2 flex flex-wrap items-center justify-between">
				<h1 className="text-2xl font-bold">Release calendar</h1>

				<div className="gap-2 flex items-center">
					<div className="p-0.5 flex rounded-lg border border-border" role="tablist">
						{(
							[
								[CalendarScope.Followed, 'My pull list'],
								[CalendarScope.All, 'All series'],
							] as const
						).map(([value, label]) => (
							<button
								key={value}
								role="tab"
								aria-selected={scope === value}
								className={cx(
									'px-3 py-1.5 text-sm rounded-md transition-colors',
									scope === value
										? 'font-medium bg-muted text-foreground'
										: 'text-muted-foreground hover:text-foreground',
								)}
								onClick={() => setScope(value)}
							>
								{label}
							</button>
						))}
					</div>

					<div className="gap-1 flex items-center">
						<button
							aria-label="Previous week"
							className="p-2 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
							onClick={() => setWeekOffset((w) => w - 1)}
						>
							<ChevronLeft className="h-4 w-4" />
						</button>
						<button
							className="px-3 py-1.5 text-sm rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
							onClick={() => setWeekOffset(0)}
						>
							Today
						</button>
						<button
							aria-label="Next week"
							className="p-2 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
							onClick={() => setWeekOffset((w) => w + 1)}
						>
							<ChevronRight className="h-4 w-4" />
						</button>
					</div>
				</div>
			</div>

			{!isLoading && isEmptyWeek && (
				<div className="gap-2 p-10 flex flex-col items-center rounded-lg border border-dashed border-border text-center">
					<CalendarCheck className="h-8 w-8 text-muted-foreground" />
					<p className="font-medium">Nothing expected this week</p>
					<p className="max-w-md text-sm text-muted-foreground">
						{scope === CalendarScope.Followed
							? 'Follow a series (from its page menu) to build your pull list, or switch to All series. Releases appear after the next calendar sync.'
							: 'No provider-reported releases land in this window for your matched series.'}
					</p>
				</div>
			)}

			<div className="gap-3 sm:grid-cols-2 lg:grid-cols-7 grid grid-cols-1">
				{days.map((day) => (
					<div
						key={day.date}
						className={cx(
							'min-h-24 gap-2 p-2 flex flex-col rounded-lg border border-border',
							isToday(day.date) && 'border-primary',
						)}
					>
						<span
							className={cx(
								'text-xs font-semibold tracking-wide uppercase',
								isToday(day.date) ? 'text-primary' : 'text-muted-foreground',
							)}
						>
							{dayLabel(day.date)}
						</span>
						{day.entries.map((entry) => (
							<Link
								key={`${entry.seriesId}-${entry.number ?? entry.title ?? ''}`}
								to={paths.seriesOverview(String(entry.seriesId))}
								className="gap-2 p-1.5 flex items-center rounded-md bg-muted hover:bg-muted"
							>
								{entry.coverUrl && (
									<img
										src={entry.coverUrl}
										alt=""
										loading="lazy"
										className="h-12 w-8 shrink-0 rounded-sm object-cover"
									/>
								)}
								<div className="min-w-0 flex-1">
									<p className="text-sm font-medium truncate">
										{entry.seriesName}
										{entry.number ? ` #${entry.number}` : ''}
									</p>
									<p className="text-xs truncate text-muted-foreground">
										{entry.inLibrary ? 'In library' : 'Expected'}
									</p>
								</div>
							</Link>
						))}
					</div>
				))}
			</div>
		</SceneContainer>
	)
}
