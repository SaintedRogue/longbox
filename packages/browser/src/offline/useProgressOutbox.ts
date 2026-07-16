import { useSDK } from '@stump/client'
import { useEffect, useRef } from 'react'

import { UPDATE_READ_PROGRESS } from './progressMutation'
import { listUnsynced, markError, markSyncing, markSynced, toMutationInput } from './progressOutbox'

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
				const rows = await listUnsynced()
				for (const row of rows) {
					try {
						await markSyncing(row.bookId)
						const { id, input } = toMutationInput(row)
						await sdk.execute(UPDATE_READ_PROGRESS, { id, input })
						await markSynced(row.bookId)
					} catch (error) {
						console.error('Failed to flush offline reading progress for book', row.bookId, error)
						const reason = error instanceof Error ? error.message : 'Unknown error'
						await markError(row.bookId, reason)
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
