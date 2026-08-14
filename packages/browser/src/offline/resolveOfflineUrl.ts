import { useEffect, useRef, useState } from 'react'

import { matchUrl } from './blobStore'

/**
 * If `url`'s bytes are in the offline blob store, create and return an object URL for them;
 * otherwise null. The CALLER owns the returned object URL and MUST revoke it (URL.revokeObjectURL)
 * when done -- prefer the managed `useOfflineImageSrc` hook in React code.
 *
 * Everything this can resolve is content an explicit "download for offline" job put there: the
 * download fetcher is the only writer of the blob store, and the v3 -> v4 migration purged the
 * blobs the retired passive cache had left in the same bucket. So a hit here is always a
 * user-requested offline copy, and is served as-is -- no revalidation, no staleness bookkeeping.
 * Everything else (covers, pages you merely looked at) misses and falls through to the network,
 * where the browser's own HTTP cache handles reuse via the `ETag` / `Cache-Control` the server sends.
 */
export async function offlineBlobUrl(url: string): Promise<string | null> {
	const resp = await matchOfflineUrl(url)
	if (!resp) return null
	const blob = await resp.blob()
	return URL.createObjectURL(blob)
}

/**
 * Look `url` up in the blob store, falling back to the same URL without its query string.
 *
 * The store is keyed by exact URL (`cache.match` does not ignore the search by default) and the
 * download fetcher writes the plain, unsized URL of each page. Sized variants of the same image --
 * the reader's `?width=` page previews -- are therefore misses that would go to the network, which
 * offline means a blank preview for a book the user deliberately downloaded. A stored full-size
 * copy satisfies a request for a scaled version of the same image, so it is served as-is; it is
 * bigger than asked for, but it is local, correct, and already on the device.
 */
async function matchOfflineUrl(url: string): Promise<Response | undefined> {
	const exact = await matchUrl(url)
	if (exact) return exact

	const queryStart = url.indexOf('?')
	if (queryStart === -1) return undefined
	return matchUrl(url.slice(0, queryStart))
}

/**
 * Returns the cached file bytes for `url` if it's in the offline blob store, else null (the
 * caller then does its own network fetch). Used by the PDF/EPUB readers to prefer a downloaded
 * book's bytes over a network request.
 */
export async function offlineFileBlob(url: string): Promise<Blob | null> {
	const resp = await matchUrl(url)
	if (!resp) return null
	return resp.blob()
}

/**
 * React hook: resolves `url` to an offline object URL when the book was downloaded, else returns
 * `undefined` (so the caller falls back to its normal network src). Revokes the object URL on
 * unmount and whenever `url` changes. Never returns a revoked/stale URL.
 *
 * Each consumer owns its own object URL -- there is no shared cache -- so it's revoked exactly
 * once, on unmount or when `url` changes, and never recreated on every render (the effect only
 * re-runs when `url` changes).
 */
export function useOfflineImageSrc(url: string | undefined): string | undefined {
	const [src, setSrc] = useState<string | undefined>(undefined)
	const createdUrlRef = useRef<string | undefined>(undefined)

	useEffect(() => {
		if (!url) {
			setSrc(undefined)
			return
		}

		let cancelled = false

		offlineBlobUrl(url).then((resolved) => {
			if (cancelled) {
				// Unmounted or `url` changed before this resolved -- this object URL was never
				// exposed to a consumer, so revoke it immediately rather than leaking it.
				if (resolved) URL.revokeObjectURL(resolved)
				return
			}
			createdUrlRef.current = resolved ?? undefined
			setSrc(resolved ?? undefined)
		})

		return () => {
			cancelled = true
			if (createdUrlRef.current) {
				URL.revokeObjectURL(createdUrlRef.current)
				createdUrlRef.current = undefined
			}
			setSrc(undefined)
		}
	}, [url])

	return src
}
