import { act, renderHook, waitFor } from '@testing-library/react'

import * as blobStore from '../blobStore'
import { offlineBlobUrl, offlineFileBlob, useOfflineImageSrc } from '../resolveOfflineUrl'

/** Fake "response": just enough shape for resolveOfflineUrl's `.blob()` usage. */
function fakeResponse(blob: Blob = {} as Blob): Response {
	return { blob: () => Promise.resolve(blob) } as unknown as Response
}

describe('offlineBlobUrl', () => {
	let n = 0
	let createObjectURL: jest.Mock
	let revokeObjectURL: jest.Mock

	beforeEach(() => {
		n = 0
		createObjectURL = jest.fn(() => `blob:mock-${n++}`)
		revokeObjectURL = jest.fn()
		URL.createObjectURL = createObjectURL as unknown as typeof URL.createObjectURL
		URL.revokeObjectURL = revokeObjectURL as unknown as typeof URL.revokeObjectURL
	})

	afterEach(() => {
		jest.restoreAllMocks()
	})

	it('returns the created object URL when matchUrl resolves a response', async () => {
		jest.spyOn(blobStore, 'matchUrl').mockResolvedValue(fakeResponse())

		const result = await offlineBlobUrl('/api/v2/media/1/page/1')

		expect(result).toBe('blob:mock-0')
		expect(createObjectURL).toHaveBeenCalledTimes(1)
	})

	it('returns null when matchUrl resolves undefined', async () => {
		jest.spyOn(blobStore, 'matchUrl').mockResolvedValue(undefined)

		const result = await offlineBlobUrl('/api/v2/media/1/page/1')

		expect(result).toBeNull()
		expect(createObjectURL).not.toHaveBeenCalled()
	})
})

describe('offlineFileBlob', () => {
	afterEach(() => {
		jest.restoreAllMocks()
	})

	it('returns the cached blob when matchUrl resolves a response', async () => {
		const fakeBlob = { size: 42 } as Blob
		jest.spyOn(blobStore, 'matchUrl').mockResolvedValue(fakeResponse(fakeBlob))

		const result = await offlineFileBlob('/api/v2/media/1/file')

		expect(result).toBe(fakeBlob)
	})

	it('returns null when matchUrl resolves undefined, without fabricating a blob', async () => {
		jest.spyOn(blobStore, 'matchUrl').mockResolvedValue(undefined)

		const result = await offlineFileBlob('/api/v2/media/1/file')

		expect(result).toBeNull()
	})
})

describe('useOfflineImageSrc', () => {
	let n = 0
	let createObjectURL: jest.Mock
	let revokeObjectURL: jest.Mock

	beforeEach(() => {
		n = 0
		createObjectURL = jest.fn(() => `blob:mock-${n++}`)
		revokeObjectURL = jest.fn()
		URL.createObjectURL = createObjectURL as unknown as typeof URL.createObjectURL
		URL.revokeObjectURL = revokeObjectURL as unknown as typeof URL.revokeObjectURL
	})

	afterEach(() => {
		jest.restoreAllMocks()
	})

	it('returns the object URL when the url is cached', async () => {
		jest.spyOn(blobStore, 'matchUrl').mockResolvedValue(fakeResponse())

		const { result } = renderHook(() => useOfflineImageSrc('/api/v2/media/1/page/1'))

		await waitFor(() => {
			expect(result.current).toBe('blob:mock-0')
		})
	})

	it('returns undefined when the url is not cached', async () => {
		const matchPromise = Promise.resolve(undefined)
		jest.spyOn(blobStore, 'matchUrl').mockReturnValue(matchPromise)

		const { result } = renderHook(() => useOfflineImageSrc('/api/v2/media/1/page/1'))

		await matchPromise
		await waitFor(() => {
			expect(result.current).toBeUndefined()
		})
	})

	it('returns undefined when url is undefined, without calling matchUrl', () => {
		const spy = jest.spyOn(blobStore, 'matchUrl')

		const { result } = renderHook(() => useOfflineImageSrc(undefined))

		expect(result.current).toBeUndefined()
		expect(spy).not.toHaveBeenCalled()
	})

	it('revokes the created object URL on unmount', async () => {
		jest.spyOn(blobStore, 'matchUrl').mockResolvedValue(fakeResponse())

		const { result, unmount } = renderHook(() => useOfflineImageSrc('/api/v2/media/1/page/1'))

		await waitFor(() => {
			expect(result.current).toBe('blob:mock-0')
		})

		unmount()

		expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-0')
	})

	it('revokes the previous object URL when the url prop changes', async () => {
		jest.spyOn(blobStore, 'matchUrl').mockResolvedValue(fakeResponse())

		const { result, rerender } = renderHook(({ url }) => useOfflineImageSrc(url), {
			initialProps: { url: '/api/v2/media/1/page/1' as string | undefined },
		})

		await waitFor(() => {
			expect(result.current).toBe('blob:mock-0')
		})

		rerender({ url: '/api/v2/media/1/page/2' })

		await waitFor(() => {
			expect(result.current).toBe('blob:mock-1')
		})

		expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-0')
	})

	it('revokes the object URL when matchUrl resolves after the component unmounts', async () => {
		let resolveMatch: (value: Response | undefined) => void = () => {}
		const matchPromise = new Promise<Response | undefined>((resolve) => {
			resolveMatch = resolve
		})
		jest.spyOn(blobStore, 'matchUrl').mockReturnValue(matchPromise)

		const { unmount } = renderHook(() => useOfflineImageSrc('/api/v2/media/1/page/1'))

		// Unmount *before* matchUrl resolves. This flips `cancelled` to true in the effect's cleanup
		// while offlineBlobUrl(url) is still pending, so the object URL it creates below is a "late"
		// resolution -- exactly the branch resolveOfflineUrl.ts lines ~39-44 exist to handle.
		unmount()

		expect(createObjectURL).not.toHaveBeenCalled()

		await act(async () => {
			resolveMatch(fakeResponse())
			// No handle on offlineBlobUrl's internal promise chain (matchUrl -> resp.blob() ->
			// createObjectURL -> the effect's .then), so flush it with a macrotask boundary: every
			// microtask queued by then is guaranteed to run before a setTimeout(0) callback fires.
			await new Promise((resolve) => setTimeout(resolve, 0))
		})

		// The URL was created (proving resolution did happen after teardown) but immediately revoked
		// rather than leaked, and never exposed via hook state.
		expect(createObjectURL).toHaveBeenCalledTimes(1)
		expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-0')
	})
})
