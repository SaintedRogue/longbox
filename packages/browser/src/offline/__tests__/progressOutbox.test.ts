import 'fake-indexeddb/auto'

import { deleteDB } from 'idb'

import { _resetDBForTests } from '../db'
import { enqueueProgress, listUnsynced, markSynced, toMutationInput } from '../progressOutbox'

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
		const rows = await listUnsynced()
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
		const rows = await listUnsynced()
		expect(rows).toHaveLength(1)
		expect(rows[0]?.page).toBe(8) // latest position wins
		expect(rows[0]?.elapsedSecondsDelta).toBe(42) // time accumulates
	})

	it('markSynced removes the row', async () => {
		await enqueueProgress({ bookId: 'b1', kind: 'paged', page: 5, elapsedSecondsDelta: 30 })
		await markSynced('b1')
		expect(await listUnsynced()).toHaveLength(0)
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
})
