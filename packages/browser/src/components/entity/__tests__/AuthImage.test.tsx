import { queryClient, useSDK } from '@longbox/client'
import { render, waitFor } from '@testing-library/react'

import * as passiveCache from '@/offline/passiveCache'

import { AuthImage } from '../AuthImage'

jest.mock('@longbox/client', () => ({
	...jest.requireActual('@longbox/client'),
	useSDK: jest.fn(),
}))

const mockedUseSDK = jest.mocked(useSDK)

function setupSdk(get: jest.Mock) {
	mockedUseSDK.mockReturnValue({
		sdk: { axios: { get } },
	} as unknown as ReturnType<typeof useSDK>)
}

function resolvedGet() {
	return jest.fn().mockResolvedValue({
		data: new ArrayBuffer(4),
		headers: { 'content-type': 'image/png' },
	})
}

describe('AuthImage', () => {
	let n = 0
	let createObjectURL: jest.Mock
	let revokeObjectURL: jest.Mock

	beforeEach(() => {
		n = 0
		createObjectURL = jest.fn(() => `blob:mock-${n++}`)
		revokeObjectURL = jest.fn()
		URL.createObjectURL = createObjectURL as unknown as typeof URL.createObjectURL
		URL.revokeObjectURL = revokeObjectURL as unknown as typeof URL.revokeObjectURL
		// The 5-day staleTime means a repeat `fetchQuery` for the same key would otherwise reuse a
		// previous test's cached data -- clear it so every test starts from a clean cache.
		queryClient.clear()
	})

	afterEach(() => {
		jest.restoreAllMocks()
	})

	it('renders nothing until the fetch resolves, then an img with the created object URL', async () => {
		const get = resolvedGet()
		setupSdk(get)

		const { container } = render(<AuthImage src="/api/v2/media/1/page/1" token="tok" />)

		expect(container.querySelector('img')).toBeNull()

		await waitFor(() => {
			expect(container.querySelector('img')?.getAttribute('src')).toBe('blob:mock-0')
		})
	})

	it('fetches via sdk.axios as an arraybuffer for the given src', async () => {
		const get = resolvedGet()
		setupSdk(get)

		render(<AuthImage src="/api/v2/media/1/page/1" token="tok" />)

		await waitFor(() => {
			expect(get).toHaveBeenCalledWith('/api/v2/media/1/page/1', { responseType: 'arraybuffer' })
		})
	})

	it('feeds the fetched bytes into the passive cache once in hand, at zero extra network cost', async () => {
		const get = resolvedGet()
		setupSdk(get)
		const cacheSpy = jest.spyOn(passiveCache, 'cacheAlreadyFetched').mockResolvedValue(undefined)

		render(<AuthImage src="/api/v2/media/1/page/1" token="tok" />)

		await waitFor(() => {
			expect(cacheSpy).toHaveBeenCalledTimes(1)
		})
		expect(cacheSpy).toHaveBeenCalledWith('/api/v2/media/1/page/1', expect.any(Blob))
	})

	it('revokes the created object URL on unmount', async () => {
		const get = resolvedGet()
		setupSdk(get)

		const { container, unmount } = render(<AuthImage src="/api/v2/media/1/page/1" token="tok" />)

		await waitFor(() => {
			expect(container.querySelector('img')).not.toBeNull()
		})

		unmount()

		expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-0')
	})

	it('does not fetch when token is missing', () => {
		const get = jest.fn()
		setupSdk(get)

		render(<AuthImage src="/api/v2/media/1/page/1" />)

		expect(get).not.toHaveBeenCalled()
	})

	it('does not fetch when src is missing', () => {
		const get = jest.fn()
		setupSdk(get)

		render(<AuthImage token="tok" />)

		expect(get).not.toHaveBeenCalled()
	})
})
