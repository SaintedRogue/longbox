import { useSDK } from '@longbox/client'
import { fireEvent, render } from '@testing-library/react'

import * as passiveCache from '@/offline/passiveCache'
import { useOfflineImageSrc } from '@/offline/resolveOfflineUrl'

import { ThumbnailImage } from '../ThumbnailImage'

jest.mock('@longbox/client', () => ({
	...jest.requireActual('@longbox/client'),
	useSDK: jest.fn(),
}))

jest.mock('@/offline/resolveOfflineUrl', () => ({
	useOfflineImageSrc: jest.fn(),
}))

// ThumbnailPlaceholder pulls in usePreferences (GraphQL mutation + zustand store), which is out of
// scope here -- render it as a no-op so tests don't need that whole provider chain.
jest.mock('../ThumbnailPlaceholder', () => ({
	ThumbnailPlaceholder: () => null,
}))

// AuthImage does its own async fetch/queryClient plumbing that's out of scope here -- mock it to a
// marker element so token-mode tests can assert ThumbnailImage *rendered* it without exercising
// that machinery (mirrors EntityImage.test.tsx's AuthImage mock).
jest.mock('../../entity/AuthImage', () => {
	const { forwardRef: fr } = jest.requireActual<typeof import('react')>('react')
	return {
		AuthImage: fr((props: { src?: string; token?: string }, ref: React.Ref<HTMLImageElement>) => (
			<img data-testid="auth-image-mock" data-src={props.src} data-token={props.token} ref={ref} />
		)),
	}
})

const mockedUseSDK = jest.mocked(useSDK)
const mockedUseOfflineImageSrc = jest.mocked(useOfflineImageSrc)

function setSDK(isTokenAuth: boolean) {
	mockedUseSDK.mockReturnValue({
		sdk: { isTokenAuth, token: isTokenAuth ? 'test-token' : undefined },
	} as unknown as ReturnType<typeof useSDK>)
}

describe('ThumbnailImage', () => {
	afterEach(() => {
		jest.clearAllMocks()
	})

	it('renders a plain img with the offline object URL when offline hits, in session mode', () => {
		setSDK(false)
		mockedUseOfflineImageSrc.mockReturnValue('blob:mock')

		const { container } = render(<ThumbnailImage src="/api/v2/media/1/thumbnail" />)

		const img = container.querySelector('img')
		expect(img).not.toBeNull()
		expect(img?.getAttribute('src')).toBe('blob:mock')
		expect(container.querySelector('[data-testid="auth-image-mock"]')).toBeNull()
	})

	it('renders a plain img with the offline object URL when offline hits, in token mode (offline wins over AuthImage)', () => {
		setSDK(true)
		mockedUseOfflineImageSrc.mockReturnValue('blob:mock')

		const { container } = render(<ThumbnailImage src="/api/v2/media/1/thumbnail" />)

		const img = container.querySelector('img')
		expect(img).not.toBeNull()
		expect(img?.getAttribute('src')).toBe('blob:mock')
		expect(container.querySelector('[data-testid="auth-image-mock"]')).toBeNull()
	})

	it('falls through to a plain img with the network src on a miss, in session mode', () => {
		setSDK(false)
		mockedUseOfflineImageSrc.mockReturnValue(undefined)

		const { container } = render(<ThumbnailImage src="/api/v2/media/1/thumbnail" />)

		const img = container.querySelector('img')
		expect(img).not.toBeNull()
		expect(img?.getAttribute('src')).toBe('/api/v2/media/1/thumbnail')
		expect(container.querySelector('[data-testid="auth-image-mock"]')).toBeNull()
	})

	it('falls through to AuthImage on a miss, in token mode', () => {
		setSDK(true)
		mockedUseOfflineImageSrc.mockReturnValue(undefined)

		const { container } = render(<ThumbnailImage src="/api/v2/media/1/thumbnail" />)

		const authImageMock = container.querySelector('[data-testid="auth-image-mock"]')
		expect(authImageMock).not.toBeNull()
		expect(authImageMock?.getAttribute('data-src')).toBe('/api/v2/media/1/thumbnail')
		expect(authImageMock?.getAttribute('data-token')).toBe('test-token')
		expect(container.querySelector('img:not([data-testid="auth-image-mock"])')).toBeNull()
	})

	describe('passive cache (cacheOnView)', () => {
		it('fires cacheOnView on the network (cache-miss) img onLoad, in session mode', () => {
			setSDK(false)
			mockedUseOfflineImageSrc.mockReturnValue(undefined)
			const cacheOnViewSpy = jest.spyOn(passiveCache, 'cacheOnView').mockResolvedValue(undefined)

			const { container } = render(<ThumbnailImage src="/api/v2/media/1/thumbnail" />)
			const img = container.querySelector('img')
			expect(img).not.toBeNull()

			fireEvent.load(img as HTMLImageElement)

			expect(cacheOnViewSpy).toHaveBeenCalledWith(
				'/api/v2/media/1/thumbnail',
				expect.objectContaining({ isTokenAuth: false }),
			)
		})

		it('does NOT fire cacheOnView on the offline-cache-hit img onLoad', () => {
			setSDK(false)
			mockedUseOfflineImageSrc.mockReturnValue('blob:mock')
			const cacheOnViewSpy = jest.spyOn(passiveCache, 'cacheOnView').mockResolvedValue(undefined)

			const { container } = render(<ThumbnailImage src="/api/v2/media/1/thumbnail" />)
			const img = container.querySelector('img')
			expect(img).not.toBeNull()

			fireEvent.load(img as HTMLImageElement)

			expect(cacheOnViewSpy).not.toHaveBeenCalled()
		})

		it('does NOT fire cacheOnView from ThumbnailImage on the AuthImage (token-mode) branch', () => {
			setSDK(true)
			mockedUseOfflineImageSrc.mockReturnValue(undefined)
			const cacheOnViewSpy = jest.spyOn(passiveCache, 'cacheOnView').mockResolvedValue(undefined)

			const { container } = render(<ThumbnailImage src="/api/v2/media/1/thumbnail" />)
			expect(container.querySelector('[data-testid="auth-image-mock"]')).not.toBeNull()

			expect(cacheOnViewSpy).not.toHaveBeenCalled()
		})
	})
})
