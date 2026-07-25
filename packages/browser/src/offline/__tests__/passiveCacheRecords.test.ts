import 'fake-indexeddb/auto'

import { deleteDB } from 'idb'

import { _resetDBForTests } from '../db'
import {
	decrementPassiveCacheTotal,
	deletePassiveCacheEntries,
	getPassiveCacheEntry,
	getPassiveCacheTotal,
	listPassiveCacheEntriesByAccess,
	markPassiveCacheEntryValidated,
	putPassiveCacheEntry,
	replacePassiveCacheEntry,
	setPassiveCacheTotal,
	touchPassiveCacheEntry,
} from '../passiveCacheRecords'

describe('passiveCacheRecords', () => {
	beforeEach(async () => {
		// `getDB()` caches a single open connection (see db.ts); close it before deleting
		// the database, otherwise the still-open connection from the previous test blocks
		// `deleteDB` indefinitely instead of rejecting it.
		await _resetDBForTests()
		await deleteDB('longbox-offline')
	})

	describe('putPassiveCacheEntry', () => {
		it('inserts a new row and adds its size to the running total', async () => {
			const total = await putPassiveCacheEntry('/page/1', 100)

			expect(total).toBe(100)
			expect(await getPassiveCacheTotal()).toBe(100)

			const rows = await listPassiveCacheEntriesByAccess()
			expect(rows).toHaveLength(1)
			expect(rows[0]).toMatchObject({ url: '/page/1', sizeBytes: 100 })
		})

		it('accumulates the total across distinct urls', async () => {
			await putPassiveCacheEntry('/page/1', 100)
			const total = await putPassiveCacheEntry('/page/2', 250)

			expect(total).toBe(350)
			expect(await getPassiveCacheTotal()).toBe(350)
		})

		it('is idempotent per url: a repeat put touches lastAccessedAt but does not double-count size', async () => {
			const firstTotal = await putPassiveCacheEntry('/page/1', 100)
			expect(firstTotal).toBe(100)

			const secondTotal = await putPassiveCacheEntry('/page/1', 100)

			expect(secondTotal).toBe(100)
			expect(await getPassiveCacheTotal()).toBe(100)

			const rows = await listPassiveCacheEntriesByAccess()
			expect(rows).toHaveLength(1)
		})

		it('a repeat put advances lastAccessedAt', async () => {
			jest.useFakeTimers().setSystemTime(1000)
			await putPassiveCacheEntry('/page/1', 100)

			jest.setSystemTime(2000)
			await putPassiveCacheEntry('/page/1', 100)

			const [row] = await listPassiveCacheEntriesByAccess()
			expect(row?.lastAccessedAt).toBe(2000)

			jest.useRealTimers()
		})
	})

	describe('validators (etag / lastValidatedAt)', () => {
		it('stores the etag alongside the bytes, and stamps lastValidatedAt', async () => {
			jest.useFakeTimers().setSystemTime(1000)

			await putPassiveCacheEntry('/page/1', 100, 'W/"abc"')

			const entry = await getPassiveCacheEntry('/page/1')
			expect(entry).toMatchObject({ etag: 'W/"abc"', lastValidatedAt: 1000 })

			jest.useRealTimers()
		})

		it('omits etag entirely (rather than storing undefined) when the writer had no headers', async () => {
			await putPassiveCacheEntry('/page/1', 100)

			const entry = await getPassiveCacheEntry('/page/1')
			expect(entry).toBeDefined()
			expect('etag' in (entry as object)).toBe(false)
		})

		it('getPassiveCacheEntry returns undefined for an untracked url', async () => {
			expect(await getPassiveCacheEntry('/unknown')).toBeUndefined()
		})

		it('markPassiveCacheEntryValidated advances only lastValidatedAt, leaving size/etag/LRU alone', async () => {
			jest.useFakeTimers().setSystemTime(1000)
			await putPassiveCacheEntry('/page/1', 100, 'W/"abc"')

			jest.setSystemTime(50_000)
			await markPassiveCacheEntryValidated('/page/1')

			expect(await getPassiveCacheEntry('/page/1')).toMatchObject({
				sizeBytes: 100,
				etag: 'W/"abc"',
				lastAccessedAt: 1000,
				lastValidatedAt: 50_000,
			})
			expect(await getPassiveCacheTotal()).toBe(100)

			jest.useRealTimers()
		})

		it('markPassiveCacheEntryValidated is a no-op for an untracked url', async () => {
			await markPassiveCacheEntryValidated('/unknown')

			expect(await listPassiveCacheEntriesByAccess()).toHaveLength(0)
		})
	})

	describe('replacePassiveCacheEntry', () => {
		it('adjusts the running total by the size DELTA, not by the new size', async () => {
			await putPassiveCacheEntry('/thumb', 535_012)
			await putPassiveCacheEntry('/other', 1000)

			// The real case: a 535KB full-res JPEG thumbnail regenerated as a 42KB WebP.
			const total = await replacePassiveCacheEntry('/thumb', 42_332, 'W/"new"')

			expect(total).toBe(42_332 + 1000)
			expect(await getPassiveCacheTotal()).toBe(43_332)
			expect(await getPassiveCacheEntry('/thumb')).toMatchObject({
				sizeBytes: 42_332,
				etag: 'W/"new"',
			})
		})

		it('handles a replacement that grows the entry', async () => {
			await putPassiveCacheEntry('/thumb', 100)

			const total = await replacePassiveCacheEntry('/thumb', 250)

			expect(total).toBe(250)
		})

		it('preserves LRU recency: a replacement is not an access', async () => {
			jest.useFakeTimers().setSystemTime(1000)
			await putPassiveCacheEntry('/thumb', 100)

			jest.setSystemTime(9999)
			await replacePassiveCacheEntry('/thumb', 50)

			expect(await getPassiveCacheEntry('/thumb')).toMatchObject({
				lastAccessedAt: 1000,
				lastValidatedAt: 9999,
			})

			jest.useRealTimers()
		})

		it('reads the total freshly committed at call time, not a value the caller captured earlier', async () => {
			await putPassiveCacheEntry('/thumb', 500)

			// Simulates a concurrent passive write committing while a revalidation was in flight.
			await putPassiveCacheEntry('/concurrent', 50)

			const total = await replacePassiveCacheEntry('/thumb', 100)

			// 550 - 400 (the delta), so the concurrent +50 survives; computing 100 + <stale snapshot>
			// outside the transaction would have dropped it.
			expect(total).toBe(150)
		})

		it('inserts a tracked row (counting the full size) if the row was evicted mid-revalidation', async () => {
			const total = await replacePassiveCacheEntry('/thumb', 100, 'W/"new"')

			expect(total).toBe(100)
			expect(await getPassiveCacheEntry('/thumb')).toMatchObject({ sizeBytes: 100 })
		})

		it('floors the total at 0 rather than going negative', async () => {
			await putPassiveCacheEntry('/thumb', 100)
			await setPassiveCacheTotal(10)

			const total = await replacePassiveCacheEntry('/thumb', 1)

			expect(total).toBe(0)
		})
	})

	describe('touchPassiveCacheEntry', () => {
		it('advances lastAccessedAt for an existing row', async () => {
			jest.useFakeTimers().setSystemTime(1000)
			await putPassiveCacheEntry('/page/1', 100)

			jest.setSystemTime(5000)
			await touchPassiveCacheEntry('/page/1')

			const [row] = await listPassiveCacheEntriesByAccess()
			expect(row?.lastAccessedAt).toBe(5000)
			expect(row?.sizeBytes).toBe(100)

			jest.useRealTimers()
		})

		it('is a no-op when no row exists for the url', async () => {
			await touchPassiveCacheEntry('/unknown')

			expect(await listPassiveCacheEntriesByAccess()).toHaveLength(0)
			expect(await getPassiveCacheTotal()).toBe(0)
		})
	})

	describe('listPassiveCacheEntriesByAccess', () => {
		it('returns rows oldest-accessed first', async () => {
			jest.useFakeTimers().setSystemTime(300)
			await putPassiveCacheEntry('/page/newest', 10)

			jest.setSystemTime(100)
			await putPassiveCacheEntry('/page/oldest', 10)

			jest.setSystemTime(200)
			await putPassiveCacheEntry('/page/middle', 10)

			const rows = await listPassiveCacheEntriesByAccess()
			expect(rows.map((row) => row.url)).toEqual(['/page/oldest', '/page/middle', '/page/newest'])

			jest.useRealTimers()
		})
	})

	describe('deletePassiveCacheEntries', () => {
		it('removes exactly the given urls, leaving the rest', async () => {
			await putPassiveCacheEntry('/a', 10)
			await putPassiveCacheEntry('/b', 20)
			await putPassiveCacheEntry('/c', 30)

			await deletePassiveCacheEntries(['/a', '/c'])

			const rows = await listPassiveCacheEntriesByAccess()
			expect(rows.map((row) => row.url)).toEqual(['/b'])
		})

		it('is a no-op for an empty array', async () => {
			await putPassiveCacheEntry('/a', 10)

			await deletePassiveCacheEntries([])

			expect(await listPassiveCacheEntriesByAccess()).toHaveLength(1)
		})
	})

	describe('decrementPassiveCacheTotal', () => {
		it('deletes the given rows and subtracts deltaBytes from the running total, in one transaction', async () => {
			await putPassiveCacheEntry('/a', 100)
			await putPassiveCacheEntry('/b', 250)

			const total = await decrementPassiveCacheTotal(['/a'], 100)

			expect(total).toBe(250)
			expect(await getPassiveCacheTotal()).toBe(250)
			const rows = await listPassiveCacheEntriesByAccess()
			expect(rows.map((row) => row.url)).toEqual(['/b'])
		})

		it('reads the total freshly committed at call time, not a value the caller captured earlier', async () => {
			await putPassiveCacheEntry('/a', 100)

			// Simulates a concurrent atomic increment (e.g. another `putPassiveCacheEntry` call)
			// committing after some caller last read the total but before this decrement runs.
			await putPassiveCacheEntry('/concurrent', 50)

			const total = await decrementPassiveCacheTotal(['/a'], 100)

			// 150 (100 + 50) - 100, not 100 - 100 = 0 -- the concurrent +50 must survive.
			expect(total).toBe(50)
			expect(await getPassiveCacheTotal()).toBe(50)
		})

		it('floors the total at 0 rather than going negative', async () => {
			await putPassiveCacheEntry('/a', 10)

			const total = await decrementPassiveCacheTotal(['/a'], 999)

			expect(total).toBe(0)
			expect(await getPassiveCacheTotal()).toBe(0)
		})

		it('is a no-op deletion for an empty urls array but still decrements the total', async () => {
			await putPassiveCacheEntry('/a', 100)

			const total = await decrementPassiveCacheTotal([], 40)

			expect(total).toBe(60)
			const rows = await listPassiveCacheEntriesByAccess()
			expect(rows.map((row) => row.url)).toEqual(['/a'])
		})
	})

	describe('getPassiveCacheTotal / setPassiveCacheTotal', () => {
		it('returns 0 before any row/meta write', async () => {
			expect(await getPassiveCacheTotal()).toBe(0)
		})

		it('setPassiveCacheTotal overwrites the tracked total directly', async () => {
			await putPassiveCacheEntry('/page/1', 100)

			await setPassiveCacheTotal(42)

			expect(await getPassiveCacheTotal()).toBe(42)
		})
	})
})
