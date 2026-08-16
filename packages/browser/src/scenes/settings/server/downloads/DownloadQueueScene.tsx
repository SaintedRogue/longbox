import { useGraphQL, useGraphQLMutation } from '@longbox/client'
import { Button, Heading, Text } from '@longbox/components'
import { DownloadStatus, graphql } from '@longbox/graphql'
import { useQueryClient } from '@tanstack/react-query'
import { Helmet } from 'react-helmet'
import { toast } from 'sonner'

import { ContentContainer, SceneContainer } from '@/components/container'

const QUEUE_QUERY_KEY = ['downloadQueue']
/** Only while something is moving — see the refetch guard below. */
const POLL_INTERVAL_MS = 2000

const queueQuery = graphql(`
	query DownloadQueue {
		downloadQueue {
			id
			title
			source
			status
			pluginSlug
			sizeBytes
			progressBytes
			error
		}
	}
`)

const setStatusMutation = graphql(`
	mutation SetDownloadStatus($id: Int!, $status: DownloadStatus!) {
		setDownloadStatus(id: $id, status: $status) {
			id
			status
		}
	}
`)

const runMutation = graphql(`
	mutation RunDownloadQueue {
		runDownloadQueue
	}
`)

const clearMutation = graphql(`
	mutation ClearFinishedDownloads {
		clearFinishedDownloads
	}
`)

/** Bytes at the precision a person reading a queue actually wants. */
function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`
	const units = ['KB', 'MB', 'GB']
	let value = bytes / 1024
	let unit = 0
	while (value >= 1024 && unit < units.length - 1) {
		value /= 1024
		unit += 1
	}
	return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`
}

const STATUS_LABELS: Record<DownloadStatus, string> = {
	[DownloadStatus.Pending]: 'Waiting for you',
	[DownloadStatus.Approved]: 'Queued',
	[DownloadStatus.Downloading]: 'Downloading',
	[DownloadStatus.Completed]: 'Done',
	[DownloadStatus.Failed]: 'Failed',
	[DownloadStatus.Cancelled]: 'Cancelled',
}

/** State is stated in words, not only in colour — a colour alone says nothing to anyone who cannot distinguish it. */
const STATUS_TONE: Record<DownloadStatus, string> = {
	[DownloadStatus.Pending]: 'text-muted-foreground',
	[DownloadStatus.Approved]: 'text-muted-foreground',
	[DownloadStatus.Downloading]: 'text-foreground',
	[DownloadStatus.Completed]: 'text-success',
	[DownloadStatus.Failed]: 'text-destructive',
	[DownloadStatus.Cancelled]: 'text-muted-foreground',
}

export default function DownloadQueueScene() {
	const client = useQueryClient()

	const { data } = useGraphQL(queueQuery, QUEUE_QUERY_KEY, undefined, {
		// Only poll while something can still change on its own. An idle queue should not
		// sit there asking a question whose answer is already settled.
		refetchInterval: (query) =>
			query.state.data?.downloadQueue.some(
				(entry) =>
					entry.status === DownloadStatus.Downloading || entry.status === DownloadStatus.Approved,
			)
				? POLL_INTERVAL_MS
				: false,
	})

	const invalidate = () => client.invalidateQueries({ queryKey: QUEUE_QUERY_KEY })
	const onError = (error: unknown) =>
		toast.error('That did not work', { description: String(error) })

	const { mutate: setStatus } = useGraphQLMutation(setStatusMutation, {
		onSuccess: invalidate,
		onError,
	})
	const { mutate: run, isPending: isRunning } = useGraphQLMutation(runMutation, {
		onSuccess: () => {
			toast.success('Working through the queue')
			invalidate()
		},
		onError,
	})
	const { mutate: clear } = useGraphQLMutation(clearMutation, {
		onSuccess: invalidate,
		onError,
	})

	const entries = data?.downloadQueue ?? []
	const waiting = entries.filter((e) => e.status === DownloadStatus.Pending).length
	const finished = entries.filter((e) =>
		[DownloadStatus.Completed, DownloadStatus.Failed, DownloadStatus.Cancelled].includes(
			e.status as DownloadStatus,
		),
	).length

	return (
		<SceneContainer>
			<Helmet>
				<title>Longbox | Downloads</title>
			</Helmet>

			<ContentContainer>
				<div className="gap-6 flex flex-col">
					<div className="gap-3 flex flex-wrap items-start justify-between">
						<div className="gap-1 max-w-2xl flex flex-col">
							<Heading size="sm">Download queue</Heading>
							<Text size="sm" variant="muted">
								Files a download-source plugin offered for issues you follow. Nothing is fetched
								until it is approved, unless the pull-list sweep is set to grab automatically.
							</Text>
						</div>

						<div className="gap-2 flex items-center">
							{finished > 0 && (
								<Button size="sm" variant="ghost" onClick={() => clear()}>
									Clear finished
								</Button>
							)}
							<Button size="sm" variant="default" disabled={isRunning} onClick={() => run()}>
								{isRunning ? 'Starting…' : 'Run queue'}
							</Button>
						</div>
					</div>

					{waiting > 0 && (
						<Text size="sm" variant="muted" className="tabular-nums">
							{waiting} {waiting === 1 ? 'download is' : 'downloads are'} waiting for your approval.
						</Text>
					)}

					{entries.length === 0 ? (
						<div className="gap-1 p-10 flex flex-col items-center rounded-lg border border-dashed border-border text-center">
							<Text className="font-medium">Nothing queued</Text>
							<Text size="sm" variant="muted" className="max-w-md">
								Install a plugin that provides downloads, follow some series, and the pull-list
								sweep will start finding things.
							</Text>
						</div>
					) : (
						<div className="gap-2 flex flex-col">
							{entries.map((entry) => {
								const status = entry.status as DownloadStatus | null
								const size = entry.sizeBytes ?? 0
								const isActive = status === DownloadStatus.Downloading

								return (
									<div
										key={entry.id}
										className="gap-3 p-4 flex flex-wrap items-start justify-between rounded-lg border border-border bg-card"
									>
										<div className="gap-1 min-w-0 flex flex-1 flex-col">
											<Text className="font-medium line-clamp-2">{entry.title}</Text>

											<div className="gap-2 flex flex-wrap items-baseline">
												{status && (
													<Text size="xs" className={STATUS_TONE[status]}>
														{STATUS_LABELS[status]}
													</Text>
												)}
												<Text size="xs" variant="muted">
													{entry.source ?? entry.pluginSlug}
												</Text>
												{isActive && (
													<Text size="xs" variant="muted" className="tabular-nums">
														{formatBytes(entry.progressBytes)}
														{size > 0 ? ` of ${formatBytes(size)}` : ''}
													</Text>
												)}
												{!isActive && size > 0 && (
													<Text size="xs" variant="muted" className="tabular-nums">
														{formatBytes(size)}
													</Text>
												)}
											</div>

											{entry.error && (
												<Text size="xs" className="text-destructive">
													{entry.error}
												</Text>
											)}
										</div>

										<div className="gap-2 flex shrink-0 items-center">
											{status === DownloadStatus.Pending && (
												<Button
													size="sm"
													variant="default"
													onClick={() =>
														setStatus({ id: entry.id, status: DownloadStatus.Approved })
													}
												>
													Approve
												</Button>
											)}
											{status === DownloadStatus.Failed && (
												<Button
													size="sm"
													variant="secondary"
													onClick={() =>
														setStatus({ id: entry.id, status: DownloadStatus.Approved })
													}
												>
													Retry
												</Button>
											)}
											{(status === DownloadStatus.Pending ||
												status === DownloadStatus.Approved) && (
												<Button
													size="sm"
													variant="ghost"
													onClick={() =>
														setStatus({ id: entry.id, status: DownloadStatus.Cancelled })
													}
												>
													Cancel
												</Button>
											)}
										</div>
									</div>
								)
							})}
						</div>
					)}
				</div>
			</ContentContainer>
		</SceneContainer>
	)
}
