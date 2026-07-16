import { _setCacheStorageForTests, deleteUrls, estimateUsage, matchUrl, putUrl } from '../blobStore'

/** Lightweight fake "response": just enough shape for blobStore's `.blob().size` usage. */
function fakeResponse(size: number): Response {
	return { blob: () => Promise.resolve({ size }) } as unknown as Response
}

function requestKey(request: RequestInfo | URL): string {
	if (typeof request === 'string') return request
	if (request instanceof URL) return request.toString()
	return (request as Request).url
}

/** In-memory fake Cache backed by a Map, keyed by normalized URL string. */
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

/** In-memory fake CacheStorage: a single shared FakeCache regardless of the name it's opened under. */
class FakeCacheStorage {
	open = jest.fn(async (): Promise<FakeCache> => this.cache)
	private cache = new FakeCache()
}

describe('blobStore', () => {
	let fake: FakeCacheStorage

	beforeEach(() => {
		fake = new FakeCacheStorage()
		_setCacheStorageForTests(fake)
	})

	afterEach(() => {
		_setCacheStorageForTests(null)
	})

	it('putUrl then matchUrl returns the same stored response for that URL; unknown URL -> undefined', async () => {
		const response = fakeResponse(100)
		await putUrl('/api/v2/media/1/page/1', response)

		expect(await matchUrl('/api/v2/media/1/page/1')).toBe(response)
		expect(await matchUrl('/api/v2/media/unknown')).toBeUndefined()
	})

	it('putUrl on an already-stored URL overwrites (latest response wins)', async () => {
		const first = fakeResponse(100)
		const second = fakeResponse(200)

		await putUrl('/api/v2/media/1/page/1', first)
		await putUrl('/api/v2/media/1/page/1', second)

		expect(await matchUrl('/api/v2/media/1/page/1')).toBe(second)
	})

	it('deleteUrls removes exactly the given urls and leaves the rest matchable', async () => {
		await putUrl('/a', fakeResponse(10))
		await putUrl('/b', fakeResponse(20))
		await putUrl('/c', fakeResponse(30))

		await deleteUrls(['/a', '/c'])

		expect(await matchUrl('/a')).toBeUndefined()
		expect(await matchUrl('/b')).toBeDefined()
		expect(await matchUrl('/c')).toBeUndefined()
	})

	it('estimateUsage returns entry count and summed blob sizes across all stored entries', async () => {
		await putUrl('/a', fakeResponse(100))
		await putUrl('/b', fakeResponse(250))
		await putUrl('/c', fakeResponse(50))

		expect(await estimateUsage()).toEqual({ entries: 3, bytes: 400 })
	})

	it('opens the cache under the name longbox-offline-v1', async () => {
		await putUrl('/a', fakeResponse(10))

		expect(fake.open).toHaveBeenCalledWith('longbox-offline-v1')
	})
})
