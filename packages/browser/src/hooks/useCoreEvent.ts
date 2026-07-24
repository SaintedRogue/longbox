import { useGraphQLSubscription, useJobStore, useSDK } from '@longbox/client'
import { graphql, JobStatus, JobUpdate, UseCoreEventSubscription } from '@longbox/graphql'
import { Api } from '@longbox/sdk'
import { QueryClient, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect } from 'react'
import { toast } from 'sonner'
import { match, P } from 'ts-pattern'
import { useShallow } from 'zustand/react/shallow'

const RECONCILE_INTERVAL_MS = 60_000

const reconcileActiveJobsQuery = graphql(`
	query ReconcileActiveJobs {
		jobs(pagination: { none: { unpaginated: true } }, statuses: [RUNNING, QUEUED, PAUSED]) {
			nodes {
				id
				status
			}
		}
	}
`)

const subscription = graphql(`
	subscription UseCoreEvent {
		readEvents {
			__typename
			... on CreatedManySeries {
				count
				libraryId
			}
			... on CreatedMedia {
				id
				seriesId
			}
			... on CreatedOrUpdatedManyMedia {
				count
				seriesId
			}
			... on DiscoveredMissingLibrary {
				id
			}
			... on JobStarted {
				id
			}
			... on JobUpdate {
				__typename
				id
				status
				message
				completedTasks
				remainingTasks
				completedSubtasks
				totalSubtasks
				subtitle
			}
			... on JobOutput {
				id
				output {
					__typename
					... on LibraryScanOutput {
						createdMedia
						createdSeries
						updatedMedia
						updatedSeries
					}
					... on SeriesScanOutput {
						createdMedia
						updatedMedia
					}
					... on OrganizeLooseFilesOutput {
						moved
						proposedMoves
					}
				}
			}
		}
	}
`)

type Params = {
	liveRefetch?: boolean
	onConnectionWithServerChanged?: (connected: boolean) => void
}

// TODO: Attempt reconnect with re-auth
export function useCoreEvent({ liveRefetch, onConnectionWithServerChanged }: Params) {
	const store = useJobStore(
		useShallow((state) => ({
			addJob: state.addJob,
			reconcileActiveJobs: state.reconcileActiveJobs,
			removeJob: state.removeJob,
			upsertJob: state.upsertJob,
		})),
	)
	const client = useQueryClient()

	const { sdk } = useSDK()

	const onPayloadReceived = useCallback(
		(payload: UseCoreEventSubscription) =>
			eventHandler(payload.readEvents, { store, client, sdk, liveRefetch }),
		[store, client, sdk, liveRefetch],
	)

	/**
	 * Re-syncs the locally-tracked active jobs against the server's current view of active
	 * jobs. This covers two gaps that the live event stream alone cannot:
	 *  - a `Lagged` broadcast subscriber that drops events WITHOUT the socket ever closing
	 *    (so `onConnected` never fires again to trigger a resync), and
	 *  - any events missed during the (now bounded, backed-off) window between a disconnect
	 *    and the subscription's reconnect.
	 */
	const reconcileJobs = useCallback(async () => {
		const knownJobIds = Object.keys(useJobStore.getState().jobs)
		try {
			const result = await sdk.execute(reconcileActiveJobsQuery)
			store.reconcileActiveJobs(result.jobs.nodes, knownJobIds)
		} catch (error) {
			console.error('Failed to reconcile active jobs', error)
		}
	}, [sdk, store])

	const [, dispose] = useGraphQLSubscription(subscription, {
		onMessage: (payload) => onPayloadReceived(payload),
		onConnected: () => {
			onConnectionWithServerChanged?.(true)
			reconcileJobs()
		},
		onDisconnected: () => {
			console.warn('Disconnected from GraphQL subscription')
			onConnectionWithServerChanged?.(false)
		},
	})

	useEffect(() => {
		return () => {
			dispose()
		}
	}, [dispose])

	useEffect(() => {
		const intervalId = setInterval(reconcileJobs, RECONCILE_INTERVAL_MS)
		return () => {
			clearInterval(intervalId)
		}
	}, [reconcileJobs])
}

type EventHandlerParams = {
	store: {
		addJob: (id: string) => void
		removeJob: (jobId: string) => void
		upsertJob: (job: JobUpdate) => void
	}
	client: QueryClient
	sdk: Api
	liveRefetch?: boolean
}

const eventHandler = async (
	event: UseCoreEventSubscription['readEvents'],
	{ store, client, sdk, liveRefetch }: EventHandlerParams,
) => {
	const { __typename } = event

	switch (__typename) {
		case 'JobStarted':
			store.addJob(event.id)
			client.invalidateQueries({ queryKey: [sdk.cacheKeys.jobs] })
			break
		case 'JobUpdate':
			if (event.status && event.status !== 'RUNNING') {
				store.removeJob(event.id)
				await client.invalidateQueries({ queryKey: [sdk.cacheKeys.jobs], exact: false })
				if (event.status === JobStatus.Completed) {
					toast.success(event.message || 'Job completed')
				}
			} else {
				store.upsertJob(event)
			}
			break
		case 'CreatedManySeries':
			if (liveRefetch) {
				await Promise.all([
					client.invalidateQueries({ queryKey: [sdk.cacheKeys.getStats], exact: false }),
					client.invalidateQueries({
						predicate: ({ queryKey: [rootKey] }) =>
							typeof rootKey === 'string' && ['series', 'media'].includes(rootKey.toLowerCase()),
					}),
				])
			}
			break
		case 'CreatedOrUpdatedManyMedia':
			if (liveRefetch) {
				await client.invalidateQueries({
					predicate: ({ queryKey: [rootKey] }) =>
						typeof rootKey === 'string' && ['series', 'media'].includes(rootKey.toLowerCase()),
				})
			}
			break
		case 'JobOutput':
			handleJobOutput(event, { client, sdk })
			break
		default:
			console.warn(`Unhandled core event type: ${__typename}`)
	}
}

const handleJobOutput = async (
	{ output }: Extract<UseCoreEventSubscription['readEvents'], { __typename: 'JobOutput' }>,
	{ client, sdk }: Omit<EventHandlerParams, 'store' | 'liveRefetch'>,
) => {
	const affectedBooks = match(output)
		.with(
			{ __typename: P.union('LibraryScanOutput', 'SeriesScanOutput') },
			({ createdMedia, updatedMedia }) => createdMedia + updatedMedia,
		)
		.otherwise(() => 0)

	const affectedSeries = match(output)
		.with(
			{ __typename: 'LibraryScanOutput' },
			({ createdSeries, updatedSeries }) => createdSeries + updatedSeries,
		)
		.with({ __typename: 'SeriesScanOutput' }, () => affectedBooks)
		.otherwise(() => 0)

	const organizedMoved = match(output)
		.with({ __typename: 'OrganizeLooseFilesOutput' }, ({ moved }) => moved)
		.otherwise(() => 0)
	const isOrganize = output.__typename === 'OrganizeLooseFilesOutput'

	const keys = [
		sdk.cacheKeys.scanHistory,
		sdk.cacheKeys.getStats,
		'missingEntities', // TODO: Put behind key?
		...(affectedBooks > 0 ? [sdk.cacheKeys.recentlyAddedMedia, sdk.cacheKeys.media] : []),
		...(affectedSeries > 0 ? [sdk.cacheKeys.recentlyAddedSeries, sdk.cacheKeys.series] : []),
		...(isOrganize ? [sdk.cacheKeys.organizePreview] : []),
		...(organizedMoved > 0 ? [sdk.cacheKeys.media, sdk.cacheKeys.series] : []),
	] as string[]

	await client.invalidateQueries({
		predicate: ({ queryKey: [rootKey] }) => typeof rootKey === 'string' && keys.includes(rootKey),
	})
}
