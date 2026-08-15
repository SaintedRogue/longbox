import { useGraphQL, useGraphQLMutation } from '@longbox/client'
import { Button, cn, Text } from '@longbox/components'
import { graphql, UserPermission } from '@longbox/graphql'
import { useQueryClient } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { toast } from 'sonner'

import { useAppContext } from '@/context'

import { relativeTime } from './utils'

const STATUS_QUERY_KEY = ['releaseCalendarStatus']

const statusQuery = graphql(`
	query CalendarSyncStatus {
		releaseCalendarStatus {
			isRunning
			lastSyncedAt
			isScheduled
		}
	}
`)

const syncMutation = graphql(`
	mutation CalendarSyncStatusSync {
		syncReleaseCalendar {
			isRunning
			lastSyncedAt
		}
	}
`)

/** How often to re-ask while a sweep is in flight. */
const POLL_INTERVAL_MS = 3000

/**
 * "Last synced X ago" plus a button to pull now.
 *
 * The calendar is a cache of what providers and plugins have said, so how *old* that
 * answer is belongs on the page next to the answer itself — otherwise an empty week is
 * ambiguous between "nothing is coming" and "nothing has been fetched".
 */
export default function CalendarSyncStatus() {
	const client = useQueryClient()
	const { checkPermission } = useAppContext()
	const canSync = checkPermission(UserPermission.ManageServer)

	const { data } = useGraphQL(statusQuery, STATUS_QUERY_KEY, undefined, {
		// Only poll while something is actually happening; an idle calendar page should
		// not sit there asking a question whose answer cannot change on its own.
		refetchInterval: (query) =>
			query.state.data?.releaseCalendarStatus.isRunning ? POLL_INTERVAL_MS : false,
	})

	const status = data?.releaseCalendarStatus
	const isRunning = status?.isRunning ?? false

	const { mutate: sync } = useGraphQLMutation(syncMutation, {
		onSuccess: () => client.invalidateQueries({ queryKey: STATUS_QUERY_KEY }),
		onError: (error) => toast.error('Could not start sync', { description: String(error) }),
	})

	// The sweep finishing is the moment new releases exist, and the calendar queries have
	// no other way to learn that — the mutation returned long before it happened.
	const wasRunning = useRef(false)
	useEffect(() => {
		if (wasRunning.current && !isRunning) {
			client.invalidateQueries({ queryKey: ['releaseCalendar'], exact: false })
			client.invalidateQueries({ queryKey: ['upcomingReleases'], exact: false })
			toast.success('Calendar synced')
		}
		wasRunning.current = isRunning
	}, [isRunning, client])

	if (!status) return null

	return (
		<div className="gap-2 flex items-center">
			{/* The timestamp is the first thing to go when space is tight; the button is not. */}
			<Text size="xs" variant="muted" className="sm:inline hidden tabular-nums">
				{isRunning
					? 'Syncing…'
					: status.lastSyncedAt
						? `Synced ${relativeTime(status.lastSyncedAt)}`
						: 'Never synced'}
				{/*
				 * Without a schedule the calendar only changes when someone presses the
				 * button, which is the difference between "quiet week" and "nothing has
				 * ever been fetched" — worth saying rather than leaving to be discovered.
				 */}
				{!status.isScheduled && !isRunning && ' · not scheduled'}
			</Text>

			{canSync && (
				// No `aria-label`: the visible text is already the accessible name, and an
				// aria-label would *replace* it with different words — which is precisely the
				// mismatch WCAG "Label in Name" exists to prevent, and it broke voice control
				// for anyone saying "click sync now".
				<Button size="sm" variant="ghost" disabled={isRunning} onClick={() => sync()}>
					<RefreshCw
						// Spins only while a sweep is in flight, and only if the viewer wants motion.
						className={cn('mr-1.5 h-3.5 w-3.5', isRunning && 'motion-safe:animate-spin')}
						aria-hidden
					/>
					Sync now
				</Button>
			)}
		</div>
	)
}
