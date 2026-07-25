import type { Api } from '@longbox/sdk'
import { useEffect, useRef, useState } from 'react'

import { matchUrl } from './blobStore'
import { revalidateIfStale, touchAccess } from './passiveCache'

/**
 * If `url`'s bytes are cached in the offline blob store, create and return an object URL for them;
 * otherwise null. The CALLER owns the returned object URL and MUST revoke it (URL.revokeObjectURL)
 * when done -- prefer the managed `useOfflineImageSrc` hook in React code.
 *
 * Passing `sdk` opts the hit into background revalidation (see `revalidateIfStale`): the cached
 * bytes are still returned immediately, but the server gets asked -- at most once per URL per
 * throttle window -- whether they're still current. Without it, a cached URL is served forever,
 * even after the server regenerates what lives there.
 */
export async function offlineBlobUrl(url: string, sdk?: Api): Promise<string | null> {
	const resp = await matchUrl(url)
	if (!resp) return null
	// Fire-and-forget: a cache hit means this URL is being read again, so keep its LRU recency
	// accurate for the passive-cache sweep. Must never block or throw into this resolution path.
	void touchAccess(url)
	// Same shape, same reason: stale-while-revalidate must never delay (or reject) the object URL
	// below. Whatever it finds out lands in the cache for the *next* read of this URL.
	if (sdk) void revalidateIfStale(url, sdk)
	const blob = await resp.blob()
	return URL.createObjectURL(blob)
}

/**
 * Returns the cached file bytes for `url` if it's in the offline blob store, else null (the
 * caller then does its own network fetch). Used by the PDF/EPUB readers to prefer cached bytes
 * over a network request.
 */
export async function offlineFileBlob(url: string): Promise<Blob | null> {
	const resp = await matchUrl(url)
	if (!resp) return null
	void touchAccess(url)
	return resp.blob()
}

/**
 * React hook: resolves `url` to an offline object URL when cached, else returns `undefined`
 * (so the caller falls back to its normal network src). Revokes the object URL on unmount and
 * whenever `url` changes. Never returns a revoked/stale URL.
 *
 * Each consumer owns its own object URL -- there is no shared cache -- so it's revoked exactly
 * once, on unmount or when `url` changes, and never recreated on every render (the effect only
 * re-runs when `url` changes, or on the rare identity change of `sdk`, which `SDKProvider` builds
 * once per baseURL/auth method).
 *
 * `sdk` is optional and only feeds the background revalidation inside `offlineBlobUrl` -- it never
 * affects what this hook returns, when it returns it, or how often it re-renders.
 */
export function useOfflineImageSrc(url: string | undefined, sdk?: Api): string | undefined {
	const [src, setSrc] = useState<string | undefined>(undefined)
	const createdUrlRef = useRef<string | undefined>(undefined)

	useEffect(() => {
		if (!url) {
			setSrc(undefined)
			return
		}

		let cancelled = false

		offlineBlobUrl(url, sdk).then((resolved) => {
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
	}, [url, sdk])

	return src
}
