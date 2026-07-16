import 'fake-indexeddb/auto'

import { waitFor } from '@testing-library/react'
import { deleteDB } from 'idb'

import { _setCacheStorageForTests, matchUrl, putUrl } from '../blobStore'
import { _resetDBForTests, type DownloadRecord } from '../db'
import {
	_resetManagerForTests,
	cancel,
	type DownloadFetcher,
	type DownloadFetchResult,
	type DownloadJob,
	enqueue,
	remove,
	retry,
	setDownloadFetcher,
} from '../downloadManager'
import {
	getDownloadRecord,
	isDownloaded,
	listQueueItems,
	putDownloadRecord,
	updateQueueItem,
} from '../downloadRecords'
// Namespace import (alongside the named imports above) so we can `jest.spyOn` the module object
// that `downloadManager.ts` itself calls through -- Babel's CJS interop means both bindings point
// at the same exports object, so the spy intercepts downloadManager's internal calls too.
import * as downloadRecordsModule from '../downloadRecords'
import { useDownloadStore } from '../downloadStore'

/** Lightweight fake "response": just enough shape for blobStore's `.blob().size` usage. */
function fakeResponse(size: number): Response {
	return { blob: () => Promise.resolve({ size }) } as unknown as Response
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

type PendingFetch = {
	resolve: (result: DownloadFetchResult) => void
	reject: (err: unknown) => void
	onProgress: (received: number, total?: number) => void
}

/** A controllable stub fetcher: deferred per-book, can emit progress, honors abort. */
function createStubFetcher() {
	const pending = new Map<string, PendingFetch>()
	const calls: DownloadJob[] = []

	const fetcher: DownloadFetcher = (job, onProgress, signal) => {
		calls.push(job)
		return new Promise<DownloadFetchResult>((resolve, reject) => {
			pending.set(job.bookId, { resolve, reject, onProgress })
			signal.addEventListener('abort', () => {
				pending.delete(job.bookId)
				reject(new DOMException('The operation was aborted', 'AbortError'))
			})
		})
	}

	return {
		fetcher,
		calls,
		resolveJob(bookId: string, result: DownloadFetchResult) {
			pending.get(bookId)?.resolve(result)
			pending.delete(bookId)
		},
		rejectJob(bookId: string, err: unknown) {
			pending.get(bookId)?.reject(err)
			pending.delete(bookId)
		},
		progress(bookId: string, received: number, total?: number) {
			pending.get(bookId)?.onProgress(received, total)
		},
		isPending(bookId: string) {
			return pending.has(bookId)
		},
	}
}

function makeRecord(overrides: Partial<DownloadRecord> = {}): DownloadRecord {
	return {
		bookId: 'b1',
		title: 'Book One',
		format: 'cbz',
		pageCount: 20,
		pageUrls: ['/page/1', '/page/2'],
		sizeBytes: 1024,
		downloadedAt: 1000,
		...overrides,
	}
}

describe('downloadManager', () => {
	let stub: ReturnType<typeof createStubFetcher>

	beforeEach(async () => {
		await _resetDBForTests()
		await deleteDB('longbox-offline')
		_setCacheStorageForTests(new FakeCacheStorage())
		useDownloadStore.getState().reset()
		_resetManagerForTests()

		stub = createStubFetcher()
		setDownloadFetcher(stub.fetcher)
	})

	afterEach(() => {
		_setCacheStorageForTests(null)
	})

	it('1. happy path: resolves to a completed download with no leftover queue item', async () => {
		const result = await enqueue({ bookId: 'b1', title: 'Book One', format: 'epub' })
		expect(result.status).toBe('enqueued')

		stub.progress('b1', 10, 100)
		stub.resolveJob('b1', { fileUrl: 'u', sizeBytes: 100 })

		await waitFor(async () => {
			expect(await isDownloaded('b1')).toBe(true)
		})

		const record = await getDownloadRecord('b1')
		expect(record).toMatchObject({ bookId: 'b1', sizeBytes: 100, fileUrl: 'u' })
		expect(await listQueueItems()).toHaveLength(0)
		expect(useDownloadStore.getState().downloads['b1']?.status).toBe('completed')
	})

	it('2. dedup already-queued: second enqueue for the same pending book is a no-op', async () => {
		const first = await enqueue({ bookId: 'b1', title: 'Book One', format: 'epub' })
		expect(first.status).toBe('enqueued')

		const second = await enqueue({ bookId: 'b1', title: 'Book One', format: 'epub' })
		expect(second.status).toBe('already-queued')

		expect(stub.calls).toHaveLength(1)
	})

	it('3. dedup already-downloaded: enqueue for an already-downloaded book never calls the fetcher', async () => {
		await putDownloadRecord(makeRecord({ bookId: 'b1' }))

		const result = await enqueue({ bookId: 'b1', title: 'Book One', format: 'epub' })
		expect(result.status).toBe('already-downloaded')

		expect(stub.calls).toHaveLength(0)
	})

	it('4. concurrency cap: at most 2 books download at once; a free slot picks up the next pending one', async () => {
		await enqueue({ bookId: 'b1', title: 'Book One', format: 'epub' })
		await enqueue({ bookId: 'b2', title: 'Book Two', format: 'epub' })
		await enqueue({ bookId: 'b3', title: 'Book Three', format: 'epub' })

		const statuses = () =>
			['b1', 'b2', 'b3'].map((id) => useDownloadStore.getState().downloads[id]?.status)
		expect(statuses().filter((s) => s === 'downloading')).toHaveLength(2)
		expect(statuses().filter((s) => s === 'pending')).toHaveLength(1)
		expect(stub.calls.map((c) => c.bookId).sort()).toEqual(['b1', 'b2'])

		stub.resolveJob('b1', { fileUrl: 'u1', sizeBytes: 10 })

		await waitFor(() => {
			expect(useDownloadStore.getState().downloads['b3']?.status).toBe('downloading')
		})
		expect(stub.calls.map((c) => c.bookId).sort()).toEqual(['b1', 'b2', 'b3'])
	})

	it('5. failure: a rejected (non-abort) fetch marks the queue item and store failed, leaves it undownloaded', async () => {
		await enqueue({ bookId: 'b1', title: 'Book One', format: 'epub' })

		stub.rejectJob('b1', new Error('network exploded'))

		await waitFor(() => {
			expect(useDownloadStore.getState().downloads['b1']?.status).toBe('failed')
		})
		expect(useDownloadStore.getState().downloads['b1']?.failureReason).toBe('network exploded')

		const items = await listQueueItems()
		expect(items).toHaveLength(1)
		expect(items[0]).toMatchObject({ status: 'failed', failureReason: 'network exploded' })
		expect(await isDownloaded('b1')).toBe(false)
	})

	it('6. cancel while downloading: aborts the fetcher, leaves no record and no queue item', async () => {
		await enqueue({ bookId: 'b1', title: 'Book One', format: 'epub' })
		expect(useDownloadStore.getState().downloads['b1']?.status).toBe('downloading')

		await cancel('b1')

		await waitFor(async () => {
			expect(await listQueueItems()).toHaveLength(0)
		})
		expect(await isDownloaded('b1')).toBe(false)
		expect(useDownloadStore.getState().downloads['b1']).toBeUndefined()
		expect(stub.isPending('b1')).toBe(false)
	})

	it('6b. cancel of a merely-pending (not yet downloading) book removes it directly', async () => {
		await enqueue({ bookId: 'b1', title: 'Book One', format: 'epub' })
		await enqueue({ bookId: 'b2', title: 'Book Two', format: 'epub' })
		await enqueue({ bookId: 'b3', title: 'Book Three', format: 'epub' }) // stays pending (cap = 2)
		expect(useDownloadStore.getState().downloads['b3']?.status).toBe('pending')

		await cancel('b3')

		const items = await listQueueItems()
		expect(items.map((i) => i.bookId)).not.toContain('b3')
		expect(useDownloadStore.getState().downloads['b3']).toBeUndefined()
	})

	it('7. retry after failure: moves back to pending, then completes normally', async () => {
		await enqueue({ bookId: 'b1', title: 'Book One', format: 'epub' })
		stub.rejectJob('b1', new Error('boom'))
		await waitFor(() => {
			expect(useDownloadStore.getState().downloads['b1']?.status).toBe('failed')
		})

		await retry('b1')

		await waitFor(() => {
			expect(useDownloadStore.getState().downloads['b1']?.status).toBe('downloading')
		})

		stub.resolveJob('b1', { fileUrl: 'u', sizeBytes: 42 })

		await waitFor(async () => {
			expect(await isDownloaded('b1')).toBe(true)
		})
		expect(useDownloadStore.getState().downloads['b1']?.status).toBe('completed')
	})

	it('8. remove: deletes the record + blobs for a completed download', async () => {
		await putUrl('/page/1', fakeResponse(10))
		await putUrl('/page/2', fakeResponse(10))
		await putDownloadRecord(
			makeRecord({ bookId: 'b1', pageUrls: ['/page/1', '/page/2'], fileUrl: undefined }),
		)
		useDownloadStore.getState().upsert('b1', { status: 'completed', receivedBytes: 20 })

		await remove('b1')

		expect(await isDownloaded('b1')).toBe(false)
		expect(await matchUrl('/page/1')).toBeUndefined()
		expect(await matchUrl('/page/2')).toBeUndefined()
		expect(useDownloadStore.getState().downloads['b1']).toBeUndefined()
	})

	it('9. ensurePersisted fires only once across multiple enqueues', async () => {
		const persist = jest.fn(() => Promise.resolve(true))
		const mockStorage = { persist, persisted: jest.fn(() => Promise.resolve(false)) }
		const original = navigator.storage
		Object.defineProperty(navigator, 'storage', { value: mockStorage, configurable: true })

		try {
			await enqueue({ bookId: 'b1', title: 'Book One', format: 'epub' })
			await enqueue({ bookId: 'b2', title: 'Book Two', format: 'epub' })

			expect(persist).toHaveBeenCalledTimes(1)
		} finally {
			Object.defineProperty(navigator, 'storage', { value: original, configurable: true })
		}
	})

	it('10. progress: onProgress updates the live store before completion', async () => {
		await enqueue({ bookId: 'b1', title: 'Book One', format: 'epub' })

		stub.progress('b1', 50, 100)

		await waitFor(() => {
			expect(useDownloadStore.getState().downloads['b1']).toMatchObject({
				receivedBytes: 50,
				totalBytes: 100,
			})
		})
		expect(useDownloadStore.getState().downloads['b1']?.status).toBe('downloading')

		stub.resolveJob('b1', { fileUrl: 'u', sizeBytes: 100 })
		await waitFor(() => {
			expect(useDownloadStore.getState().downloads['b1']?.status).toBe('completed')
		})
	})

	it('11. cancel of a pending item is honored even when pump claims it during the race window (regression)', async () => {
		// Fill both concurrency slots, leaving b3 merely 'pending'.
		await enqueue({ bookId: 'b1', title: 'Book One', format: 'epub' })
		await enqueue({ bookId: 'b2', title: 'Book Two', format: 'epub' })
		await enqueue({ bookId: 'b3', title: 'Book Three', format: 'epub' })
		expect(useDownloadStore.getState().downloads['b3']?.status).toBe('pending')

		// Stall cancel()'s `getQueueItemByBook('b3')` read so we can force pump() to claim b3
		// while cancel() is mid-await -- reproducing the exact interleaving from the review:
		// cancel() takes the "delete the pending queue item" branch, then a racing pump() claim
		// slips in underneath it before the delete lands.
		let releaseCancelRead: () => void = () => {}
		const stalled = new Promise<void>((resolve) => {
			releaseCancelRead = resolve
		})
		const realGetQueueItemByBook = downloadRecordsModule.getQueueItemByBook
		const spy = jest
			.spyOn(downloadRecordsModule, 'getQueueItemByBook')
			.mockImplementation(async (bookId: string) => {
				if (bookId === 'b3') {
					await stalled
				}
				return realGetQueueItemByBook(bookId)
			})

		try {
			// cancel('b3') sees no controller yet (b3 is still pending) and blocks on the stalled read.
			const cancelPromise = cancel('b3')

			// Finish b1 -- its finally-block pump() call is now free to claim b3 for the open slot.
			stub.resolveJob('b1', { fileUrl: 'u1', sizeBytes: 10 })

			// Wait until pump() has claimed b3 AND startJob has reached the fetcher call (i.e. past
			// its own `updateQueueItem` write), so the racing job is genuinely in flight.
			await waitFor(() => {
				expect(stub.isPending('b3')).toBe(true)
			})

			// Now let cancel()'s stalled read resolve; it proceeds to delete the (now-claimed) queue
			// row. The fix must notice the racing claim and abort it instead of just deleting quietly.
			releaseCancelRead()
			await cancelPromise

			// Simulate the racing fetcher completing anyway, exactly as the review describes -- if
			// cancel failed to abort it, this would write a DownloadRecord and resurrect the store
			// entry as 'completed'. (If the fix already aborted the racing job, this is a no-op:
			// the stub's abort listener already dropped it from `pending`.)
			stub.resolveJob('b3', { fileUrl: 'u3', sizeBytes: 30 })

			// Let any (buggy) still-racing async cascade -- putDownloadRecord + the store upsert --
			// fully settle before asserting the terminal state. A `waitFor` that only checks once
			// can otherwise pass on a stale snapshot taken before those writes land, since the
			// `startJob` continuation for b3 is a fire-and-forget promise the test isn't awaiting.
			await new Promise((resolve) => setTimeout(resolve, 50))

			expect(await isDownloaded('b3')).toBe(false)
			expect(useDownloadStore.getState().downloads['b3']).toBeUndefined()
			const items = await listQueueItems()
			expect(items.map((i) => i.bookId)).not.toContain('b3')
			expect(stub.isPending('b3')).toBe(false)
		} finally {
			spy.mockRestore()
		}
	})

	it('12. receivedBytes never lands as undefined/NaN in the store on the pending->downloading transition', async () => {
		await enqueue({ bookId: 'b1', title: 'Book One', format: 'epub' })
		await enqueue({ bookId: 'b2', title: 'Book Two', format: 'epub' })
		await enqueue({ bookId: 'b3', title: 'Book Three', format: 'epub' }) // stays pending

		const [b3Item] = (await listQueueItems()).filter((i) => i.bookId === 'b3')
		expect(b3Item?.id).toBeDefined()
		// Corrupt the persisted row the way a stale/legacy write could -- `receivedBytes` is
		// typed `number` but `Partial` + no `exactOptionalPropertyTypes` lets `undefined` through.
		await updateQueueItem(b3Item!.id as number, { receivedBytes: undefined })

		// Free a slot so pump() claims b3 and runs the pending->downloading upsert under test.
		stub.resolveJob('b1', { fileUrl: 'u1', sizeBytes: 10 })

		await waitFor(() => {
			expect(useDownloadStore.getState().downloads['b3']?.status).toBe('downloading')
		})
		expect(typeof useDownloadStore.getState().downloads['b3']?.receivedBytes).toBe('number')
		expect(useDownloadStore.getState().downloads['b3']?.receivedBytes).toBe(0)
	})
})
