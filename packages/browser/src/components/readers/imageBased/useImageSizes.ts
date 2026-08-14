import { useCallback, useEffect, useMemo, useState } from 'react'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import { IImageBaseReaderContext, ImagePageDimensionRef } from './context'

type Params = Pick<IImageBaseReaderContext, 'book'>

export function useImageSizes({ book: { id, analysisData } }: Params) {
	const cache = useSizeStore((state) => state.cache)
	const cachedSizes = useMemo(() => cache[id]?.imageSizes ?? {}, [cache, id])

	const [initialSizes] = useState(
		() =>
			analysisData?.dimensions
				?.map(({ height, width }) => ({
					height,
					width,
					ratio: width / height,
				}))
				.reduce(
					(acc, ref, index) => {
						acc[index] = ref
						return acc
					},
					{} as Record<number, { height: number; width: number; ratio: number }>,
				) ?? {},
	)

	const imageSizes = useMemo(
		() => ({
			...cachedSizes,
			...initialSizes,
		}),
		[cachedSizes, initialSizes],
	)

	const setPageSize = useCallback(
		(page: number, dimensions: ImagePageDimensionRef) => {
			queuePageSize(id, page, dimensions)
		},
		[id],
	)

	// The buffer below is flushed on an animation frame, which never arrives while the tab is
	// hidden. Without these, dimensions measured just before backgrounding or closing the tab would
	// simply be dropped -- they were written synchronously before batching.
	useEffect(() => {
		window.addEventListener('pagehide', flushPendingSizes)
		return () => {
			window.removeEventListener('pagehide', flushPendingSizes)
			flushPendingSizes()
		}
	}, [])

	return {
		imageSizes,
		setPageSize,
	}
}

/**
 * Dimensions waiting to be folded into the store, keyed by book id. See {@link queuePageSize}.
 */
const pendingSizes = new Map<string, Record<number, ImagePageDimensionRef>>()
let pendingFlush: ReturnType<typeof requestAnimationFrame> | undefined

/**
 * Record a page's dimensions, coalescing every call made in the same frame into a single store
 * write.
 *
 * Dimensions arrive one image `onLoad` at a time, and the reader's preview strip alone fires a
 * dozen of them in a frame. Writing each one straight through was quadratically expensive: every
 * `set` re-serializes the *whole* cross-book size cache into localStorage (synchronously, on the
 * main thread) and hands every reader a fresh `imageSizes` identity, which recomputes `pageSets`
 * and re-renders the reader and all of its preview items. Buffering to one write per frame reaches
 * exactly the same end state for a fraction of the work.
 */
function queuePageSize(id: string, page: number, dimensions: ImagePageDimensionRef) {
	pendingSizes.set(id, { ...pendingSizes.get(id), [page]: dimensions })

	if (pendingFlush !== undefined) return
	// `requestAnimationFrame` rather than a microtask: image loads land in separate tasks, so a
	// microtask would flush each one on its own and coalesce nothing.
	pendingFlush = requestAnimationFrame(flushPendingSizes)
}

/** Fold every buffered dimension into the store. Exported for tests, which cannot await a frame. */
export function flushPendingSizes() {
	if (pendingFlush !== undefined) {
		cancelAnimationFrame(pendingFlush)
		pendingFlush = undefined
	}
	if (!pendingSizes.size) return

	const batch = new Map(pendingSizes)
	pendingSizes.clear()
	useSizeStore.getState().mergeSizes(batch)
}

type SizeCache = {
	imageSizes: Record<number, ImagePageDimensionRef>
}

type ISizeStore = {
	cache: Record<string, SizeCache>
	/** Merge a frame's worth of buffered dimensions, keyed by book id, into the cache. */
	mergeSizes: (batch: Map<string, Record<number, ImagePageDimensionRef>>) => void
}

const useSizeStore = create<ISizeStore>()(
	persist(
		(set) => ({
			cache: {},
			mergeSizes: (batch) =>
				set((state) => {
					const cache = { ...state.cache }
					for (const [key, sizes] of batch) {
						cache[key] = {
							...cache[key],
							imageSizes: { ...cache[key]?.imageSizes, ...sizes },
						}
					}
					return { cache }
				}),
		}),
		{
			name: 'longbox-image-sizes',
		},
	),
)
