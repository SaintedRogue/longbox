import type { Api } from '@longbox/sdk'

import * as blobStore from './blobStore'
import { listDownloadRecords } from './downloadRecords'
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
} from './passiveCacheRecords'

/** Fixed cap for v1 -- no Settings UI / user override. */
export const PASSIVE_CACHE_CAP_BYTES = 750 * 1024 * 1024 // ~750MB

/** A sweep evicts down to ~90% of the cap, not to the exact boundary, so it doesn't re-trigger on the very next write. */
const LOW_WATER_RATIO = 0.9

/**
 * How long a cached entry is trusted without asking the server about it again. Mirrors the
 * `max-age=600` the server sends for derived images (see `DERIVED_IMAGE_CACHE_CONTROL` in
 * `apps/server/src/utils/http.rs`), so the client's revalidation cadence matches the freshness
 * contract the server advertises rather than inventing a second, conflicting one.
 *
 * Without this the cost is quadratic in how much you browse: a 36-cover library page would fire 36
 * conditional GETs on *every* render, since every cover is a cache hit.
 */
export const REVALIDATE_AFTER_MS = 10 * 60 * 1000

/** In-flight de-dup map so concurrent callers writing the same URL don't double-fetch/double-write. */
const inFlightWrites = new Map<string, Promise<void>>()

/** In-flight revalidations, so the same URL rendered twice at once (a cover in a grid and in a
 *  carousel) issues one conditional GET rather than two. Cleared when the revalidation settles. */
const inFlightRevalidations = new Set<string>()

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

async function doCacheAlreadyFetched(url: string, blob: Blob, etag?: string): Promise<void> {
	try {
		const alreadyCached = await blobStore.matchUrl(url)
		if (alreadyCached) {
			await touchAccess(url)
			return
		}

		await blobStore.putUrl(url, new Response(blob))
		const total = await putPassiveCacheEntry(url, blob.size, etag)
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
 *
 * `etag` is the response's strong validator, when the caller had headers in hand; it lets a later
 * `revalidateIfStale` ask a cheap conditional question instead of re-downloading. Callers that only
 * ever hold bytes (AuthImage's object-URL fetch, the reader's page preloader) leave it undefined,
 * which is fine -- those entries just revalidate unconditionally the first time.
 */
export async function cacheAlreadyFetched(url: string, blob: Blob, etag?: string): Promise<void> {
	const existing = inFlightWrites.get(url)
	if (existing) return existing

	const promise = doCacheAlreadyFetched(url, blob, etag).finally(() => {
		inFlightWrites.delete(url)
	})
	inFlightWrites.set(url, promise)
	return promise
}

/**
 * Session-mode passive cache: re-GETs `url` via `sdk.axios` purely to obtain bytes for caching. This
 * relies on the browser's own HTTP cache to satisfy the request without a real network round-trip,
 * since the server sends `Cache-Control: private, max-age=600, stale-while-revalidate=604800` for
 * these URLs and `url` here is byte-identical to what the `<img>` that triggered this just loaded —
 * which just happened, so it is well inside the fresh window. Never throws.
 */
export async function cacheOnView(url: string, sdk: Api): Promise<void> {
	try {
		const response = await sdk.axios.get(url, { responseType: 'blob' })
		await cacheAlreadyFetched(url, response.data, readEtag(response))
	} catch (err) {
		console.error('[passiveCache] cacheOnView failed', err)
	}
}

/**
 * The `ETag` off an axios response, if the header is both present and readable. Axios lowercases
 * header names (`AxiosHeaders` normalizes on set), so `etag` is the correct key.
 *
 * It can legitimately be missing: cross-origin (a dev web server on :3000 talking to the API on
 * :10801) the browser hides every header not named in `Access-Control-Expose-Headers`, and the CORS
 * layer doesn't list `ETag`. That degrades to unconditional revalidation -- correct, just chattier
 * -- rather than to staleness, which is why nothing here treats a missing etag as an error.
 */
function readEtag(response: { headers?: unknown }): string | undefined {
	const headers = response.headers as Record<string, unknown> | undefined
	const etag = headers?.etag
	return typeof etag === 'string' && etag.length > 0 ? etag : undefined
}

/**
 * Stale-while-revalidate for the passive cache: asks the server whether the bytes cached for `url`
 * are still the bytes it would serve, and swaps in the new ones if not.
 *
 * The passive cache is keyed by URL and, until this existed, wrote each entry exactly once -- so a
 * server-side regeneration under a stable URL (thumbnails re-rendered from full-res JPEG to 512px
 * WebP, say) left every client pinned to the old bytes forever, since a cache hit never touched the
 * network at all. That also meant the server's `ETag`/304 revalidation was never reached: a
 * conditional GET can only happen if somebody issues one.
 *
 * Deliberately a *background* side channel, called fire-and-forget from the cache-hit path:
 * - It never blocks or fails the visible image. The cached blob is served immediately, exactly as
 *   before; a failure here (offline, expired auth, a 5xx) leaves it untouched to retry later.
 * - It skips URLs owned by an explicit offline download. Those blobs are a snapshot the user asked
 *   for and the download manager owns; silently rewriting them from under it is not this code's
 *   call. `protectedUrlSet()` is the same ownership test `sweep()` uses.
 * - It is throttled per URL (`REVALIDATE_AFTER_MS`), so browsing doesn't turn every cache hit into
 *   a request.
 *
 * Note the first revalidation of any row written before validators were stored has no `etag` to
 * send, so it is an unconditional GET that replaces the bytes outright -- which is precisely what
 * un-sticks a cache that is already serving stale images. From then on it's a conditional GET and
 * normally a ~200-byte 304.
 */
export async function revalidateIfStale(url: string, sdk: Api): Promise<void> {
	if (inFlightRevalidations.has(url)) return
	inFlightRevalidations.add(url)

	try {
		const entry = await getPassiveCacheEntry(url)
		// Not passively cached: either untracked, or a download's blob that was never logged here.
		if (!entry) return

		if (entry.lastValidatedAt && Date.now() - entry.lastValidatedAt < REVALIDATE_AFTER_MS) return

		if (pendingDownloadUrls.has(url)) return
		const protectedUrls = await protectedUrlSet()
		if (protectedUrls.has(url)) return

		const response = await sdk.axios.get(url, {
			responseType: 'blob',
			headers: {
				// Defeat the *browser's* HTTP cache. It holds a second, older copy of these bytes and
				// is the reason a naive re-GET does nothing: entries fetched before the server's cache
				// policy changed were stored under `max-age=31536000`, so an ordinary request is
				// answered off disk, never reaches the origin, and would have us "revalidate" stale
				// bytes against themselves. Measured in Chromium against a server replaying exactly
				// that policy: a plain XHR re-GET after the origin had regenerated the resource
				// returned the old bytes without a single request reaching the origin.
				//
				// `Cache-Control: no-cache` (with `Pragma` for HTTP/1.0-era intermediaries) means
				// "use your stored copy only after revalidating it with the origin", which forces the
				// round trip. `no-store` would also reach the origin, but it tells the browser not to
				// use or update its cache at all -- and on the no-etag path below, `no-cache` was
				// measured to additionally *correct* the browser's poisoned entry, which `no-store`
				// would leave in place for the next plain <img> load.
				'Cache-Control': 'no-cache',
				Pragma: 'no-cache',
				// An explicit conditional header is independently sufficient to reach the origin
				// (Chromium treats caller-supplied validators as "external validation" and passes the
				// request through), at the cost of the browser not updating its own entry from the
				// result -- also measured. Harmless: once the bytes below land in the passive cache,
				// this URL is served from a blob and the browser's copy is never consulted again.
				...(entry.etag ? { 'If-None-Match': entry.etag } : {}),
			},
			// A 304 is the *expected*, cheap answer -- not an error. Without this axios rejects it.
			validateStatus: (status) => status === 200 || status === 304,
		})

		if (response.status === 304) {
			await markPassiveCacheEntryValidated(url)
			return
		}

		const blob = response.data as Blob
		// A 200 with no body is never a legitimate image, and this path overwrites bytes that are
		// currently rendering fine. Keeping what we have and retrying next window is strictly better
		// than replacing every cover with a blank because a proxy dropped a body.
		if (!blob?.size) return

		await blobStore.putUrl(url, new Response(blob))
		const total = await replacePassiveCacheEntry(url, blob.size, readEtag(response))
		if (total > PASSIVE_CACHE_CAP_BYTES) {
			await sweep()
		}
	} catch (err) {
		console.error('[passiveCache] revalidateIfStale failed', err)
	} finally {
		inFlightRevalidations.delete(url)
	}
}

/** Test-only: drops all in-flight revalidation claims so cases don't leak across each other. */
export function _resetRevalidationsForTests(): void {
	inFlightRevalidations.clear()
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
