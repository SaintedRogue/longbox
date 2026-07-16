import { useSDK } from '@stump/client'
import { useEffect, useRef } from 'react'

import { UPDATE_READ_PROGRESS } from './progressMutation'
import {
	listPending,
	markErrorIfUnchanged,
	markSyncedIfUnchanged,
	markSyncing,
	recoverStuckSyncing,
	toMutationInput,
} from './progressOutbox'

/**
 * Flushes the durable progress outbox (see `./progressOutbox`) on mount and on every
 * `online` event: any reading-progress mutation that exhausted its retries while the
 * reader had it (see the readers' terminal `onError` branches) gets replayed here once
 * connectivity is restored, so a dropped connection never silently loses a user's
 * position. Mount once, high in the shell (AppLayout), next to `useScrollRestoration`.
 */
export function useProgressOutbox() {
	const { sdk } = useSDK()
	const isFlushingRef = useRef(false)

	useEffect(() => {
		const flush = async () => {
			// Serialize flushes -- a mount-triggered flush and an `online`-triggered flush
			// firing in close succession must not race and replay the same row twice.
			if (isFlushingRef.current) {
				return
			}
			isFlushingRef.current = true

			try {
				// Reclaim any row orphaned by a flush that crashed (or the tab was closed)
				// mid-request before it could record SYNCED/ERROR -- otherwise it would be
				// permanently excluded from listPending and its progress lost forever.
				await recoverStuckSyncing()

				const rows = await listPending()
				for (const row of rows) {
					// markSyncing stamps a fresh updatedAt and returns the record carrying it;
					// that timestamp is snapshotted as the optimistic-concurrency guard below,
					// so a concurrent enqueueProgress for the same book (which always bumps
					// updatedAt) is detected on completion instead of silently losing the
					// fresher update or regressing the server with a stale one.
					let syncingRow: Awaited<ReturnType<typeof markSyncing>> = null
					try {
						syncingRow = await markSyncing(row.bookId)
						if (!syncingRow) {
							// Row disappeared concurrently (e.g. already synced by another pass).
							continue
						}

						const { id, input } = toMutationInput(syncingRow)
						await sdk.execute(UPDATE_READ_PROGRESS, { id, input })
						await markSyncedIfUnchanged(row.bookId, syncingRow.updatedAt)
					} catch (error) {
						console.error('Failed to flush offline reading progress for book', row.bookId, error)
						if (syncingRow) {
							const reason = error instanceof Error ? error.message : 'Unknown error'
							await markErrorIfUnchanged(row.bookId, syncingRow.updatedAt, reason)
						}
					}
				}
			} finally {
				isFlushingRef.current = false
			}
		}

		flush()

		window.addEventListener('online', flush)
		return () => window.removeEventListener('online', flush)
	}, [sdk])
}
