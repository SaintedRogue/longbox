import type { Api } from '@longbox/sdk'

import { createDownloadFetcher, type FetcherDeps } from '../downloadFetcher'
import type { DownloadFetchResult, DownloadJob } from '../downloadManager'

/** A "blob" that's just enough shape for the fetcher to read `.size` off of. */
type FakeBlob = { size: number }

function makeSdk(get: jest.Mock): Api {
	return {
		axios: { get },
		media: {
			downloadURL: (id: string) => `/api/v2/media/${id}/file`,
			bookPageURL: (id: string, page: number) => `/api/v2/media/${id}/page/${page}`,
			thumbnailURL: (id: string) => `/api/v2/media/${id}/thumbnail`,
		},
	} as unknown as Api
}

function makeDeps(): FetcherDeps & { putBlob: jest.Mock; deleteUrls: jest.Mock } {
	return {
		putBlob: jest.fn(async () => {}),
		deleteUrls: jest.fn(async () => {}),
	}
}

/** Builds an axios.get stub that resolves `{ data: { size } }` per-URL, keyed by exact URL match. */
function sizedGetStub(sizes: Record<string, number>): jest.Mock {
	return jest.fn(async (url: string) => {
		const size = sizes[url]
		if (size === undefined) throw new Error(`unexpected URL requested: ${url}`)
		const data: FakeBlob = { size }
		return { data: data as unknown as Blob }
	})
}

describe('createDownloadFetcher', () => {
	it('1. epub single-file: fetches /file via sdk.axios, stores it, returns fileUrl+thumbnailUrl+sizeBytes', async () => {
		const fileUrl = '/api/v2/media/b1/file'
		const thumbUrl = '/api/v2/media/b1/thumbnail'
		const get = sizedGetStub({ [fileUrl]: 1000, [thumbUrl]: 50 })
		const sdk = makeSdk(get)
		const deps = makeDeps()
		const fetcher = createDownloadFetcher(sdk, deps)
		const job: DownloadJob = { bookId: 'b1', title: 'Book One', format: 'epub' }
		const controller = new AbortController()

		const result = await fetcher(job, jest.fn(), controller.signal)

		expect(get).toHaveBeenCalledWith(fileUrl, expect.objectContaining({ responseType: 'blob' }))
		expect(deps.putBlob).toHaveBeenCalledWith(fileUrl, expect.objectContaining({ size: 1000 }))
		expect(result).toEqual<DownloadFetchResult>({
			fileUrl,
			thumbnailUrl: thumbUrl,
			sizeBytes: 1050,
		})
	})

	it('2. pdf: same single-file shape as epub', async () => {
		const fileUrl = '/api/v2/media/b1/file'
		const thumbUrl = '/api/v2/media/b1/thumbnail'
		const get = sizedGetStub({ [fileUrl]: 2000, [thumbUrl]: 100 })
		const sdk = makeSdk(get)
		const deps = makeDeps()
		const fetcher = createDownloadFetcher(sdk, deps)
		const job: DownloadJob = { bookId: 'b1', title: 'Book One', format: 'pdf' }
		const controller = new AbortController()

		const result = await fetcher(job, jest.fn(), controller.signal)

		expect(get).toHaveBeenCalledWith(fileUrl, expect.objectContaining({ responseType: 'blob' }))
		expect(deps.putBlob).toHaveBeenCalledWith(fileUrl, expect.objectContaining({ size: 2000 }))
		expect(result).toEqual<DownloadFetchResult>({
			fileUrl,
			thumbnailUrl: thumbUrl,
			sizeBytes: 2100,
		})
	})

	it('3. comic page-loop: fetches pages 1..N in order via bookPageURL, returns pageUrls in order', async () => {
		const thumbUrl = '/api/v2/media/b2/thumbnail'
		const page1 = '/api/v2/media/b2/page/1'
		const page2 = '/api/v2/media/b2/page/2'
		const page3 = '/api/v2/media/b2/page/3'
		const get = sizedGetStub({ [thumbUrl]: 10, [page1]: 100, [page2]: 200, [page3]: 300 })
		const sdk = makeSdk(get)
		const deps = makeDeps()
		const fetcher = createDownloadFetcher(sdk, deps)
		const job: DownloadJob = { bookId: 'b2', title: 'Book Two', format: 'cbz', pageCount: 3 }
		const controller = new AbortController()

		const result = await fetcher(job, jest.fn(), controller.signal)

		const pageCallOrder = get.mock.calls.map((c) => c[0]).filter((u) => u.includes('/page/'))
		expect(pageCallOrder).toEqual([page1, page2, page3])
		expect(deps.putBlob).toHaveBeenCalledWith(page1, expect.objectContaining({ size: 100 }))
		expect(deps.putBlob).toHaveBeenCalledWith(page2, expect.objectContaining({ size: 200 }))
		expect(deps.putBlob).toHaveBeenCalledWith(page3, expect.objectContaining({ size: 300 }))
		expect(result).toEqual<DownloadFetchResult>({
			pageUrls: [page1, page2, page3],
			thumbnailUrl: thumbUrl,
			sizeBytes: 10 + 100 + 200 + 300,
		})
	})

	it('4. auth path (A1): every fetch goes through sdk.axios.get with responseType blob, never a bare fetch', async () => {
		const globalFetch = jest.fn()
		const originalFetch = globalThis.fetch

		;(globalThis as any).fetch = globalFetch

		try {
			const fileUrl = '/api/v2/media/b1/file'
			const thumbUrl = '/api/v2/media/b1/thumbnail'
			const get = sizedGetStub({ [fileUrl]: 500, [thumbUrl]: 20 })
			const sdk = makeSdk(get)
			const deps = makeDeps()
			const fetcher = createDownloadFetcher(sdk, deps)
			const job: DownloadJob = { bookId: 'b1', title: 'Book One', format: 'epub' }
			const controller = new AbortController()

			await fetcher(job, jest.fn(), controller.signal)

			expect(globalFetch).not.toHaveBeenCalled()
			expect(get).toHaveBeenCalled()
			for (const call of get.mock.calls) {
				expect(call[1]).toEqual(expect.objectContaining({ responseType: 'blob' }))
			}
		} finally {
			globalThis.fetch = originalFetch
		}
	})

	it('5. abort -> partial cleanup: throws and deletes already-stored urls, no result', async () => {
		const thumbUrl = '/api/v2/media/b2/thumbnail'
		const page1 = '/api/v2/media/b2/page/1'
		const page2 = '/api/v2/media/b2/page/2'
		const controller = new AbortController()

		const get = jest.fn(async (url: string) => {
			if (url === thumbUrl) return { data: { size: 10 } as unknown as Blob }
			if (url === page1) {
				// After page 1 resolves successfully, abort before page 2's iteration check.
				controller.abort()
				return { data: { size: 100 } as unknown as Blob }
			}
			if (url === page2) {
				throw new DOMException('Aborted', 'AbortError')
			}
			throw new Error(`unexpected URL requested: ${url}`)
		})
		const sdk = makeSdk(get)
		const deps = makeDeps()
		const fetcher = createDownloadFetcher(sdk, deps)
		const job: DownloadJob = { bookId: 'b2', title: 'Book Two', format: 'cbz', pageCount: 3 }

		await expect(fetcher(job, jest.fn(), controller.signal)).rejects.toBeTruthy()

		expect(deps.deleteUrls).toHaveBeenCalledWith([thumbUrl, page1])
	})

	it('6. thumbnail failure is non-fatal: download still resolves, thumbnailUrl absent, not in storedUrls', async () => {
		const fileUrl = '/api/v2/media/b1/file'
		const thumbUrl = '/api/v2/media/b1/thumbnail'
		const get = jest.fn(async (url: string) => {
			if (url === thumbUrl) throw new Error('thumbnail 404')
			if (url === fileUrl) return { data: { size: 1000 } as unknown as Blob }
			throw new Error(`unexpected URL requested: ${url}`)
		})
		const sdk = makeSdk(get)
		const deps = makeDeps()
		const fetcher = createDownloadFetcher(sdk, deps)
		const job: DownloadJob = { bookId: 'b1', title: 'Book One', format: 'epub' }
		const controller = new AbortController()

		const result = await fetcher(job, jest.fn(), controller.signal)

		expect(result.thumbnailUrl).toBeUndefined()
		expect(deps.putBlob).not.toHaveBeenCalledWith(thumbUrl, expect.anything())
		expect(deps.deleteUrls).not.toHaveBeenCalled()
		expect(result).toEqual<DownloadFetchResult>({
			fileUrl,
			thumbnailUrl: undefined,
			sizeBytes: 1000,
		})
	})

	it('7a. progress: epub relays axios onDownloadProgress as onProgress(loaded, total)', async () => {
		const fileUrl = '/api/v2/media/b1/file'
		const thumbUrl = '/api/v2/media/b1/thumbnail'
		const get = jest.fn(
			async (url: string, config?: { onDownloadProgress?: (e: unknown) => void }) => {
				if (url === thumbUrl) return { data: { size: 20 } as unknown as Blob }
				if (url === fileUrl) {
					config?.onDownloadProgress?.({ loaded: 500, total: 1000 })
					return { data: { size: 1000 } as unknown as Blob }
				}
				throw new Error(`unexpected URL requested: ${url}`)
			},
		)
		const sdk = makeSdk(get)
		const deps = makeDeps()
		const fetcher = createDownloadFetcher(sdk, deps)
		const job: DownloadJob = { bookId: 'b1', title: 'Book One', format: 'epub' }
		const controller = new AbortController()
		const onProgress = jest.fn()

		await fetcher(job, onProgress, controller.signal)

		expect(onProgress).toHaveBeenCalledWith(500, 1000)
		// Final tick reports the full file size as both loaded and total.
		expect(onProgress).toHaveBeenCalledWith(1000, 1000)
	})

	it('7b. progress: comic reports cumulative received bytes after each page', async () => {
		const thumbUrl = '/api/v2/media/b2/thumbnail'
		const page1 = '/api/v2/media/b2/page/1'
		const page2 = '/api/v2/media/b2/page/2'
		const get = sizedGetStub({ [thumbUrl]: 10, [page1]: 100, [page2]: 200 })
		const sdk = makeSdk(get)
		const deps = makeDeps()
		const fetcher = createDownloadFetcher(sdk, deps)
		const job: DownloadJob = { bookId: 'b2', title: 'Book Two', format: 'cbz', pageCount: 2 }
		const controller = new AbortController()
		const onProgress = jest.fn()

		await fetcher(job, onProgress, controller.signal)

		expect(onProgress).toHaveBeenCalledWith(100)
		expect(onProgress).toHaveBeenCalledWith(300)
	})
})
