import type { MediaProgressInput } from '@stump/graphql'

import { getDB, type ProgressOutboxRecord } from './db'

/**
 * Upserts a progress record for `bookId`, accumulating `elapsedSecondsDelta` into any
 * existing unsynced row so repeated failures (e.g. offline page turns) don't lose time.
 * The latest position (page/epubcfi/percentage/isComplete) always wins. Always resets
 * status to `UNSYNCED` -- a row picked up mid-flush (`SYNCING`) that fails again, or a
 * fresh failure superseding an `ERROR` row, both need to be retried.
 */
export async function enqueueProgress(
	record: Omit<ProgressOutboxRecord, 'status' | 'updatedAt'>,
): Promise<void> {
	const db = await getDB()
	const existing = await db.get('progressOutbox', record.bookId)

	const merged: ProgressOutboxRecord = {
		...record,
		elapsedSecondsDelta: (existing?.elapsedSecondsDelta ?? 0) + record.elapsedSecondsDelta,
		status: 'UNSYNCED',
		updatedAt: Date.now(),
	}

	await db.put('progressOutbox', merged)
}

/** All rows not yet synced to the server (i.e. not currently mid-flush with no failure). */
export async function listUnsynced(): Promise<ProgressOutboxRecord[]> {
	const db = await getDB()
	return db.getAllFromIndex('progressOutbox', 'by-status', 'UNSYNCED')
}

/** A successful replay -- the row's job is done, so it's deleted outright. */
export async function markSynced(bookId: string): Promise<void> {
	const db = await getDB()
	await db.delete('progressOutbox', bookId)
}

/** A replay attempt failed; keep the row (so it can be retried) but record why. */
export async function markError(bookId: string, reason: string): Promise<void> {
	const db = await getDB()
	const existing = await db.get('progressOutbox', bookId)
	if (!existing) {
		return
	}
	await db.put('progressOutbox', {
		...existing,
		status: 'ERROR',
		failureReason: reason,
		updatedAt: Date.now(),
	})
}

/** Marks a row as actively being replayed, so a concurrent flush doesn't double-send it. */
export async function markSyncing(bookId: string): Promise<void> {
	const db = await getDB()
	const existing = await db.get('progressOutbox', bookId)
	if (!existing) {
		return
	}
	await db.put('progressOutbox', { ...existing, status: 'SYNCING', updatedAt: Date.now() })
}

/**
 * Rebuilds the exact `updateMediaProgress` GraphQL variables for a given outbox row.
 *
 * NOTE: `MediaProgressInput`'s epub variant (`EpubProgressInput`, see
 * packages/graphql/src/client/graphql.ts) nests the cfi under `locator: { epubcfi }`
 * rather than the flat `{ epubcfi }` described in the plan doc's Global Constraints --
 * this follows the actual generated schema (and the existing EpubJsReader usage) so the
 * replay lands as a valid mutation.
 */
export function toMutationInput(r: ProgressOutboxRecord): {
	id: string
	input: MediaProgressInput
} {
	if (r.kind === 'epub') {
		return {
			id: r.bookId,
			input: {
				epub: {
					locator: { epubcfi: r.epubcfi as string },
					percentage: r.percentage,
					isComplete: r.isComplete,
					elapsedSecondsDelta: r.elapsedSecondsDelta,
				},
			},
		}
	}

	return {
		id: r.bookId,
		input: {
			paged: {
				page: r.page as number,
				elapsedSecondsDelta: r.elapsedSecondsDelta,
			},
		},
	}
}
