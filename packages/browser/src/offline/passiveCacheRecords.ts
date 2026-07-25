import { getDB, type PassiveCacheEntry } from './db'

export type { PassiveCacheEntry }

const META_ID = 'singleton' as const

/**
 * Upserts a passive-cache log row for `url`. Idempotent per URL: if a row already exists, only its
 * `lastAccessedAt` is touched (recency) -- the existing size is NOT re-added to the running total,
 * otherwise repeat views of the same page would inflate the tracked total past its real disk
 * footprint. Runs the existing-row check, the upsert, and the meta-counter update in one readwrite
 * transaction spanning both stores (mirrors `addQueueItem`'s pattern in downloadRecords.ts) so a
 * concurrent write for the same URL can't race between the check and the write.
 *
 * `etag`, when the writer had response headers in hand, is stored alongside the bytes so a later
 * revalidation can issue a conditional GET; a write always counts as a validation, so
 * `lastValidatedAt` is stamped too (the bytes came straight off the server just now).
 *
 * Returns the running total (bytes) after this write.
 */
export async function putPassiveCacheEntry(
	url: string,
	sizeBytes: number,
	etag?: string,
): Promise<number> {
	const db = await getDB()
	const tx = db.transaction(['passiveCacheEntries', 'passiveCacheMeta'], 'readwrite')
	const [entries, meta] = [
		tx.objectStore('passiveCacheEntries'),
		tx.objectStore('passiveCacheMeta'),
	]

	const existing = await entries.get(url)
	const metaRow = await meta.get(META_ID)
	const currentTotal = metaRow?.totalBytes ?? 0

	if (existing) {
		await entries.put({ ...existing, lastAccessedAt: Date.now() })
		await tx.done
		return currentTotal
	}

	await entries.put(makeEntry({ url, sizeBytes, lastAccessedAt: Date.now(), etag }))
	const newTotal = currentTotal + sizeBytes
	await meta.put({ id: META_ID, totalBytes: newTotal })
	await tx.done
	return newTotal
}

/**
 * Builds a row, omitting `etag` entirely when there isn't one rather than storing an explicit
 * `undefined`, so `'etag' in row` stays an honest "do we have a validator?" test. `lastValidatedAt`
 * is always stamped: every caller of this helper is writing bytes it just received from the server.
 */
function makeEntry({
	url,
	sizeBytes,
	lastAccessedAt,
	etag,
}: {
	url: string
	sizeBytes: number
	lastAccessedAt: number
	etag?: string
}): PassiveCacheEntry {
	return {
		url,
		sizeBytes,
		lastAccessedAt,
		lastValidatedAt: Date.now(),
		...(etag ? { etag } : {}),
	}
}

/** The log row for `url`, or undefined if it isn't tracked by the passive cache. */
export async function getPassiveCacheEntry(url: string): Promise<PassiveCacheEntry | undefined> {
	const db = await getDB()
	return db.get('passiveCacheEntries', url)
}

/**
 * Replaces the tracked size (and validators) of an existing row after a revalidation returned fresh
 * bytes, adjusting the running total by the *delta* rather than by the new size.
 *
 * Follows `putPassiveCacheEntry`/`decrementPassiveCacheTotal`'s pattern exactly: one readwrite
 * transaction spanning both stores, with the total read from the currently-committed meta row
 * *inside* that transaction rather than from a snapshot the caller took before its (slow, async)
 * network + Cache-Storage work. That's what lets a concurrent passive write or a mid-flight sweep
 * compose with this instead of being clobbered -- replacing a 535KB blob with a 42KB one must move
 * the total by -493KB, whatever else committed in the meantime.
 *
 * If the row vanished while the revalidation was in flight (evicted by a concurrent sweep), the
 * bytes just written to the blob store would otherwise be untracked, so a fresh row is inserted and
 * the full size added instead.
 *
 * Returns the running total (bytes) after this replacement.
 */
export async function replacePassiveCacheEntry(
	url: string,
	sizeBytes: number,
	etag?: string,
): Promise<number> {
	const db = await getDB()
	const tx = db.transaction(['passiveCacheEntries', 'passiveCacheMeta'], 'readwrite')
	const [entries, meta] = [
		tx.objectStore('passiveCacheEntries'),
		tx.objectStore('passiveCacheMeta'),
	]

	const existing = await entries.get(url)
	const metaRow = await meta.get(META_ID)
	const currentTotal = metaRow?.totalBytes ?? 0

	const delta = sizeBytes - (existing?.sizeBytes ?? 0)
	const newTotal = Math.max(0, currentTotal + delta)

	await entries.put(
		makeEntry({
			url,
			sizeBytes,
			lastAccessedAt: existing?.lastAccessedAt ?? Date.now(),
			etag,
		}),
	)
	await meta.put({ id: META_ID, totalBytes: newTotal })

	await tx.done
	return newTotal
}

/**
 * Stamps `lastValidatedAt` on an existing row after the server answered a conditional GET with a
 * 304 -- the bytes are current, so nothing else about the row (size, etag, LRU recency) changes,
 * and the running total is untouched. A no-op if `url` has no row.
 */
export async function markPassiveCacheEntryValidated(url: string): Promise<void> {
	const db = await getDB()
	const tx = db.transaction('passiveCacheEntries', 'readwrite')
	const existing = await tx.store.get(url)
	if (!existing) {
		await tx.done
		return
	}
	await tx.store.put({ ...existing, lastValidatedAt: Date.now() })
	await tx.done
}

/**
 * Atomically deletes each of `urls`' `passiveCacheEntries` rows and decrements the running total by
 * `deltaBytes` -- both within one IDB transaction spanning `passiveCacheEntries` and
 * `passiveCacheMeta`, mirroring `putPassiveCacheEntry`'s atomic increment. The total is read fresh
 * from the currently-committed meta row inside this same transaction, never from a snapshot the
 * caller captured earlier -- so this composes correctly with a concurrent `putPassiveCacheEntry`
 * commit (e.g. a page finishing its own cache write mid-sweep) no matter which one commits first.
 *
 * Returns the running total (bytes) after this decrement.
 */
export async function decrementPassiveCacheTotal(
	urls: string[],
	deltaBytes: number,
): Promise<number> {
	const db = await getDB()
	const tx = db.transaction(['passiveCacheEntries', 'passiveCacheMeta'], 'readwrite')
	const [entries, meta] = [
		tx.objectStore('passiveCacheEntries'),
		tx.objectStore('passiveCacheMeta'),
	]

	await Promise.all(urls.map((url) => entries.delete(url)))

	const metaRow = await meta.get(META_ID)
	const currentTotal = metaRow?.totalBytes ?? 0
	const newTotal = Math.max(0, currentTotal - deltaBytes)
	await meta.put({ id: META_ID, totalBytes: newTotal })

	await tx.done
	return newTotal
}

/** Touches `lastAccessedAt` for an existing row (keeps LRU recency accurate on a cache hit); a no-op if `url` has no row. */
export async function touchPassiveCacheEntry(url: string): Promise<void> {
	const db = await getDB()
	const tx = db.transaction('passiveCacheEntries', 'readwrite')
	const existing = await tx.store.get(url)
	if (!existing) {
		await tx.done
		return
	}
	await tx.store.put({ ...existing, lastAccessedAt: Date.now() })
	await tx.done
}

/** All rows, oldest-accessed first -- the LRU eviction order for `sweep()` in passiveCache.ts. */
export async function listPassiveCacheEntriesByAccess(): Promise<PassiveCacheEntry[]> {
	const db = await getDB()
	return db.getAllFromIndex('passiveCacheEntries', 'by-last-accessed')
}

export async function deletePassiveCacheEntries(urls: string[]): Promise<void> {
	if (urls.length === 0) return
	const db = await getDB()
	const tx = db.transaction('passiveCacheEntries', 'readwrite')
	await Promise.all(urls.map((url) => tx.store.delete(url)))
	await tx.done
}

export async function getPassiveCacheTotal(): Promise<number> {
	const db = await getDB()
	const metaRow = await db.get('passiveCacheMeta', META_ID)
	return metaRow?.totalBytes ?? 0
}

export async function setPassiveCacheTotal(totalBytes: number): Promise<void> {
	const db = await getDB()
	await db.put('passiveCacheMeta', { id: META_ID, totalBytes })
}
