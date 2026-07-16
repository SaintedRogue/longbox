import { useEffect, useRef, useState } from 'react'

import { matchUrl } from './blobStore'

/**
 * If `url`'s bytes are cached in the offline blob store, create and return an object URL for them;
 * otherwise null. The CALLER owns the returned object URL and MUST revoke it (URL.revokeObjectURL)
 * when done -- prefer the managed `useOfflineImageSrc` hook in React code.
 */
export async function offlineBlobUrl(url: string): Promise<string | null> {
	const resp = await matchUrl(url)
	if (!resp) return null
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
	return resp ? resp.blob() : null
}

/**
 * React hook: resolves `url` to an offline object URL when cached, else returns `undefined`
 * (so the caller falls back to its normal network src). Revokes the object URL on unmount and
 * whenever `url` changes. Never returns a revoked/stale URL.
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
