import { act, renderHook } from '@testing-library/react'

import { flushPendingSizes, useImageSizes } from '../useImageSizes'

const book = (id: string) =>
	({ id, analysisData: null }) as Parameters<typeof useImageSizes>[0]['book']

const dimensions = (width: number, height: number) => ({ width, height, ratio: width / height })

describe('useImageSizes', () => {
	beforeEach(() => {
		localStorage.clear()
		jest.restoreAllMocks()
	})

	it('exposes a stored page size once the batch flushes', () => {
		const { result, rerender } = renderHook(() => useImageSizes({ book: book('stored') }))

		act(() => {
			result.current.setPageSize(0, dimensions(1000, 1500))
			flushPendingSizes()
		})
		rerender()

		expect(result.current.imageSizes[0]).toEqual(dimensions(1000, 1500))
	})

	/**
	 * Every store write re-serializes the whole cross-book cache into localStorage and hands every
	 * reader a fresh `imageSizes` identity, which recomputes page sets and re-renders the reader
	 * and all of its previews. The preview strip fires a dozen `onLoad`s in a frame, so writing
	 * each one straight through made opening the toolbar visibly janky.
	 */
	it('coalesces a frame of page sizes into a single persisted write', () => {
		const setItem = jest.spyOn(Storage.prototype, 'setItem')
		const { result } = renderHook(() => useImageSizes({ book: book('coalesced') }))

		act(() => {
			for (let page = 0; page < 12; page++) {
				result.current.setPageSize(page, dimensions(1000, 1500))
			}
			flushPendingSizes()
		})

		expect(setItem).toHaveBeenCalledTimes(1)
	})

	it('keeps every page in the coalesced batch', () => {
		const { result, rerender } = renderHook(() => useImageSizes({ book: book('batched') }))

		act(() => {
			result.current.setPageSize(0, dimensions(1000, 1500))
			result.current.setPageSize(1, dimensions(2000, 1500))
			flushPendingSizes()
		})
		rerender()

		expect(Object.keys(result.current.imageSizes)).toEqual(['0', '1'])
		expect(result.current.imageSizes[1]?.ratio).toBeCloseTo(2000 / 1500)
	})

	it('keeps books separate when their sizes are batched together', () => {
		const a = renderHook(() => useImageSizes({ book: book('a') }))
		const b = renderHook(() => useImageSizes({ book: book('b') }))

		act(() => {
			a.result.current.setPageSize(0, dimensions(1000, 1500))
			b.result.current.setPageSize(0, dimensions(500, 800))
			flushPendingSizes()
		})
		a.rerender()
		b.rerender()

		expect(a.result.current.imageSizes[0]).toEqual(dimensions(1000, 1500))
		expect(b.result.current.imageSizes[0]).toEqual(dimensions(500, 800))
	})
})
