import { queryClient } from '@longbox/client'
import type { Api } from '@longbox/sdk'
import { renderHook, waitFor } from '@testing-library/react'

import * as blobStoreModule from '@/offline/blobStore'
import * as passiveCacheModule from '@/offline/passiveCache'

import { _resetPreloadedUrlsForTests, usePreloadPage } from '../usePreloadPage'

jest.mock('@longbox/client', () => ({
	queryClient: { fetchQuery: jest.fn() },
}))

jest.mock('@/offline/blobStore', () => ({
	matchUrl: jest.fn(),
}))

jest.mock('@/offline/passiveCache', () => ({
	cacheAlreadyFetched: jest.fn(),
	touchAccess: jest.fn(),
}))

const mockedMatchUrl = jest.mocked(blobStoreModule.matchUrl)
const mockedCacheAlreadyFetched = jest.mocked(passiveCacheModule.cacheAlreadyFetched)
const mockedTouchAccess = jest.mocked(passiveCacheModule.touchAccess)
const mockedFetchQuery = queryClient.fetchQuery as jest.Mock

/** A "blob" that's just enough shape to identify in assertions (mirrors downloadFetcher.test.ts). */
function fakeBlob(tag: string): Blob {
	return { __tag: tag } as unknown as Blob
}

/** Fake "response": just enough shape for `matchUrl`'s cache-hit `.blob()` usage. */
function fakeResponse(blob: Blob): Response {
	return { blob: () => Promise.resolve(blob) } as unknown as Response
}

type FakeBitmap = { width: number; height: number; close: jest.Mock }
function fakeBitmap(width: number, height: number): FakeBitmap {
	return { width, height, close: jest.fn() }
}

function sdkWithGet(get: jest.Mock): Api {
	return { axios: { get } } as unknown as Api
}

describe('usePreloadPage', () => {
	beforeEach(() => {
		jest.clearAllMocks()
		// The "already preloaded" claim set is module-level (session-scoped by design), so it has to
		// be cleared between cases or a later case reusing a URL would silently be skipped.
		_resetPreloadedUrlsForTests()
		mockedFetchQuery.mockImplementation(async (config: { queryFn: () => Promise<Blob> }) =>
			config.queryFn(),
		)
		mockedTouchAccess.mockResolvedValue(undefined)
		mockedCacheAlreadyFetched.mockResolvedValue(undefined)
		// jsdom has no native createImageBitmap -- mock it globally per the task's guidance.
		;(globalThis as unknown as { createImageBitmap: jest.Mock }).createImageBitmap = jest.fn(
			async () => fakeBitmap(200, 100),
		)
	})

	it('cache hit: reuses blobStore bytes, touches access, never calls fetchQuery or cacheAlreadyFetched', async () => {
		const blob = fakeBlob('cached')
		mockedMatchUrl.mockResolvedValue(fakeResponse(blob))
		const onStoreDimensions = jest.fn()
		const sdk = sdkWithGet(jest.fn())

		renderHook(() =>
			usePreloadPage({
				onStoreDimensions,
				pages: [2],
				sdk,
				urlBuilder: (page) => `/page/${page}`,
			}),
		)

		await waitFor(() => {
			expect(onStoreDimensions).toHaveBeenCalledWith(2, { height: 100, ratio: 2, width: 200 })
		})

		expect(mockedTouchAccess).toHaveBeenCalledWith('/page/2')
		expect(mockedFetchQuery).not.toHaveBeenCalled()
		expect(mockedCacheAlreadyFetched).not.toHaveBeenCalled()
	})

	it('cache miss: fetches via the AuthImage.fetchImage query key and feeds the passive cache', async () => {
		mockedMatchUrl.mockResolvedValue(undefined)
		const blob = fakeBlob('network')
		const get = jest.fn().mockResolvedValue({ data: blob })
		const sdk = sdkWithGet(get)

		renderHook(() =>
			usePreloadPage({
				pages: [3],
				sdk,
				urlBuilder: (page) => `/page/${page}`,
			}),
		)

		await waitFor(() => {
			expect(mockedCacheAlreadyFetched).toHaveBeenCalledWith('/page/3', blob)
		})

		expect(mockedFetchQuery).toHaveBeenCalledWith(
			expect.objectContaining({ queryKey: ['AuthImage.fetchImage', '/page/3'] }),
		)
		expect(get).toHaveBeenCalledWith('/page/3', { responseType: 'blob' })
		expect(mockedTouchAccess).not.toHaveBeenCalled()
	})

	it('derives dimensions from createImageBitmap and closes the bitmap afterwards', async () => {
		mockedMatchUrl.mockResolvedValue(undefined)
		const get = jest.fn().mockResolvedValue({ data: fakeBlob('network') })
		const sdk = sdkWithGet(get)
		const bitmap = fakeBitmap(400, 200)
		;(globalThis as unknown as { createImageBitmap: jest.Mock }).createImageBitmap = jest.fn(
			async () => bitmap,
		)
		const onStoreDimensions = jest.fn()

		renderHook(() =>
			usePreloadPage({ onStoreDimensions, pages: [1], sdk, urlBuilder: () => '/page/1' }),
		)

		await waitFor(() => {
			expect(onStoreDimensions).toHaveBeenCalledWith(1, { height: 200, ratio: 2, width: 400 })
		})
		expect(bitmap.close).toHaveBeenCalledTimes(1)
	})

	it('does not re-preload an already-preloaded page across rerenders, but does preload a newly-added one', async () => {
		mockedMatchUrl.mockResolvedValue(undefined)
		const get = jest.fn().mockResolvedValue({ data: fakeBlob('x') })
		const sdk = sdkWithGet(get)

		const { rerender } = renderHook(
			({ pages }: { pages: number[] }) =>
				usePreloadPage({ pages, sdk, urlBuilder: (p) => `/page/${p}` }),
			{ initialProps: { pages: [1] } },
		)

		await waitFor(() => {
			expect(get).toHaveBeenCalledTimes(1)
		})

		rerender({ pages: [1] })
		// Give an accidental re-fetch a chance to happen before asserting it didn't.
		await new Promise((resolve) => setTimeout(resolve, 0))
		expect(get).toHaveBeenCalledTimes(1)

		rerender({ pages: [1, 2] })
		await waitFor(() => {
			expect(get).toHaveBeenCalledTimes(2)
		})
		expect(get).toHaveBeenNthCalledWith(2, '/page/2', { responseType: 'blob' })
	})

	it('de-dupes by URL, not page number: the same page number in a different book still preloads', async () => {
		mockedMatchUrl.mockResolvedValue(undefined)
		const get = jest.fn().mockResolvedValue({ data: fakeBlob('x') })
		const sdk = sdkWithGet(get)

		const { rerender } = renderHook(
			({ bookId }: { bookId: string }) =>
				usePreloadPage({ pages: [1], sdk, urlBuilder: (p) => `/book/${bookId}/page/${p}` }),
			{ initialProps: { bookId: 'a' } },
		)

		await waitFor(() => {
			expect(get).toHaveBeenCalledTimes(1)
		})
		expect(get).toHaveBeenNthCalledWith(1, '/book/a/page/1', { responseType: 'blob' })

		// Page *number* 1 is already claimed, but book b's page 1 is a different URL -- the old
		// number-keyed bookkeeping skipped it entirely.
		rerender({ bookId: 'b' })

		await waitFor(() => {
			expect(get).toHaveBeenCalledTimes(2)
		})
		expect(get).toHaveBeenNthCalledWith(2, '/book/b/page/1', { responseType: 'blob' })
	})

	it('fetches a page at most once per session, even across a full unmount/remount', async () => {
		mockedMatchUrl.mockResolvedValue(undefined)
		const get = jest.fn().mockResolvedValue({ data: fakeBlob('x') })
		const sdk = sdkWithGet(get)

		const { unmount } = renderHook(() =>
			usePreloadPage({ pages: [7], sdk, urlBuilder: (p) => `/page/${p}` }),
		)
		await waitFor(() => {
			expect(get).toHaveBeenCalledTimes(1)
		})
		unmount()

		renderHook(() => usePreloadPage({ pages: [7], sdk, urlBuilder: (p) => `/page/${p}` }))
		// Give an accidental re-fetch a chance to happen before asserting it didn't.
		await new Promise((resolve) => setTimeout(resolve, 0))

		expect(get).toHaveBeenCalledTimes(1)
	})

	it('releases the claim on a failed page so it can be retried later in the session', async () => {
		mockedMatchUrl.mockResolvedValue(undefined)
		const get = jest
			.fn()
			.mockRejectedValueOnce(new Error('boom'))
			.mockResolvedValue({ data: fakeBlob('x') })
		const sdk = sdkWithGet(get)
		const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})

		const { unmount } = renderHook(() =>
			usePreloadPage({ pages: [4], sdk, urlBuilder: (p) => `/page/${p}` }),
		)
		await waitFor(() => {
			expect(consoleErrorSpy).toHaveBeenCalled()
		})
		unmount()

		renderHook(() => usePreloadPage({ pages: [4], sdk, urlBuilder: (p) => `/page/${p}` }))

		await waitFor(() => {
			expect(get).toHaveBeenCalledTimes(2)
		})
	})

	it('a rejected page fetch is caught by Promise.allSettled and logged, not thrown into the caller', async () => {
		mockedMatchUrl.mockRejectedValue(new Error('offline check failed'))
		const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
		const sdk = sdkWithGet(jest.fn())

		const { result } = renderHook(() =>
			usePreloadPage({ pages: [5], sdk, urlBuilder: () => '/page/5' }),
		)

		await waitFor(() => {
			expect(consoleErrorSpy).toHaveBeenCalled()
		})
		expect(result.current.isPreloading).toBe(false)
	})

	it('sets isPreloading true while in flight and false once settled', async () => {
		mockedMatchUrl.mockResolvedValue(undefined)
		let resolveGet: (value: { data: Blob }) => void = () => {}
		const get = jest.fn(
			() =>
				new Promise((resolve) => {
					resolveGet = resolve
				}),
		)
		const sdk = sdkWithGet(get)

		const { result } = renderHook(() =>
			usePreloadPage({ pages: [1], sdk, urlBuilder: () => '/page/1' }),
		)

		await waitFor(() => {
			expect(result.current.isPreloading).toBe(true)
		})

		resolveGet({ data: fakeBlob('x') })

		await waitFor(() => {
			expect(result.current.isPreloading).toBe(false)
		})
	})
})
