import type { MediaProgressInput } from '@stump/graphql'

import { getDB, type ProgressOutboxRecord } from './db'

// `updatedAt` doubles as the optimistic-concurrency token every check-and-write helper
// below compares against (see markSyncedIfUnchanged/markErrorIfUnchanged). Plain
// `Date.now()` has only millisecond resolution, so two writes to the same row that happen
// within the same millisecond -- e.g. markSyncing immediately followed by a synchronous
// enqueueProgress, which is exactly the race this module exists to guard against -- could
// collide and produce identical timestamps, silently defeating the guard (a "changed" row
// would look "unchanged"). A monotonic counter, seeded from wall time but never allowed to
// repeat or go backwards, guarantees every stamp is unique regardless of call frequency.
let lastTimestamp = 0
function nextTimestamp(): number {
	const now = Date.now()
	lastTimestamp = now > lastTimestamp ? now : lastTimestamp + 1
	return lastTimestamp
}

/**
 * Upserts a progress record for `bookId`, accumulating `elapsedSecondsDelta` into any
 * existing row (regardless of its current status -- see listPending's doc comment on why
 * UNSYNCED/ERROR/SYNCING are all still "live") so repeated failures (e.g. offline page
 * turns) don't lose time. The latest position (page/epubcfi/percentage/isComplete) always
 * wins. Always resets status to `UNSYNCED` and stamps a fresh `updatedAt` -- the fresh
 * timestamp is what lets a flush in flight for the old value detect it has been
 * superseded (see markSyncedIfUnchanged/markErrorIfUnchanged) instead of clobbering this
 * newer write or silently dropping it.
 */
export async function enqueueProgress(
	record: Omit<ProgressOutboxRecord, 'status' | 'updatedAt'>,
): Promise<void> {
	const db = await getDB()
	const tx = db.transaction('progressOutbox', 'readwrite')
	const existing = await tx.store.get(record.bookId)

	const merged: ProgressOutboxRecord = {
		...record,
		elapsedSecondsDelta: (existing?.elapsedSecondsDelta ?? 0) + record.elapsedSecondsDelta,
		status: 'UNSYNCED',
		updatedAt: nextTimestamp(),
	}

	await tx.store.put(merged)
	await tx.done
}

/**
 * All rows still owed to the server: both `UNSYNCED` (never attempted, or a previous
 * attempt's failure was recorded) and `ERROR` (an attempt failed) are retriable -- only a
 * row currently `SYNCING` is excluded, because it's actively (or was, until
 * `recoverStuckSyncing` reclaims orphans) being replayed by an in-flight flush.
 */
export async function listPending(): Promise<ProgressOutboxRecord[]> {
	const db = await getDB()
	const [unsynced, errored] = await Promise.all([
		db.getAllFromIndex('progressOutbox', 'by-status', 'UNSYNCED'),
		db.getAllFromIndex('progressOutbox', 'by-status', 'ERROR'),
	])
	return [...unsynced, ...errored]
}

/**
 * Flips any row stuck `SYNCING` back to `UNSYNCED` so it rejoins the retry set. A `SYNCING`
 * row is only ever supposed to be a brief in-flight marker set by `markSyncing` immediately
 * before the network call; one found sitting in that state at the start of a flush is an
 * orphan from a flush that never got to record its outcome (the tab crashed or was closed
 * mid-request) -- without this, that row would be permanently excluded from `listPending`
 * and its progress silently lost forever. Call once, before `listPending`, at the start of
 * every flush.
 */
export async function recoverStuckSyncing(): Promise<void> {
	const db = await getDB()
	const tx = db.transaction('progressOutbox', 'readwrite')
	const stuck = await tx.store.index('by-status').getAll('SYNCING')
	await Promise.all(
		stuck.map((row) => tx.store.put({ ...row, status: 'UNSYNCED', updatedAt: nextTimestamp() })),
	)
	await tx.done
}

/**
 * Marks a row as actively being replayed (so a concurrent flush pass doesn't double-send
 * it) and stamps a fresh `updatedAt`. Returns the updated record -- including that fresh
 * timestamp -- so the caller can snapshot it as the `expectedUpdatedAt` guard for
 * `markSyncedIfUnchanged`/`markErrorIfUnchanged`: a concurrent `enqueueProgress` for the
 * same book always bumps `updatedAt` again, so a mismatch on completion means "a fresher
 * update has since superseded the one that was just sent." Returns null if the row no
 * longer exists (e.g. it was synced and removed by a different flush pass in the interim).
 */
export async function markSyncing(bookId: string): Promise<ProgressOutboxRecord | null> {
	const db = await getDB()
	const tx = db.transaction('progressOutbox', 'readwrite')
	const existing = await tx.store.get(bookId)
	if (!existing) {
		await tx.done
		return null
	}
	const syncing: ProgressOutboxRecord = {
		...existing,
		status: 'SYNCING',
		updatedAt: nextTimestamp(),
	}
	await tx.store.put(syncing)
	await tx.done
	return syncing
}

/**
 * A successful replay -- but only deletes the row if it's unchanged since the snapshot
 * that was actually sent (`expectedUpdatedAt`, from `markSyncing`). If a fresher update
 * was enqueued for this book while the network call was in flight, `updatedAt` has moved
 * on and this is a no-op (returns false): the newer row must survive to be picked up by a
 * later flush, and blindly deleting it here would silently lose that update forever
 * (it was already replaced by the reader locally, so the server response for the *stale*
 * send is not proof the *fresher* one landed).
 */
export async function markSyncedIfUnchanged(
	bookId: string,
	expectedUpdatedAt: number,
): Promise<boolean> {
	const db = await getDB()
	const tx = db.transaction('progressOutbox', 'readwrite')
	const existing = await tx.store.get(bookId)
	if (!existing || existing.updatedAt !== expectedUpdatedAt) {
		await tx.done
		return false
	}
	await tx.store.delete(bookId)
	await tx.done
	return true
}

/**
 * A replay attempt failed; keep the row (so it can be retried) but record why -- again only
 * if unchanged since the snapshot that was sent. If a fresher update superseded it while
 * the failed attempt was in flight, leave that newer `UNSYNCED` row alone rather than
 * stomping it with `ERROR` (which would also discard whatever position it holds in favor
 * of the stale failed one).
 */
export async function markErrorIfUnchanged(
	bookId: string,
	expectedUpdatedAt: number,
	reason: string,
): Promise<boolean> {
	const db = await getDB()
	const tx = db.transaction('progressOutbox', 'readwrite')
	const existing = await tx.store.get(bookId)
	if (!existing || existing.updatedAt !== expectedUpdatedAt) {
		await tx.done
		return false
	}
	await tx.store.put({
		...existing,
		status: 'ERROR',
		failureReason: reason,
		updatedAt: nextTimestamp(),
	})
	await tx.done
	return true
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
