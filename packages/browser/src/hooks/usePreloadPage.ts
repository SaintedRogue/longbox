import { queryClient } from '@longbox/client'
import type { Api } from '@longbox/sdk'
import { useEffect, useState } from 'react'

import { ImagePageDimensionRef } from '@/components/readers/imageBased/context'
import { matchUrl } from '@/offline/blobStore'
import { cacheAlreadyFetched, touchAccess } from '@/offline/passiveCache'

type Params = {
	/**
	 * The pages to preload
	 */
	pages: number[]
	/**
	 * A function to build the url for a given page
	 */
	urlBuilder: (page: number) => string
	/**
	 * A callback to store the dimensions of a page after it has been preloaded
	 */
	onStoreDimensions?: (page: number, dimensions: ImagePageDimensionRef) => void
	/**
	 * The authenticated SDK -- used to fetch page bytes (so a Bearer/api-key auth request carries
	 * its credentials, unlike a bare `<img src>`/`new Image()` load) and to feed the passive cache.
	 */
	sdk: Api
}

/** Fetches the bytes for `url`, preferring the offline blob store, then the passive/offline cache,
 *  falling back to a network fetch that's also fed back into the passive cache. Routed through the
 *  same React-Query key AuthImage uses so a concurrent AuthImage fetch and a preload fetch for the
 *  same URL coalesce into a single in-flight request instead of double-fetching. */
async function fetchPageBlob(url: string, sdk: Api): Promise<Blob> {
	const cached = await matchUrl(url)
	if (cached) {
		await touchAccess(url)
		return cached.blob()
	}

	const blob = await queryClient.fetchQuery({
		queryKey: ['AuthImage.fetchImage', url],
		staleTime: 1000 * 60 * 60 * 24 * 5, // 5 days
		queryFn: async () => {
			const response = await sdk.axios.get(url, { responseType: 'blob' })
			return response.data as Blob
		},
	})
	await cacheAlreadyFetched(url, blob)
	return blob
}

/**
 * Page URLs already preloaded (or in flight) in this session.
 *
 * This replaces what used to be a per-hook `useRef<Record<number, boolean>>` keyed by page *number*.
 * That ref was load-bearing -- the preload effect re-runs whenever any of its dependencies change
 * identity (`pages` is a fresh array on every page turn, and `urlBuilder`/`onStoreDimensions` are
 * caller-supplied callbacks), so without a guard every re-run would re-fetch and re-decode the whole
 * window. Two things were wrong with it, and both showed up in a live reader trace of 16 requests
 * for 6 unique pages:
 *
 *  1. Page *numbers* aren't unique across books. Moving from book A to book B kept A's numbers
 *     marked as done, so B's identically-numbered pages were silently never preloaded.
 *  2. It was per-instance, so anything that remounted the reader (or a second reader mounting for a
 *     "next in series" jump) started from an empty map and re-fetched + re-decoded everything.
 *
 * Keying by URL fixes (1); module scope -- deliberately, and matching `passiveCache`'s own
 * session-scoped singletons -- fixes (2), giving the "at most one fetch per page per session"
 * guarantee. A page that fails is un-claimed below so it can be retried.
 */
const preloadedUrls = new Set<string>()

/** Test-only: drops all session claims so cases don't leak "already preloaded" state. */
export function _resetPreloadedUrlsForTests(): void {
	preloadedUrls.clear()
}

/**
 * A hook to preload a list of pages, provided a function to build the url for each page
 *
 * TODO: handle errors a bit better?
 */
export function usePreloadPage({ pages, urlBuilder, onStoreDimensions, sdk }: Params) {
	const [isPreloading, setIsPreloading] = useState(false)

	/**
	 * This effect will attempt to preload all pages by fetching their bytes (offline cache first,
	 * else network) and deriving dimensions from an ImageBitmap -- no DOM `Image` element involved.
	 */
	useEffect(() => {
		// Claim URLs synchronously, before any await, so two effect runs in the same tick (or two
		// readers preloading overlapping windows) can't both pick up the same page.
		const pending = pages
			.map((page) => ({ page, url: urlBuilder(page) }))
			.filter(({ url }) => !preloadedUrls.has(url))

		if (!pending.length) return

		pending.forEach(({ url }) => preloadedUrls.add(url))

		const preloadPage = async ({ page, url }: { page: number; url: string }) => {
			try {
				const blob = await fetchPageBlob(url, sdk)

				const bitmap = await createImageBitmap(blob)
				try {
					if (bitmap.width && bitmap.height) {
						onStoreDimensions?.(page, {
							height: bitmap.height,
							ratio: bitmap.width / bitmap.height,
							width: bitmap.width,
						})
					}
				} finally {
					bitmap.close()
				}
			} catch (error) {
				// Release the claim so a transient failure doesn't permanently blacklist the page.
				preloadedUrls.delete(url)
				throw error
			}
		}

		const preloadPages = async () => {
			setIsPreloading(true)
			const results = await Promise.allSettled(pending.map(preloadPage))
			const errors = results.filter((result) => result.status === 'rejected')
			if (errors.length) {
				console.error(errors)
			}
			setIsPreloading(false)
		}

		preloadPages()
	}, [pages, urlBuilder, onStoreDimensions, sdk])

	return { isPreloading }
}
