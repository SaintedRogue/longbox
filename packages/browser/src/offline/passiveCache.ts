import type { Api } from '@longbox/sdk'

import * as blobStore from './blobStore'
import { listDownloadRecords } from './downloadRecords'
import {
	decrementPassiveCacheTotal,
	deletePassiveCacheEntries,
	getPassiveCacheTotal,
	listPassiveCacheEntriesByAccess,
	putPassiveCacheEntry,
	setPassiveCacheTotal,
	touchPassiveCacheEntry,
} from './passiveCacheRecords'

/** Fixed cap for v1 -- no Settings UI / user override. */
export const PASSIVE_CACHE_CAP_BYTES = 750 * 1024 * 1024 // ~750MB

/** A sweep evicts down to ~90% of the cap, not to the exact boundary, so it doesn't re-trigger on the very next write. */
const LOW_WATER_RATIO = 0.9

/** In-flight de-dup map so concurrent callers writing the same URL don't double-fetch/double-write. */
const inFlightWrites = new Map<string, Promise<void>>()

/** Every `fileUrl`/`thumbnailUrl`/`pageUrls[]` across all current DownloadRecords -- these URLs' blobs
 *  are owned by the download manager, not the passive cache, and must never be evicted by `sweep()`. */
async function protectedUrlSet(): Promise<Set<string>> {
	const records = await listDownloadRecords()
	const urls = new Set<string>()
	for (const record of records) {
		if (record.fileUrl) urls.add(record.fileUrl)
		if (record.thumbnailUrl) urls.add(record.thumbnailUrl)
		for (const url of record.pageUrls ?? []) urls.add(url)
	}
	return urls
}

/**
 * URLs currently being fetched-and-written by an in-progress "download for offline" job (see
 * `markDownloadPending`/`clearDownloadPending`, called from `downloadFetcher.ts`). Closes the window
 * between that fetcher writing a blob and `downloadManager.ts` persisting the finished
 * `DownloadRecord` -- during that window `protectedUrlSet()` (built only from persisted records)
 * can't see the URL yet, but the blob is still actively owned by the in-flight job. Plain module-level
 * singleton: session/tab-scoped is fine, since a reload also kills the in-flight fetch loop itself.
 */
const pendingDownloadUrls = new Set<string>()

/**
 * Claims `url` as belonging to an in-progress download fetch. While claimed, `sweep()` skips the
 * entry entirely (leaves both its log row and its blob untouched) even though no `DownloadRecord`
 * exists for it yet. Always pair with a `clearDownloadPending(url)` in a `finally` so a failed or
 * aborted fetch never leaves the URL permanently marked.
 */
export function markDownloadPending(url: string): void {
	pendingDownloadUrls.add(url)
}

/** Releases a claim added by `markDownloadPending`. Safe to call even if `url` was never claimed. */
export function clearDownloadPending(url: string): void {
	pendingDownloadUrls.delete(url)
}

/** Test-only: clears all in-progress download claims so tests don't leak marks across cases. */
export function _resetPendingDownloadsForTests(): void {
	pendingDownloadUrls.clear()
}

/**
 * Oldest-first eviction down to the low-water mark. A URL claimed via `markDownloadPending` (an
 * in-progress, not-yet-persisted download fetch) is skipped entirely this pass -- neither its row
 * nor its blob is touched -- since ownership of that blob is still ambiguous until the download
 * either completes (absorbed by a `DownloadRecord`, handled by `pruneAbsorbedEntries`) or fails
 * (the claim is released and it's evictable again under normal LRU rules next sweep). For a URL
 * that's already protected (a completed download's `DownloadRecord`), only the stale log row is
 * deleted -- never the blob, since ownership belongs to the download. For an unprotected URL, both
 * the log row and the cached blob are deleted.
 *
 * Every mutation of the running total is an atomic read-modify-write against the value currently
 * committed in IDB (`decrementPassiveCacheTotal`, mirroring `putPassiveCacheEntry`'s atomic
 * increment) rather than a value snapshotted before this function's async Cache-Storage-deletion
 * work -- so a concurrent `putPassiveCacheEntry` commit that lands mid-sweep (e.g. another page
 * finishing its own cache write) is folded in instead of being clobbered by a stale write.
 *
 * Never throws: a failure here must not break the caller that triggered it (a page view or a
 * download completing).
 */
async function sweep(): Promise<void> {
	try {
		const lowWater = PASSIVE_CACHE_CAP_BYTES * LOW_WATER_RATIO
		let total = await getPassiveCacheTotal()
		if (total <= lowWater) return

		const [entries, protectedUrls] = await Promise.all([
			listPassiveCacheEntriesByAccess(),
			protectedUrlSet(),
		])

		for (const entry of entries) {
			if (total <= lowWater) break

			if (pendingDownloadUrls.has(entry.url)) continue

			// Cache-Storage deletion is the slow part; do it before the atomic total update below
			// so the update lands as close as possible to the moment the blob is actually freed.
			if (!protectedUrls.has(entry.url)) {
				await blobStore.deleteUrls([entry.url])
			}

			total = await decrementPassiveCacheTotal([entry.url], entry.sizeBytes)
		}
	} catch (err) {
		console.error('[passiveCache] sweep failed', err)
	}
}

/**
 * Unconditionally prunes passive-cache log rows whose URL has since been absorbed by an explicit
 * download (the row is dead weight: its blob is now owned/protected by the download regardless of
 * the passive log, so keeping the row only pollutes the LRU order and the tracked total). Blobs are
 * never touched here -- only ever the download manager's own removal path deletes a download's blobs.
 */
async function pruneAbsorbedEntries(): Promise<void> {
	const [entries, protectedUrls] = await Promise.all([
		listPassiveCacheEntriesByAccess(),
		protectedUrlSet(),
	])

	const stale = entries.filter((entry) => protectedUrls.has(entry.url))
	if (stale.length === 0) return

	const staleBytes = stale.reduce((sum, entry) => sum + entry.sizeBytes, 0)
	await deletePassiveCacheEntries(stale.map((entry) => entry.url))

	const total = await getPassiveCacheTotal()
	await setPassiveCacheTotal(Math.max(0, total - staleBytes))
}

async function doCacheAlreadyFetched(url: string, blob: Blob): Promise<void> {
	try {
		const alreadyCached = await blobStore.matchUrl(url)
		if (alreadyCached) {
			await touchAccess(url)
			return
		}

		await blobStore.putUrl(url, new Response(blob))
		const total = await putPassiveCacheEntry(url, blob.size)
		if (total > PASSIVE_CACHE_CAP_BYTES) {
			await sweep()
		}
	} catch (err) {
		console.error('[passiveCache] cacheAlreadyFetched failed', err)
	}
}

/**
 * Records that `blob` (bytes already in hand -- no extra network cost) is cached for `url`, unless
 * it's already there (checked via `blobStore.matchUrl`, so a concurrent write from another source,
 * e.g. an explicit download, isn't duplicated). Triggers a `sweep()` if the running total is over
 * the cap after this write. Concurrent callers for the same URL share one in-flight write. Never
 * throws -- this is a best-effort side channel that must not break the visible image.
 */
export async function cacheAlreadyFetched(url: string, blob: Blob): Promise<void> {
	const existing = inFlightWrites.get(url)
	if (existing) return existing

	const promise = doCacheAlreadyFetched(url, blob).finally(() => {
		inFlightWrites.delete(url)
	})
	inFlightWrites.set(url, promise)
	return promise
}

/**
 * Session-mode passive cache: re-GETs `url` via `sdk.axios` purely to obtain bytes for caching. This
 * relies on the browser's own HTTP cache to satisfy the request without a real network round-trip,
 * since the server sends `Cache-Control: private, max-age=31536000` for these URLs and `url` here is
 * byte-identical to what the `<img>` that triggered this just loaded. Never throws.
 */
export async function cacheOnView(url: string, sdk: Api): Promise<void> {
	try {
		const response = await sdk.axios.get(url, { responseType: 'blob' })
		await cacheAlreadyFetched(url, response.data)
	} catch (err) {
		console.error('[passiveCache] cacheOnView failed', err)
	}
}

/** Called on every offline-cache HIT to keep LRU recency accurate. No-op for untracked URLs. Never throws. */
export async function touchAccess(url: string): Promise<void> {
	try {
		await touchPassiveCacheEntry(url)
	} catch (err) {
		console.error('[passiveCache] touchAccess failed', err)
	}
}

/**
 * Run once at startup: prune log rows since absorbed by an explicit download, then sweep if the
 * running total is still over the cap. Never throws.
 */
export async function runStartupMaintenance(): Promise<void> {
	try {
		await pruneAbsorbedEntries()
		const total = await getPassiveCacheTotal()
		if (total > PASSIVE_CACHE_CAP_BYTES) {
			await sweep()
		}
	} catch (err) {
		console.error('[passiveCache] runStartupMaintenance failed', err)
	}
}
