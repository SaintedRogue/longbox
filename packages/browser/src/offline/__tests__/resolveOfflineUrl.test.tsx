import { renderHook, waitFor } from '@testing-library/react'

import * as blobStore from '../blobStore'
import { offlineBlobUrl, useOfflineImageSrc } from '../resolveOfflineUrl'

/** Fake "response": just enough shape for resolveOfflineUrl's `.blob()` usage. */
function fakeResponse(): Response {
	return { blob: () => Promise.resolve({} as Blob) } as unknown as Response
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
		jest.spyOn(blobStore, 'matchUrl').mockResolvedValue(undefined)

		const { result } = renderHook(() => useOfflineImageSrc('/api/v2/media/1/page/1'))

		await waitFor(() => {
			expect(blobStore.matchUrl).toHaveBeenCalled()
		})
		expect(result.current).toBeUndefined()
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
})
