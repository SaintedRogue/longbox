import 'fake-indexeddb/auto'

import { deleteDB, openDB } from 'idb'

import { _setCacheStorageForTests, matchUrl, putUrl } from '../blobStore'
import { _resetDBForTests, getDB } from '../db'

const ALL_STORES = ['downloadQueue', 'downloads', 'progressOutbox'].sort()

const PASSIVE_STORES = ['passiveCacheEntries', 'passiveCacheMeta']

/** Lightweight fake "response": blobStore only ever reads `.blob().size` off one. */
function fakeResponse(size: number): Response {
	return { blob: () => Promise.resolve({ size }) } as unknown as Response
}

function requestKey(request: RequestInfo | URL): string {
	if (typeof request === 'string') return request
	if (request instanceof URL) return request.toString()
	return (request as Request).url
}

/** In-memory stand-in for the `longbox-offline-v1` CacheStorage bucket (jsdom has no Cache API). */
class FakeCache {
	store = new Map<string, Response>()

	async put(request: RequestInfo | URL, response: Response): Promise<void> {
		this.store.set(requestKey(request), response)
	}
	async match(request: RequestInfo | URL): Promise<Response | undefined> {
		return this.store.get(requestKey(request))
	}
	async delete(request: RequestInfo | URL): Promise<boolean> {
		return this.store.delete(requestKey(request))
	}
	async keys(): Promise<ReadonlyArray<Request>> {
		return Array.from(this.store.keys()).map((url) => ({ url }) as unknown as Request)
	}
}

/** Replicates the v3 schema (the last version that had the passive-cache stores) on disk. */
async function seedV3Database() {
	const db = await openDB('longbox-offline', 3, {
		upgrade(db) {
			const outbox = db.createObjectStore('progressOutbox', { keyPath: 'bookId' })
			outbox.createIndex('by-status', 'status')
			db.createObjectStore('downloads', { keyPath: 'bookId' })
			const queue = db.createObjectStore('downloadQueue', { keyPath: 'id', autoIncrement: true })
			queue.createIndex('by-status', 'status')
			const entries = db.createObjectStore('passiveCacheEntries', { keyPath: 'url' })
			entries.createIndex('by-last-accessed', 'lastAccessedAt')
			db.createObjectStore('passiveCacheMeta', { keyPath: 'id' })
		},
	})
	return db
}

// A downloaded book, plus the URLs of blobs the passive cache left in the same bucket.
const DOWNLOADED_PAGES = [
	'http://localhost:10801/api/v2/media/downloaded/page/1',
	'http://localhost:10801/api/v2/media/downloaded/page/2',
]
const DOWNLOADED_THUMB = 'http://localhost:10801/api/v2/media/downloaded/thumbnail'
const DOWNLOADED_FILE = 'http://localhost:10801/api/v2/media/epub-book/file'
const PASSIVE_COVER = 'http://localhost:10801/api/v2/media/browsed/thumbnail'
const PASSIVE_PAGE = 'http://localhost:10801/api/v2/media/browsed/page/1'

describe('db', () => {
	let cache: FakeCache

	beforeEach(async () => {
		// `getDB()` caches a single open connection (see db.ts); close it before deleting
		// the database, otherwise the still-open connection from the previous test blocks
		// `deleteDB` indefinitely instead of rejecting it.
		await _resetDBForTests()
		await deleteDB('longbox-offline')
		cache = new FakeCache()
		_setCacheStorageForTests({ open: async () => cache })
	})

	afterEach(() => {
		_setCacheStorageForTests(null)
	})

	it('fresh install (v4) has the three live stores and neither retired passive-cache store', async () => {
		const db = await getDB()

		expect(Array.from(db.objectStoreNames).sort()).toEqual(ALL_STORES)
	})

	it('v1 -> v4 upgrade preserves progressOutbox data', async () => {
		// Replicate ONLY the v1 progressOutbox store creation, opened directly with `idb`'s
		// `openDB` (bypassing db.ts's cached connection/version), to simulate a client that
		// already has a v1 database on disk.
		const v1db = await openDB('longbox-offline', 1, {
			upgrade(db) {
				const store = db.createObjectStore('progressOutbox', { keyPath: 'bookId' })
				store.createIndex('by-status', 'status')
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
		// and closed directly; reset it so the next getDB() call actually reopens (at v4).
		await _resetDBForTests()

		const db = await getDB()
		expect(Array.from(db.objectStoreNames).sort()).toEqual(ALL_STORES)
		expect(await db.get('progressOutbox', 'b1')).toMatchObject({
			bookId: 'b1',
			page: 5,
			elapsedSecondsDelta: 30,
			status: 'UNSYNCED',
		})
	})

	it('v2 -> v4 upgrade preserves downloads data', async () => {
		const v2db = await openDB('longbox-offline', 2, {
			upgrade(db) {
				const store = db.createObjectStore('progressOutbox', { keyPath: 'bookId' })
				store.createIndex('by-status', 'status')
				db.createObjectStore('downloads', { keyPath: 'bookId' })
				const q = db.createObjectStore('downloadQueue', { keyPath: 'id', autoIncrement: true })
				q.createIndex('by-status', 'status')
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

		await _resetDBForTests()

		const db = await getDB()
		expect(Array.from(db.objectStoreNames).sort()).toEqual(ALL_STORES)
		expect(await db.get('downloads', 'b1')).toMatchObject({ bookId: 'b1', title: 'Book One' })
	})

	it('v3 -> v4 upgrade drops both passive-cache stores and preserves the download library', async () => {
		const v3db = await seedV3Database()
		await v3db.put('downloads', {
			bookId: 'downloaded',
			title: 'Downloaded Book',
			format: 'cbz',
			pageUrls: DOWNLOADED_PAGES,
			thumbnailUrl: DOWNLOADED_THUMB,
			sizeBytes: 300,
			downloadedAt: 999,
		})
		await v3db.put('passiveCacheEntries', {
			url: PASSIVE_COVER,
			sizeBytes: 50,
			lastAccessedAt: 1,
		})
		await v3db.put('passiveCacheMeta', { id: 'singleton', totalBytes: 50 })
		v3db.close()

		await _resetDBForTests()

		const db = await getDB()

		const stores = Array.from(db.objectStoreNames)
		expect(stores.sort()).toEqual(ALL_STORES)
		expect(stores).toEqual(expect.not.arrayContaining(PASSIVE_STORES))
		expect(await db.get('downloads', 'downloaded')).toMatchObject({
			bookId: 'downloaded',
			pageUrls: DOWNLOADED_PAGES,
		})
	})

	it('v3 -> v4 upgrade purges unowned blobs and spares every blob a DownloadRecord claims', async () => {
		const v3db = await seedV3Database()
		// Two downloaded books -- a comic (pages + thumbnail) and an epub (fileUrl) -- so the purge
		// has to honour all three URL fields, not just `pageUrls`.
		await v3db.put('downloads', {
			bookId: 'downloaded',
			title: 'Downloaded Comic',
			format: 'cbz',
			pageUrls: DOWNLOADED_PAGES,
			thumbnailUrl: DOWNLOADED_THUMB,
			sizeBytes: 300,
			downloadedAt: 999,
		})
		await v3db.put('downloads', {
			bookId: 'epub-book',
			title: 'Downloaded Epub',
			format: 'epub',
			fileUrl: DOWNLOADED_FILE,
			sizeBytes: 500,
			downloadedAt: 1000,
		})
		await v3db.put('passiveCacheEntries', {
			url: PASSIVE_COVER,
			sizeBytes: 50,
			lastAccessedAt: 1,
		})
		await v3db.put('passiveCacheMeta', { id: 'singleton', totalBytes: 50 })
		v3db.close()

		// The shared bucket as a real v3 user has it: download blobs and passive residue side by side.
		for (const url of [...DOWNLOADED_PAGES, DOWNLOADED_THUMB, DOWNLOADED_FILE]) {
			await putUrl(url, fakeResponse(100))
		}
		await putUrl(PASSIVE_COVER, fakeResponse(50))
		await putUrl(PASSIVE_PAGE, fakeResponse(70))

		await _resetDBForTests()
		await getDB()

		// The user's offline library is intact -- losing any of these would destroy a downloaded book.
		for (const url of [...DOWNLOADED_PAGES, DOWNLOADED_THUMB, DOWNLOADED_FILE]) {
			expect(await matchUrl(url)).toBeDefined()
		}
		// ...and the passive residue, which nothing tracks any more, is gone rather than stranded.
		expect(await matchUrl(PASSIVE_COVER)).toBeUndefined()
		expect(await matchUrl(PASSIVE_PAGE)).toBeUndefined()
	})

	it('does not purge on a fresh install, where no DownloadRecord could vouch for anything yet', async () => {
		await putUrl(PASSIVE_COVER, fakeResponse(50))

		await getDB()

		expect(await matchUrl(PASSIVE_COVER)).toBeDefined()
	})

	it('does not purge again when an already-migrated (v4) database is reopened', async () => {
		const v3db = await seedV3Database()
		v3db.close()
		await _resetDBForTests()
		await getDB()

		// Second boot: no version change, so nothing may sweep the bucket -- a blob written after the
		// migration (e.g. by a download that has not persisted its record yet) must survive.
		await _resetDBForTests()
		await putUrl(PASSIVE_PAGE, fakeResponse(70))
		await getDB()

		expect(await matchUrl(PASSIVE_PAGE)).toBeDefined()
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
