import { useSDK } from '@stump/client'
import { useEffect, useMemo } from 'react'

import type { DownloadRecord } from './db'
import { createDownloadFetcher } from './downloadFetcher'
import { cancel, enqueue, remove, retry, setDownloadFetcher } from './downloadManager'
import { listDownloadRecords } from './downloadRecords'
import { type LiveDownload, useDownloadStore } from './downloadStore'

/** Live (in-progress) download state for one book, or `undefined` if it isn't queued/downloading. */
export function useDownloadState(bookId: string): LiveDownload | undefined {
	return useDownloadStore((state) => state.downloads[bookId])
}

/** Whether a book is durably available offline, per the hydrated records catalog. */
export function useIsDownloaded(bookId: string): boolean {
	return useDownloadStore((state) => Boolean(state.records[bookId]))
}

/** All downloaded books, newest first. Selects the whole `records` map and derives the sorted
 *  array with `useMemo` (mirrors JobOverlay's `useJobStore` usage) so the array reference is
 *  stable across renders that don't change the underlying records. */
export function useDownloadsList(): DownloadRecord[] {
	const records = useDownloadStore((state) => state.records)
	return useMemo(
		() => Object.values(records).sort((a, b) => b.downloadedAt - a.downloadedAt),
		[records],
	)
}

/** Stable refs to the manager's mutation functions -- these are already module-level exports
 *  (not closures), so returning them directly gives referential stability for free. */
export function useDownloadActions(): {
	enqueue: typeof enqueue
	cancel: typeof cancel
	retry: typeof retry
	remove: typeof remove
} {
	return useMemo(() => ({ enqueue, cancel, retry, remove }), [])
}

/**
 * Registers the real, SDK-backed fetcher with the (framework-agnostic) download manager. Without
 * this, `enqueue()` rejects every job (see `downloadManager`'s `defaultFetcher`). Re-registers
 * whenever the SDK instance changes (e.g. re-auth) so the fetcher always closes over a live,
 * correctly-authenticated `sdk.axios`.
 */
export function useRegisterDownloadFetcher(): void {
	const { sdk } = useSDK()

	useEffect(() => {
		setDownloadFetcher(createDownloadFetcher(sdk))
	}, [sdk])
}

/**
 * Hydrates the store's durable-records projection from IndexedDB on mount, so downloads
 * completed in a prior session appear immediately without waiting on a live completion event.
 */
export function useHydrateDownloads(): void {
	useEffect(() => {
		let cancelled = false
		listDownloadRecords().then((records) => {
			if (!cancelled) {
				useDownloadStore.getState().hydrateRecords(records)
			}
		})
		return () => {
			cancelled = true
		}
	}, [])
}

/**
 * Combines fetcher registration and record hydration into one mount call. Mount once, high in
 * the app shell (see AppLayout), next to `useProgressOutbox`.
 */
export function useOfflineDownloads(): void {
	useRegisterDownloadFetcher()
	useHydrateDownloads()
}
