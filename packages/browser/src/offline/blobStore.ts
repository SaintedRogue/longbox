const CACHE_NAME = 'longbox-offline-v1'

// Minimal structural types so a fake satisfies them in tests (jsdom lacks the real Cache API).
type CacheLike = {
	put(request: RequestInfo | URL, response: Response): Promise<void>
	match(request: RequestInfo | URL): Promise<Response | undefined>
	delete(request: RequestInfo | URL): Promise<boolean>
	keys(): Promise<ReadonlyArray<Request>>
}
type CacheStorageLike = { open(name: string): Promise<CacheLike> }

let injectedCacheStorage: CacheStorageLike | null = null

/** Test hook: inject a fake CacheStorage (jsdom has no Cache API); pass null to restore the global. */
export function _setCacheStorageForTests(cs: CacheStorageLike | null): void {
	injectedCacheStorage = cs
}

function cacheStorage(): CacheStorageLike {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const cs = injectedCacheStorage ?? (globalThis as any).caches
	if (!cs) throw new Error('Cache API unavailable')
	return cs
}

function openCache(): Promise<CacheLike> {
	return cacheStorage().open(CACHE_NAME)
}

/** Stores response bytes under the exact url (the Cache API accepts a URL string and builds the Request). */
export async function putUrl(url: string, response: Response): Promise<void> {
	const cache = await openCache()
	await cache.put(url, response)
}

/** Retrieves the response stored for url, or undefined if absent. */
export async function matchUrl(url: string): Promise<Response | undefined> {
	const cache = await openCache()
	return cache.match(url)
}

// The blob store is keyed purely by URL, not by book id -- a `deleteBook(bookId, urls)` signature
// would leave `bookId` unused here. The caller (the download manager) already holds the book's
// URL list from its DownloadRecord, so `deleteUrls(urls)` is the honest primitive.
/** Removes a set of urls (a book's page/file/thumb urls) from the cache. */
export async function deleteUrls(urls: string[]): Promise<void> {
	const cache = await openCache()
	await Promise.all(urls.map((url) => cache.delete(url)))
}

/**
 * Sums stored blob sizes across the whole cache. O(n) over every entry (each `match` + `.blob()`) --
 * intended for occasional totals (e.g. the Downloads scene), not hot paths. Responses returned by
 * a cache `match` are fresh, unconsumed bodies, so no `.clone()` is needed before reading `.blob()`.
 */
export async function estimateUsage(): Promise<{ entries: number; bytes: number }> {
	const cache = await openCache()
	const keys = await cache.keys()

	let entries = 0
	let bytes = 0
	for (const key of keys) {
		const response = await cache.match(key)
		if (!response) continue
		entries += 1
		bytes += (await response.blob()).size
	}

	return { entries, bytes }
}
