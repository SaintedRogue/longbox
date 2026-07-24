import 'fake-indexeddb/auto'

import { deleteDB, openDB } from 'idb'

import { _resetDBForTests, getDB } from '../db'

const ALL_STORES = [
	'downloadQueue',
	'downloads',
	'passiveCacheEntries',
	'passiveCacheMeta',
	'progressOutbox',
].sort()

describe('db (v3 migration: passiveCacheEntries + passiveCacheMeta)', () => {
	beforeEach(async () => {
		// `getDB()` caches a single open connection (see db.ts); close it before deleting
		// the database, otherwise the still-open connection from the previous test blocks
		// `deleteDB` indefinitely instead of rejecting it.
		await _resetDBForTests()
		await deleteDB('longbox-offline')
	})

	it('fresh install (v3) has all five stores', async () => {
		const db = await getDB()
		expect(Array.from(db.objectStoreNames).sort()).toEqual(ALL_STORES)
	})

	it('v1 -> v3 upgrade preserves progressOutbox data and adds the new stores', async () => {
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
		// and closed directly; reset it so the next getDB() call actually reopens (at v3).
		await _resetDBForTests()

		const db = await getDB()
		expect(Array.from(db.objectStoreNames).sort()).toEqual(ALL_STORES)

		const preserved = await db.get('progressOutbox', 'b1')
		expect(preserved).toMatchObject({
			bookId: 'b1',
			page: 5,
			elapsedSecondsDelta: 30,
			status: 'UNSYNCED',
		})
	})

	it('v2 -> v3 upgrade preserves downloads/downloadQueue data and adds the passive-cache stores', async () => {
		// Replicate ONLY the v2 store creation (progressOutbox + downloads + downloadQueue), opened
		// directly with `idb`'s `openDB` (bypassing db.ts's cached connection/version), to simulate
		// a client that already has a v2 database on disk (pre-passive-cache).
		const v2db = await openDB('longbox-offline', 2, {
			upgrade(db) {
				if (!db.objectStoreNames.contains('progressOutbox')) {
					const store = db.createObjectStore('progressOutbox', { keyPath: 'bookId' })
					store.createIndex('by-status', 'status')
				}
				if (!db.objectStoreNames.contains('downloads')) {
					db.createObjectStore('downloads', { keyPath: 'bookId' })
				}
				if (!db.objectStoreNames.contains('downloadQueue')) {
					const q = db.createObjectStore('downloadQueue', { keyPath: 'id', autoIncrement: true })
					q.createIndex('by-status', 'status')
				}
			},
		})
		await v2db.put('downloads', {
			bookId: 'b1',
			title: 'Book One',
			format: 'cbz',
			pageUrls: ['/page/1'],
			sizeBytes: 100,
			downloadedAt: 999,
		})
		v2db.close()

		// The cached connection in db.ts doesn't know about the v2 connection we just opened
		// and closed directly; reset it so the next getDB() call actually reopens (at v3).
		await _resetDBForTests()

		const db = await getDB()
		expect(Array.from(db.objectStoreNames).sort()).toEqual(ALL_STORES)

		const preserved = await db.get('downloads', 'b1')
		expect(preserved).toMatchObject({ bookId: 'b1', title: 'Book One', sizeBytes: 100 })
	})

	it('passiveCacheEntries is keyed by url and queryable by the by-last-accessed index', async () => {
		const db = await getDB()

		await db.put('passiveCacheEntries', { url: '/page/1', sizeBytes: 100, lastAccessedAt: 200 })
		await db.put('passiveCacheEntries', { url: '/page/2', sizeBytes: 50, lastAccessedAt: 100 })

		const byAccess = await db.getAllFromIndex('passiveCacheEntries', 'by-last-accessed')
		expect(byAccess.map((entry) => entry.url)).toEqual(['/page/2', '/page/1'])
	})

	it('passiveCacheMeta stores a single row keyed by id', async () => {
		const db = await getDB()

		await db.put('passiveCacheMeta', { id: 'singleton', totalBytes: 1234 })

		const row = await db.get('passiveCacheMeta', 'singleton')
		expect(row).toEqual({ id: 'singleton', totalBytes: 1234 })
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
