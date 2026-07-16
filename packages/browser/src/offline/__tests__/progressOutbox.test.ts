import 'fake-indexeddb/auto'

import { deleteDB } from 'idb'

import { _resetDBForTests } from '../db'
import {
	enqueueProgress,
	listPending,
	markErrorIfUnchanged,
	markSyncedIfUnchanged,
	markSyncing,
	recoverStuckSyncing,
	toMutationInput,
} from '../progressOutbox'

describe('progressOutbox', () => {
	beforeEach(async () => {
		// `getDB()` caches a single open connection (see db.ts); close it before deleting
		// the database, otherwise the still-open connection from the previous test blocks
		// `deleteDB` indefinitely instead of rejecting it.
		await _resetDBForTests()
		await deleteDB('longbox-offline')
	})

	it('enqueues a paged record and lists it', async () => {
		await enqueueProgress({ bookId: 'b1', kind: 'paged', page: 5, elapsedSecondsDelta: 30 })
		const rows = await listPending()
		expect(rows).toHaveLength(1)
		expect(rows[0]).toMatchObject({
			bookId: 'b1',
			page: 5,
			elapsedSecondsDelta: 30,
			status: 'UNSYNCED',
		})
	})

	it('accumulates elapsed delta on repeated enqueue for the same book', async () => {
		await enqueueProgress({ bookId: 'b1', kind: 'paged', page: 5, elapsedSecondsDelta: 30 })
		await enqueueProgress({ bookId: 'b1', kind: 'paged', page: 8, elapsedSecondsDelta: 12 })
		const rows = await listPending()
		expect(rows).toHaveLength(1)
		expect(rows[0]?.page).toBe(8) // latest position wins
		expect(rows[0]?.elapsedSecondsDelta).toBe(42) // time accumulates
	})

	it('markSyncedIfUnchanged removes the row when unchanged', async () => {
		await enqueueProgress({ bookId: 'b1', kind: 'paged', page: 5, elapsedSecondsDelta: 30 })
		const syncing = await markSyncing('b1')
		expect(syncing).not.toBeNull()

		const result = await markSyncedIfUnchanged('b1', syncing!.updatedAt)
		expect(result).toBe(true)
		expect(await listPending()).toHaveLength(0)
	})

	it('toMutationInput rebuilds paged and epub variables', async () => {
		const paged = toMutationInput({
			bookId: 'b1',
			kind: 'paged',
			page: 5,
			elapsedSecondsDelta: 30,
			status: 'UNSYNCED',
			updatedAt: 0,
		})
		expect(paged).toEqual({ id: 'b1', input: { paged: { page: 5, elapsedSecondsDelta: 30 } } })

		// NOTE: MediaProgressInput's epub variant (packages/graphql/src/client/graphql.ts)
		// nests the cfi under `locator: { epubcfi }` rather than the flat shape in the plan
		// doc's Global Constraints -- adapted to match the actual generated schema so this
		// replays through the real `updateMediaProgress` mutation.
		const epub = toMutationInput({
			bookId: 'b2',
			kind: 'epub',
			epubcfi: 'x',
			percentage: 0.5,
			isComplete: false,
			elapsedSecondsDelta: 10,
			status: 'UNSYNCED',
			updatedAt: 0,
		})
		expect(epub).toEqual({
			id: 'b2',
			input: {
				epub: {
					locator: { epubcfi: 'x' },
					percentage: 0.5,
					isComplete: false,
					elapsedSecondsDelta: 10,
				},
			},
		})
	})

	describe('retry durability (ERROR/SYNCING rows are not permanently excluded)', () => {
		it('listPending includes ERROR rows, not just UNSYNCED', async () => {
			await enqueueProgress({ bookId: 'b1', kind: 'paged', page: 5, elapsedSecondsDelta: 30 })
			const syncing = await markSyncing('b1')
			await markErrorIfUnchanged('b1', syncing!.updatedAt, 'network down')

			const rows = await listPending()
			expect(rows).toHaveLength(1)
			expect(rows[0]).toMatchObject({
				bookId: 'b1',
				status: 'ERROR',
				failureReason: 'network down',
			})
		})

		it('excludes a row actively SYNCING (not yet orphaned)', async () => {
			await enqueueProgress({ bookId: 'b1', kind: 'paged', page: 5, elapsedSecondsDelta: 30 })
			await markSyncing('b1')

			expect(await listPending()).toHaveLength(0)
		})

		it('recoverStuckSyncing flips an orphaned SYNCING row back to UNSYNCED, rejoining listPending', async () => {
			await enqueueProgress({ bookId: 'b1', kind: 'paged', page: 5, elapsedSecondsDelta: 30 })
			await markSyncing('b1') // simulates a flush that crashed before recording an outcome
			expect(await listPending()).toHaveLength(0)

			await recoverStuckSyncing()

			const rows = await listPending()
			expect(rows).toHaveLength(1)
			expect(rows[0]).toMatchObject({ bookId: 'b1', status: 'UNSYNCED' })
		})

		it('recoverStuckSyncing does not disturb UNSYNCED or ERROR rows', async () => {
			await enqueueProgress({ bookId: 'unsynced', kind: 'paged', page: 1, elapsedSecondsDelta: 1 })
			await enqueueProgress({ bookId: 'errored', kind: 'paged', page: 2, elapsedSecondsDelta: 2 })
			const syncing = await markSyncing('errored')
			await markErrorIfUnchanged('errored', syncing!.updatedAt, 'boom')

			await recoverStuckSyncing()

			const rows = await listPending()
			expect(rows).toHaveLength(2)
			expect(rows.find((r) => r.bookId === 'unsynced')).toMatchObject({ status: 'UNSYNCED' })
			expect(rows.find((r) => r.bookId === 'errored')).toMatchObject({ status: 'ERROR' })
		})
	})

	describe('optimistic concurrency (lost-update race between an in-flight flush and a concurrent enqueue)', () => {
		it('markSyncedIfUnchanged returns false and does NOT delete when updatedAt changed since the snapshot', async () => {
			await enqueueProgress({ bookId: 'b1', kind: 'paged', page: 20, elapsedSecondsDelta: 5 })
			const syncing = await markSyncing('b1') // snapshot taken; network call "in flight" from here

			// A concurrent enqueue lands while the (simulated) network call is still in flight.
			await enqueueProgress({ bookId: 'b1', kind: 'paged', page: 25, elapsedSecondsDelta: 3 })

			const result = await markSyncedIfUnchanged('b1', syncing!.updatedAt)
			expect(result).toBe(false)

			// The fresher row must survive, untouched, for a later flush to pick up.
			const rows = await listPending()
			expect(rows).toHaveLength(1)
			expect(rows[0]).toMatchObject({ bookId: 'b1', page: 25, status: 'UNSYNCED' })
			// The delta from the stale in-flight send is preserved too -- it was never
			// confirmed synced, so it must not be dropped.
			expect(rows[0]?.elapsedSecondsDelta).toBe(8)
		})

		it('markSyncedIfUnchanged returns true and deletes when unchanged', async () => {
			await enqueueProgress({ bookId: 'b1', kind: 'paged', page: 20, elapsedSecondsDelta: 5 })
			const syncing = await markSyncing('b1')

			const result = await markSyncedIfUnchanged('b1', syncing!.updatedAt)
			expect(result).toBe(true)
			expect(await listPending()).toHaveLength(0)
		})

		it('markErrorIfUnchanged preserves the newer row when changed (does not stomp it with ERROR)', async () => {
			await enqueueProgress({ bookId: 'b1', kind: 'paged', page: 20, elapsedSecondsDelta: 5 })
			const syncing = await markSyncing('b1')

			await enqueueProgress({ bookId: 'b1', kind: 'paged', page: 25, elapsedSecondsDelta: 3 })

			const result = await markErrorIfUnchanged('b1', syncing!.updatedAt, 'network down')
			expect(result).toBe(false)

			const rows = await listPending()
			expect(rows).toHaveLength(1)
			// Still the fresher, untouched UNSYNCED row -- not stomped into ERROR with the
			// stale failure reason, and not left stuck as SYNCING either.
			expect(rows[0]).toMatchObject({ bookId: 'b1', page: 25, status: 'UNSYNCED' })
			expect(rows[0]?.failureReason).toBeUndefined()
		})

		it('markErrorIfUnchanged sets ERROR (and keeps the accumulated delta) when unchanged', async () => {
			await enqueueProgress({ bookId: 'b1', kind: 'paged', page: 20, elapsedSecondsDelta: 5 })
			const syncing = await markSyncing('b1')

			const result = await markErrorIfUnchanged('b1', syncing!.updatedAt, 'network down')
			expect(result).toBe(true)

			const rows = await listPending()
			expect(rows).toHaveLength(1)
			expect(rows[0]).toMatchObject({
				bookId: 'b1',
				page: 20,
				elapsedSecondsDelta: 5,
				status: 'ERROR',
				failureReason: 'network down',
			})
		})
	})
})
