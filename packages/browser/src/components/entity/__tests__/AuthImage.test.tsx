import { queryClient, useSDK } from '@longbox/client'
import { act, render, waitFor } from '@testing-library/react'

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

	describe('lazy (IntersectionObserver-gated) mode', () => {
		// jsdom has no IntersectionObserver. This stub captures the callbacks so a case can decide
		// exactly when the "image scrolled into view" notification lands.
		type IOCallback = (entries: { isIntersecting: boolean }[]) => void
		let callbacks: IOCallback[]
		let disconnect: jest.Mock
		let originalIO: typeof IntersectionObserver | undefined

		beforeEach(() => {
			callbacks = []
			disconnect = jest.fn()
			originalIO = (globalThis as { IntersectionObserver?: typeof IntersectionObserver })
				.IntersectionObserver
			;(globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver = class {
				constructor(cb: IOCallback) {
					callbacks.push(cb)
				}
				observe = jest.fn()
				unobserve = jest.fn()
				takeRecords = jest.fn()
				disconnect = disconnect
			}
		})

		afterEach(() => {
			if (originalIO) {
				;(globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver =
					originalIO
			} else {
				delete (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver
			}
		})

		function scrollIntoView() {
			act(() => {
				callbacks.forEach((cb) => cb([{ isIntersecting: true }]))
			})
		}

		it('renders an observable placeholder and does not fetch while off screen', () => {
			const get = resolvedGet()
			setupSdk(get)

			const { container } = render(<AuthImage src="/api/v2/media/1/page/1" token="tok" lazy />)

			expect(container.querySelector('[data-testid="auth-image-lazy-placeholder"]')).not.toBeNull()
			expect(container.querySelector('img')).toBeNull()
			expect(get).not.toHaveBeenCalled()
		})

		it('gives the placeholder the image box so the observer has something with size to watch', () => {
			setupSdk(resolvedGet())

			const { container } = render(
				<AuthImage
					src="/api/v2/media/1/page/1"
					token="tok"
					lazy
					className="fills-its-container"
					style={{ height: '100%' }}
				/>,
			)

			const placeholder = container.querySelector<HTMLElement>(
				'[data-testid="auth-image-lazy-placeholder"]',
			)
			expect(placeholder?.className).toBe('fills-its-container')
			expect(placeholder?.style.height).toBe('100%')
		})

		it('fetches and renders once it intersects', async () => {
			const get = resolvedGet()
			setupSdk(get)

			const { container } = render(<AuthImage src="/api/v2/media/1/page/1" token="tok" lazy />)
			scrollIntoView()

			await waitFor(() => {
				expect(container.querySelector('img')).not.toBeNull()
			})
			expect(get).toHaveBeenCalledWith('/api/v2/media/1/page/1', { responseType: 'arraybuffer' })
			expect(container.querySelector('[data-testid="auth-image-lazy-placeholder"]')).toBeNull()
		})

		it('is latched: a later non-intersecting notification does not re-trigger a fetch', async () => {
			const get = resolvedGet()
			setupSdk(get)

			const { container } = render(<AuthImage src="/api/v2/media/1/page/1" token="tok" lazy />)
			scrollIntoView()
			await waitFor(() => {
				expect(container.querySelector('img')).not.toBeNull()
			})

			act(() => {
				callbacks.forEach((cb) => cb([{ isIntersecting: false }]))
			})

			expect(get).toHaveBeenCalledTimes(1)
			expect(container.querySelector('img')).not.toBeNull()
		})

		it('falls back to fetching eagerly when IntersectionObserver is unavailable', async () => {
			delete (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver
			const get = resolvedGet()
			setupSdk(get)

			const { container } = render(<AuthImage src="/api/v2/media/1/page/1" token="tok" lazy />)

			await waitFor(() => {
				expect(container.querySelector('img')).not.toBeNull()
			})
			expect(container.querySelector('[data-testid="auth-image-lazy-placeholder"]')).toBeNull()
		})

		it('is off by default -- an eager AuthImage still renders nothing until the bytes resolve', () => {
			const get = resolvedGet()
			setupSdk(get)

			const { container } = render(<AuthImage src="/api/v2/media/1/page/1" token="tok" />)

			expect(container.querySelector('[data-testid="auth-image-lazy-placeholder"]')).toBeNull()
			expect(get).toHaveBeenCalled()
		})
	})
})
