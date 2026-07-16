import { ButtonOrLink } from '@stump/components'
import type { BookCardFragment } from '@stump/graphql'
import { useLocaleContext } from '@stump/i18n'
import { DownloadCloud, Loader2, RotateCcw, Trash2 } from 'lucide-react'
import { useCallback } from 'react'

import { deriveDownloadFormat } from '@/offline/downloadFormat'
import type { LiveDownload } from '@/offline/downloadStore'
import { useDownloadActions, useDownloadState, useIsDownloaded } from '@/offline/useDownloads'

export type DownloadButtonState = 'idle' | 'downloading' | 'downloaded' | 'failed'

/**
 * Pure state selection, extracted so it's unit-testable without rendering. Precedence: an active
 * (pending/downloading) job always wins, then a failed job, then the durable "already downloaded"
 * record, else idle. A `live` entry with status `completed` (the manager doesn't clear it on
 * success -- see downloadManager.startJob) falls through to the `isDownloaded` check, so it reads
 * as "downloaded" rather than lingering as an active state.
 */
export function selectDownloadButtonState(
	isDownloaded: boolean,
	live?: LiveDownload,
): DownloadButtonState {
	if (live?.status === 'pending' || live?.status === 'downloading') return 'downloading'
	if (live?.status === 'failed') return 'failed'
	if (isDownloaded) return 'downloaded'
	return 'idle'
}

type Props = {
	book: BookCardFragment
}

/**
 * State-driven offline-download control, rendered beside the existing direct-download button in
 * `BookActionMenu`. Renders nothing when the book's extension doesn't map to a `DownloadFormat`
 * (see `deriveDownloadFormat`) -- e.g. an unsupported/unknown file type isn't offline-downloadable.
 */
export default function OfflineDownloadButton({ book }: Props) {
	const { t } = useLocaleContext()
	const isDownloaded = useIsDownloaded(book.id)
	const live = useDownloadState(book.id)
	const actions = useDownloadActions()

	const format = deriveDownloadFormat(book.extension)
	const state = selectDownloadButtonState(isDownloaded, live)

	const handleClick = useCallback(() => {
		switch (state) {
			case 'idle':
				if (!format) return
				void actions.enqueue({
					bookId: book.id,
					title: book.resolvedName,
					format,
					pageCount: book.pages ?? undefined,
				})
				return
			case 'downloading':
				void actions.cancel(book.id)
				return
			case 'downloaded':
				void actions.remove(book.id)
				return
			case 'failed':
				void actions.retry(book.id)
				return
		}
	}, [state, actions, book, format])

	if (!format) return null

	if (state === 'downloading') {
		const progress =
			live?.totalBytes && live.totalBytes > 0
				? ` ${Math.round((live.receivedBytes / live.totalBytes) * 100)}%`
				: ''
		return (
			<ButtonOrLink
				className="w-full shrink"
				variant="outline"
				onClick={handleClick}
				title={t('offlineDownload.cancel')}
			>
				<Loader2 className="mr-2 h-4 w-4 animate-spin" />
				{t('offlineDownload.downloading')}
				{progress}
			</ButtonOrLink>
		)
	}

	if (state === 'downloaded') {
		return (
			<ButtonOrLink
				className="w-full shrink"
				variant="outline"
				onClick={handleClick}
				title={t('offlineDownload.remove')}
			>
				<Trash2 className="mr-2 h-4 w-4" />
				{t('offlineDownload.remove')}
			</ButtonOrLink>
		)
	}

	if (state === 'failed') {
		return (
			<ButtonOrLink
				className="w-full shrink"
				variant="outline"
				onClick={handleClick}
				title={live?.failureReason ?? t('offlineDownload.retry')}
			>
				<RotateCcw className="mr-2 h-4 w-4" />
				{t('offlineDownload.retry')}
			</ButtonOrLink>
		)
	}

	return (
		<ButtonOrLink
			className="w-full shrink"
			variant="outline"
			onClick={handleClick}
			title={t('offlineDownload.download')}
		>
			<DownloadCloud className="mr-2 h-4 w-4" />
			{t('offlineDownload.download')}
		</ButtonOrLink>
	)
}
