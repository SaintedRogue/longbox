import { queryClient } from '@longbox/client'
import type { Api } from '@longbox/sdk'
import { useEffect, useRef, useState } from 'react'

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
 * A hook to preload a list of pages, provided a function to build the url for each page
 *
 * TODO: handle errors a bit better?
 */
export function usePreloadPage({ pages, urlBuilder, onStoreDimensions, sdk }: Params) {
	const [isPreloading, setIsPreloading] = useState(false)

	const preloadRef = useRef<Record<number, boolean>>({})

	/**
	 * This effect will attempt to preload all pages by fetching their bytes (offline cache first,
	 * else network) and deriving dimensions from an ImageBitmap -- no DOM `Image` element involved.
	 */
	useEffect(() => {
		const filteredPages = pages.filter((page) => !preloadRef.current[page])
		const shouldPreload = filteredPages.length > 0

		if (!shouldPreload) return

		filteredPages.forEach((page) => {
			preloadRef.current[page] = true
		})

		const preloadPage = async (page: number) => {
			const url = urlBuilder(page)
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
		}

		const preloadPages = async () => {
			setIsPreloading(true)
			const results = await Promise.allSettled(filteredPages.map(preloadPage))
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
