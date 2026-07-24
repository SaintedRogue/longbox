import 'fake-indexeddb/auto'

import type { Api } from '@longbox/sdk'
import { deleteDB } from 'idb'

import * as blobStore from '../blobStore'
import { _resetDBForTests, type DownloadRecord } from '../db'
// Namespace import (alongside the named import used by passiveCache.ts itself) so `jest.spyOn`
// intercepts the call passiveCache.ts makes via its own named import -- same trick used in
// downloadManager.test.ts for downloadRecords.
import * as downloadRecordsModule from '../downloadRecords'
import { putDownloadRecord } from '../downloadRecords'
import {
	_resetPendingDownloadsForTests,
	cacheAlreadyFetched,
	cacheOnView,
	clearDownloadPending,
	markDownloadPending,
	PASSIVE_CACHE_CAP_BYTES,
	runStartupMaintenance,
	touchAccess,
} from '../passiveCache'
import {
	getPassiveCacheTotal,
	listPassiveCacheEntriesByAccess,
	putPassiveCacheEntry,
} from '../passiveCacheRecords'

const MB = 1024 * 1024

/** Lightweight fake "response": just enough shape for blobStore's `.blob().size` usage (mirrors blobStore.test.ts). */
function fakeResponse(size: number): Response {
	return { blob: () => Promise.resolve({ size } as unknown as Blob) } as unknown as Response
}

/** A "blob" that's just enough shape for passiveCache to read `.size` off of (mirrors downloadFetcher.test.ts). */
function fakeBlob(size: number): Blob {
	return { size } as unknown as Blob
}

function requestKey(request: RequestInfo | URL): string {
	if (typeof request === 'string') return request
	if (request instanceof URL) return request.toString()
	return (request as Request).url
}

/** In-memory fake Cache backed by a Map, keyed by normalized URL string (mirrors blobStore.test.ts). */
class FakeCache {
	private store = new Map<string, Response>()

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

class FakeCacheStorage {
	async open(): Promise<FakeCache> {
		return this.cache
	}
	private cache = new FakeCache()
}

function makeRecord(overrides: Partial<DownloadRecord> = {}): DownloadRecord {
	return {
		bookId: 'b1',
		title: 'Book One',
		format: 'cbz',
		sizeBytes: 1,
		downloadedAt: 1,
		...overrides,
	}
}

function makeSdk(get: jest.Mock): Api {
	return { axios: { get } } as unknown as Api
}

describe('passiveCache', () => {
	beforeEach(async () => {
		await _resetDBForTests()
		await deleteDB('longbox-offline')
		blobStore._setCacheStorageForTests(new FakeCacheStorage())
		_resetPendingDownloadsForTests()
	})

	afterEach(() => {
		blobStore._setCacheStorageForTests(null)
		jest.useRealTimers()
		jest.restoreAllMocks()
		_resetPendingDownloadsForTests()
	})

	describe('cacheAlreadyFetched', () => {
		it('matchUrl idempotency guard: does not re-store bytes when the url is already cached', async () => {
			await blobStore.putUrl('/page/1', fakeResponse(10))
			const putUrlSpy = jest.spyOn(blobStore, 'putUrl')

			await cacheAlreadyFetched('/page/1', fakeBlob(10))

			expect(putUrlSpy).not.toHaveBeenCalled()
		})

		it('touches lastAccessedAt on a hit when a log row already exists, without double-counting size', async () => {
			await blobStore.putUrl('/page/1', fakeResponse(10))
			jest.useFakeTimers().setSystemTime(1000)
			await putPassiveCacheEntry('/page/1', 10)

			jest.setSystemTime(9999)
			await cacheAlreadyFetched('/page/1', fakeBlob(10))

			const [row] = await listPassiveCacheEntriesByAccess()
			expect(row?.lastAccessedAt).toBe(9999)
			expect(await getPassiveCacheTotal()).toBe(10)
		})

		it('stores bytes and a log row on a miss, updating the running total', async () => {
			await cacheAlreadyFetched('/page/1', fakeBlob(100))

			expect(await blobStore.matchUrl('/page/1')).toBeDefined()
			expect(await getPassiveCacheTotal()).toBe(100)
			const rows = await listPassiveCacheEntriesByAccess()
			expect(rows).toEqual([expect.objectContaining({ url: '/page/1', sizeBytes: 100 })])
		})

		it('dedupes concurrent writes for the same url into a single stored entry', async () => {
			const putUrlSpy = jest.spyOn(blobStore, 'putUrl')

			await Promise.all([
				cacheAlreadyFetched('/page/1', fakeBlob(100)),
				cacheAlreadyFetched('/page/1', fakeBlob(100)),
			])

			expect(putUrlSpy).toHaveBeenCalledTimes(1)
			expect(await getPassiveCacheTotal()).toBe(100)
		})

		it('never throws, even when the underlying blob store rejects', async () => {
			jest.spyOn(blobStore, 'matchUrl').mockRejectedValue(new Error('boom'))
			const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})

			await expect(cacheAlreadyFetched('/page/1', fakeBlob(100))).resolves.toBeUndefined()

			expect(consoleErrorSpy).toHaveBeenCalled()
		})
	})

	describe('touchAccess', () => {
		it('advances lastAccessedAt for an existing row', async () => {
			jest.useFakeTimers().setSystemTime(1000)
			await putPassiveCacheEntry('/page/1', 100)

			jest.setSystemTime(9999)
			await touchAccess('/page/1')

			const [row] = await listPassiveCacheEntriesByAccess()
			expect(row?.lastAccessedAt).toBe(9999)
		})

		it('is a no-op for an untracked url and never throws', async () => {
			await expect(touchAccess('/unknown')).resolves.toBeUndefined()
			expect(await listPassiveCacheEntriesByAccess()).toHaveLength(0)
		})
	})

	describe('cacheOnView', () => {
		it('re-GETs the url via sdk.axios (as a blob) and feeds the bytes into the passive cache', async () => {
			const get = jest.fn().mockResolvedValue({ data: fakeBlob(50) })
			const sdk = makeSdk(get)

			await cacheOnView('/page/1', sdk)

			expect(get).toHaveBeenCalledWith('/page/1', { responseType: 'blob' })
			expect(await getPassiveCacheTotal()).toBe(50)
		})

		it('never throws when the axios request rejects', async () => {
			const get = jest.fn().mockRejectedValue(new Error('network error'))
			const sdk = makeSdk(get)
			const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})

			await expect(cacheOnView('/page/1', sdk)).resolves.toBeUndefined()

			expect(consoleErrorSpy).toHaveBeenCalled()
		})
	})

	describe('sweep (triggered via cacheAlreadyFetched when the write pushes total over the cap)', () => {
		it('protects DownloadRecord urls: prunes the stale log row but never deletes the blob', async () => {
			await putDownloadRecord(makeRecord({ bookId: 'b1', pageUrls: ['/protected/1'] }))

			jest.useFakeTimers().setSystemTime(100)
			await blobStore.putUrl('/protected/1', fakeResponse(1))
			await putPassiveCacheEntry('/protected/1', 400 * MB)

			jest.setSystemTime(200)
			await blobStore.putUrl('/unprotected/1', fakeResponse(1))
			await putPassiveCacheEntry('/unprotected/1', 300 * MB)
			jest.useRealTimers()

			expect(await getPassiveCacheTotal()).toBe(700 * MB)

			const deleteUrlsSpy = jest.spyOn(blobStore, 'deleteUrls')

			// Pushes the running total to 800MB, over the 750MB cap -- triggers an internal sweep().
			await cacheAlreadyFetched('/new-page', fakeBlob(100 * MB))

			const remaining = await listPassiveCacheEntriesByAccess()
			expect(remaining.map((row) => row.url)).toEqual(['/unprotected/1', '/new-page'])

			expect(deleteUrlsSpy).not.toHaveBeenCalledWith(expect.arrayContaining(['/protected/1']))
			// The row is gone (no longer tracked)...
			expect(remaining.some((row) => row.url === '/protected/1')).toBe(false)
			// ...but the blob itself was never touched -- ownership belongs to the download.
			expect(await blobStore.matchUrl('/protected/1')).toBeDefined()
		})

		it('evicts oldest unprotected entries, deleting both the row and the blob', async () => {
			jest.useFakeTimers().setSystemTime(100)
			await blobStore.putUrl('/old/1', fakeResponse(1))
			await putPassiveCacheEntry('/old/1', 400 * MB)

			jest.setSystemTime(200)
			await blobStore.putUrl('/old/2', fakeResponse(1))
			await putPassiveCacheEntry('/old/2', 300 * MB)
			jest.useRealTimers()

			const deleteUrlsSpy = jest.spyOn(blobStore, 'deleteUrls')

			await cacheAlreadyFetched('/new-page', fakeBlob(100 * MB))

			expect(deleteUrlsSpy).toHaveBeenCalledWith(['/old/1'])
			expect(await blobStore.matchUrl('/old/1')).toBeUndefined()
			expect(await blobStore.matchUrl('/old/2')).toBeDefined()

			const remaining = await listPassiveCacheEntriesByAccess()
			expect(remaining.map((row) => row.url)).toEqual(['/old/2', '/new-page'])
		})

		it('does not sweep when the running total stays at or under the cap', async () => {
			await putPassiveCacheEntry('/a', 100 * MB)
			const deleteUrlsSpy = jest.spyOn(blobStore, 'deleteUrls')

			await cacheAlreadyFetched('/b', fakeBlob(50 * MB))

			expect(deleteUrlsSpy).not.toHaveBeenCalled()
			expect(await getPassiveCacheTotal()).toBe(150 * MB)
			expect(await getPassiveCacheTotal()).toBeLessThan(PASSIVE_CACHE_CAP_BYTES)
		})

		it('Bug 1 regression: a concurrent putPassiveCacheEntry commit mid-sweep is not clobbered by a stale total', async () => {
			jest.useFakeTimers().setSystemTime(100)
			await blobStore.putUrl('/old/1', fakeResponse(1))
			await putPassiveCacheEntry('/old/1', 700 * MB)
			jest.useRealTimers()

			expect(await getPassiveCacheTotal()).toBe(700 * MB)

			// Gates blobStore.deleteUrls so we can force a concurrent putPassiveCacheEntry commit to
			// land in the middle of sweep()'s eviction of `/old/1`, before sweep() reads/writes the
			// total -- this is what usePreloadPage's Promise.allSettled over several concurrent pages
			// does in production: another page's cache write commits while a sweep is in flight.
			// `reachedGate` lets the test wait for sweep() to actually be blocked on this call,
			// rather than guessing a fixed number of microtask ticks.
			let releaseDelete: () => void = () => {}
			let signalReachedGate: () => void = () => {}
			const reachedGate = new Promise<void>((resolve) => {
				signalReachedGate = resolve
			})
			const deleteGate = new Promise<void>((resolve) => {
				releaseDelete = resolve
			})
			jest.spyOn(blobStore, 'deleteUrls').mockImplementation(async () => {
				signalReachedGate()
				await deleteGate
			})

			// Pushes the total to 800MB (over the 750MB cap) -- triggers an internal sweep() that
			// starts evicting `/old/1` and immediately awaits the gated `deleteUrls` call above.
			const cachePromise = cacheAlreadyFetched('/new-page', fakeBlob(100 * MB))

			await reachedGate

			// While sweep() is paused mid-eviction, a concurrent page finishes fetching and commits
			// its own atomic increment via putPassiveCacheEntry.
			await putPassiveCacheEntry('/concurrent-page', 10 * MB)

			releaseDelete()
			await cachePromise

			// Final total must reflect BOTH the eviction of `/old/1` (700MB freed) and the concurrent
			// `/concurrent-page` write (10MB added): 700 (old/1) + 100 (new-page) + 10 (concurrent)
			// - 700 (evicted) = 110MB -- not just sweep()'s stale start-of-function snapshot, which
			// would silently drop the concurrent write and land on 100MB instead.
			expect(await getPassiveCacheTotal()).toBe(110 * MB)

			const remaining = (await listPassiveCacheEntriesByAccess()).map((row) => row.url)
			expect(remaining).toEqual(expect.arrayContaining(['/new-page', '/concurrent-page']))
			expect(remaining).not.toContain('/old/1')
		})
	})

	describe('sweep pending-download guard (Bug 2)', () => {
		it('skips a URL claimed by an in-progress (not-yet-persisted) download, then evicts it under normal LRU rules once released', async () => {
			jest.useFakeTimers().setSystemTime(100)
			await blobStore.putUrl('/pending-thumb', fakeResponse(1))
			await putPassiveCacheEntry('/pending-thumb', 400 * MB)

			jest.setSystemTime(200)
			await blobStore.putUrl('/old/1', fakeResponse(1))
			await putPassiveCacheEntry('/old/1', 300 * MB)
			jest.useRealTimers()

			// Simulates downloadFetcher.ts claiming the URL the instant it starts fetching it for a
			// download -- before downloadManager.ts has persisted the DownloadRecord, so
			// `protectedUrlSet()` alone can't see it yet.
			markDownloadPending('/pending-thumb')

			const deleteUrlsSpy = jest.spyOn(blobStore, 'deleteUrls')

			// Pushes the total to 800MB, over the cap -- triggers sweep(), which would otherwise
			// evict `/pending-thumb` first (oldest-accessed).
			await cacheAlreadyFetched('/new-page', fakeBlob(100 * MB))

			expect(deleteUrlsSpy).not.toHaveBeenCalledWith(expect.arrayContaining(['/pending-thumb']))
			expect(await blobStore.matchUrl('/pending-thumb')).toBeDefined()
			const afterFirstSweep = (await listPassiveCacheEntriesByAccess()).map((row) => row.url)
			expect(afterFirstSweep).toContain('/pending-thumb')
			expect(afterFirstSweep).not.toContain('/old/1')

			// Once the claim is released (simulating the download completing or failing), the entry
			// is evictable again under normal LRU rules.
			clearDownloadPending('/pending-thumb')

			await cacheAlreadyFetched('/another-page', fakeBlob(300 * MB))

			expect(deleteUrlsSpy).toHaveBeenCalledWith(['/pending-thumb'])
			expect(await blobStore.matchUrl('/pending-thumb')).toBeUndefined()
		})
	})

	describe('runStartupMaintenance', () => {
		it('prunes rows since absorbed by an explicit download, without touching the blob', async () => {
			await putDownloadRecord(makeRecord({ bookId: 'b1', pageUrls: ['/protected/1'] }))
			await blobStore.putUrl('/protected/1', fakeResponse(1))
			await putPassiveCacheEntry('/protected/1', 10 * MB)
			await putPassiveCacheEntry('/other', 5 * MB)

			const deleteUrlsSpy = jest.spyOn(blobStore, 'deleteUrls')

			await runStartupMaintenance()

			const rows = await listPassiveCacheEntriesByAccess()
			expect(rows.map((r) => r.url)).toEqual(['/other'])
			expect(await getPassiveCacheTotal()).toBe(5 * MB)
			expect(deleteUrlsSpy).not.toHaveBeenCalled()
			expect(await blobStore.matchUrl('/protected/1')).toBeDefined()
		})

		it('sweeps down to the low-water mark if still over the cap after pruning', async () => {
			jest.useFakeTimers().setSystemTime(100)
			await blobStore.putUrl('/a', fakeResponse(1))
			await putPassiveCacheEntry('/a', 400 * MB)

			jest.setSystemTime(200)
			await blobStore.putUrl('/b', fakeResponse(1))
			await putPassiveCacheEntry('/b', 400 * MB) // total 800MB, over the 750MB cap
			jest.useRealTimers()

			await runStartupMaintenance()

			expect(await getPassiveCacheTotal()).toBeLessThanOrEqual(PASSIVE_CACHE_CAP_BYTES * 0.9)
			expect(await blobStore.matchUrl('/a')).toBeUndefined()
			expect(await blobStore.matchUrl('/b')).toBeDefined()
		})

		it('is a no-op when there is nothing to prune and nothing over the cap', async () => {
			await expect(runStartupMaintenance()).resolves.toBeUndefined()
			expect(await getPassiveCacheTotal()).toBe(0)
		})

		it('never throws even if an internal read fails', async () => {
			const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
			jest.spyOn(downloadRecordsModule, 'listDownloadRecords').mockRejectedValue(new Error('boom'))

			await expect(runStartupMaintenance()).resolves.toBeUndefined()

			expect(consoleErrorSpy).toHaveBeenCalled()
		})
	})
})
