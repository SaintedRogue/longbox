import 'fake-indexeddb/auto'

import { deleteDB, openDB } from 'idb'

import { _resetDBForTests, getDB } from '../db'

describe('db (v2 migration: downloads + downloadQueue)', () => {
	beforeEach(async () => {
		// `getDB()` caches a single open connection (see db.ts); close it before deleting
		// the database, otherwise the still-open connection from the previous test blocks
		// `deleteDB` indefinitely instead of rejecting it.
		await _resetDBForTests()
		await deleteDB('longbox-offline')
	})

	it('fresh install (v2) has all three stores', async () => {
		const db = await getDB()
		expect(Array.from(db.objectStoreNames).sort()).toEqual(
			['downloadQueue', 'downloads', 'progressOutbox'].sort(),
		)
	})

	it('v1 -> v2 upgrade preserves progressOutbox data and adds the new stores', async () => {
		// Replicate ONLY the v1 progressOutbox store creation, opened directly with `idb`'s
		// `openDB` (bypassing db.ts's cached connection/version), to simulate a client that
		// already has a v1 database on disk.
		const v1db = await openDB('longbox-offline', 1, {
			upgrade(db) {
				if (!db.objectStoreNames.contains('progressOutbox')) {
					const store = db.createObjectStore('progressOutbox', { keyPath: 'bookId' })
					store.createIndex('by-status', 'status')
				}
			},
		})
		await v1db.put('progressOutbox', {
			bookId: 'b1',
			kind: 'paged',
			page: 5,
			elapsedSecondsDelta: 30,
			status: 'UNSYNCED',
			updatedAt: 123,
		})
		v1db.close()

		// The cached connection in db.ts doesn't know about the v1 connection we just opened
		// and closed directly; reset it so the next getDB() call actually reopens (at v2).
		await _resetDBForTests()

		const db = await getDB()
		expect(Array.from(db.objectStoreNames).sort()).toEqual(
			['downloadQueue', 'downloads', 'progressOutbox'].sort(),
		)

		const preserved = await db.get('progressOutbox', 'b1')
		expect(preserved).toMatchObject({
			bookId: 'b1',
			page: 5,
			elapsedSecondsDelta: 30,
			status: 'UNSYNCED',
		})
	})

	it('downloadQueue autoIncrements ids and is queryable by the by-status index', async () => {
		const db = await getDB()

		const id1 = await db.add('downloadQueue', {
			bookId: 'b1',
			title: 'Book One',
			format: 'cbz',
			status: 'pending',
			receivedBytes: 0,
			createdAt: 1,
		})
		const id2 = await db.add('downloadQueue', {
			bookId: 'b2',
			title: 'Book Two',
			format: 'epub',
			status: 'downloading',
			receivedBytes: 100,
			totalBytes: 1000,
			createdAt: 2,
		})

		expect(typeof id1).toBe('number')
		expect(typeof id2).toBe('number')
		expect(id1).not.toBe(id2)

		const all = await db.getAll('downloadQueue')
		expect(all).toHaveLength(2)
		expect(all.map((item) => item.id).sort()).toEqual([id1, id2].sort())

		const pending = await db.getAllFromIndex('downloadQueue', 'by-status', 'pending')
		expect(pending).toHaveLength(1)
		expect(pending[0]).toMatchObject({ bookId: 'b1', status: 'pending' })
	})
})
