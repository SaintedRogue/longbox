import { useSDK } from '@longbox/client'
import { fireEvent, render } from '@testing-library/react'

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
		AuthImage: fr(
			(
				props: { src?: string; token?: string; lazy?: boolean },
				ref: React.Ref<HTMLImageElement>,
			) => (
				<img
					data-testid="auth-image-mock"
					data-src={props.src}
					data-token={props.token}
					data-lazy={String(props.lazy)}
					ref={ref}
				/>
			),
		),
	}
})

const mockedUseSDK = jest.mocked(useSDK)
const mockedUseOfflineImageSrc = jest.mocked(useOfflineImageSrc)

/** Returns the sdk's `axios.get` mock, so a test can assert nothing fetches behind the <img>. */
function setSDK(isTokenAuth: boolean) {
	const get = jest.fn()
	mockedUseSDK.mockReturnValue({
		sdk: { isTokenAuth, token: isTokenAuth ? 'test-token' : undefined, axios: { get } },
	} as unknown as ReturnType<typeof useSDK>)
	return get
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

	describe('lazy loading', () => {
		it('lazy-loads by default -- covers are overwhelmingly offscreen in scrolling grids', () => {
			setSDK(false)
			mockedUseOfflineImageSrc.mockReturnValue(undefined)

			const { container } = render(<ThumbnailImage src="/api/v2/media/1/thumbnail" />)

			const img = container.querySelector('img')
			expect(img?.getAttribute('loading')).toBe('lazy')
			expect(img?.getAttribute('decoding')).toBe('async')
			expect(img?.getAttribute('fetchpriority')).toBeNull()
		})

		it('lazy-loads the offline (object URL) img too', () => {
			setSDK(false)
			mockedUseOfflineImageSrc.mockReturnValue('blob:mock')

			const { container } = render(<ThumbnailImage src="/api/v2/media/1/thumbnail" />)

			expect(container.querySelector('img')?.getAttribute('loading')).toBe('lazy')
		})

		it('priority opts out of lazy and asks for a high fetch priority', () => {
			setSDK(false)
			mockedUseOfflineImageSrc.mockReturnValue(undefined)

			const { container } = render(<ThumbnailImage src="/api/v2/media/1/thumbnail" priority />)

			const img = container.querySelector('img')
			expect(img?.getAttribute('loading')).toBe('eager')
			expect(img?.getAttribute('fetchpriority')).toBe('high')
		})

		it('priority wins over an explicit lazy', () => {
			setSDK(false)
			mockedUseOfflineImageSrc.mockReturnValue(undefined)

			const { container } = render(<ThumbnailImage src="/api/v2/media/1/thumbnail" lazy priority />)

			expect(container.querySelector('img')?.getAttribute('loading')).toBe('eager')
		})

		it('lazy={false} still opts out, without claiming high priority', () => {
			setSDK(false)
			mockedUseOfflineImageSrc.mockReturnValue(undefined)

			const { container } = render(<ThumbnailImage src="/api/v2/media/1/thumbnail" lazy={false} />)

			const img = container.querySelector('img')
			expect(img?.getAttribute('loading')).toBe('eager')
			expect(img?.getAttribute('fetchpriority')).toBeNull()
		})

		it('forwards lazy to AuthImage (token mode), where loading="lazy" would be inert', () => {
			setSDK(true)
			mockedUseOfflineImageSrc.mockReturnValue(undefined)

			const { container } = render(<ThumbnailImage src="/api/v2/media/1/thumbnail" />)

			expect(
				container.querySelector('[data-testid="auth-image-mock"]')?.getAttribute('data-lazy'),
			).toBe('true')
		})

		it('forwards lazy={false} to AuthImage when priority is set', () => {
			setSDK(true)
			mockedUseOfflineImageSrc.mockReturnValue(undefined)

			const { container } = render(<ThumbnailImage src="/api/v2/media/1/thumbnail" priority />)

			expect(
				container.querySelector('[data-testid="auth-image-mock"]')?.getAttribute('data-lazy'),
			).toBe('false')
		})
	})

	it('does not re-fetch a cover once it has loaded (no shadow fetch behind the <img>)', () => {
		const get = setSDK(false)
		mockedUseOfflineImageSrc.mockReturnValue(undefined)

		const { container } = render(<ThumbnailImage src="/api/v2/media/1/thumbnail" />)
		const img = container.querySelector('img')
		expect(img).not.toBeNull()

		// The retired passive cache re-GET every cover the browser had just loaded, purely to stash a
		// copy in CacheStorage -- and the same cover renders across grids, carousels and peek sheets.
		// The browser's own HTTP cache handles reuse now, so the load handler must not fetch anything.
		fireEvent.load(img as HTMLImageElement)

		expect(get).not.toHaveBeenCalled()
	})
})
