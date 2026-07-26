import type { IDBPDatabase } from 'idb'

import * as blobStore from './blobStore'
import type { DownloadRecord, LongboxOfflineDB } from './db'

/**
 * One-shot cleanup for the retired passive read-through cache (see the v3 -> v4 migration in db.ts).
 *
 * Until v4 the `longbox-offline-v1` CacheStorage bucket held two kinds of blob: the ones an explicit
 * "download for offline" job wrote (owned by a `DownloadRecord`) and the ones the passive cache wrote
 * behind the scenes for every cover and page the user happened to look at. Dropping the passive
 * cache's bookkeeping stores without also dropping its blobs would strand those bytes forever --
 * nothing left in the codebase would even know they exist, let alone be able to evict them. So the
 * upgrade deletes them here, exactly once.
 *
 * Ownership is decided *only* by what a `DownloadRecord` points at (`fileUrl`, `thumbnailUrl`,
 * `pageUrls[]`). Everything else in the bucket is passive residue. Deleting a downloaded book's blobs
 * would silently destroy the user's offline library, so the URL matching below is deliberately built
 * to fail in the safe direction: an unrecognized form leaks a passive blob rather than dropping an
 * owned one.
 *
 * Never throws -- it runs inside `getDB()`, and a browser without a usable Cache API (or a bucket
 * that errors) must still get a working database.
 */
export async function purgeUnownedBlobs(db: IDBPDatabase<LongboxOfflineDB>): Promise<void> {
	try {
		const [records, cachedUrls] = await Promise.all([db.getAll('downloads'), blobStore.listUrls()])
		if (cachedUrls.length === 0) return

		const owned = ownedUrls(records)
		const orphaned = cachedUrls.filter((url) => !owned.has(url))
		if (orphaned.length === 0) return

		await blobStore.deleteUrls(orphaned)
	} catch (err) {
		console.error('[offline] purging passive-cache blobs failed', err)
	}
}

/**
 * Every URL any `DownloadRecord` claims, seeded in both the form the record stores and its resolved
 * absolute form.
 *
 * A record stores the URL exactly as the SDK built it, while `blobStore.listUrls()` returns
 * `Request.url`, which the Cache API has already resolved to absolute. For this app those are the
 * same string (the SDK's URL builders are absolute), but seeding both means a deployment that ever
 * produced a relative URL can only under-match -- leaving a passive blob behind -- instead of
 * mistaking a downloaded book's page for an orphan.
 */
function ownedUrls(records: DownloadRecord[]): Set<string> {
	const urls = new Set<string>()

	for (const record of records) {
		for (const url of [record.fileUrl, record.thumbnailUrl, ...(record.pageUrls ?? [])]) {
			if (!url) continue
			urls.add(url)
			const absolute = toAbsolute(url)
			if (absolute) urls.add(absolute)
		}
	}

	return urls
}

/** `url` resolved against the document base, or null if it can't be resolved (no base, or malformed). */
function toAbsolute(url: string): string | null {
	const base = globalThis.location?.href
	try {
		return new URL(url, base).href
	} catch {
		return null
	}
}
