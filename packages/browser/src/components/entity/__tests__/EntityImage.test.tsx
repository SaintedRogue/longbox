import { useSDK } from '@longbox/client'
import { fireEvent, render } from '@testing-library/react'

import { useOfflineImageSrc } from '@/offline/resolveOfflineUrl'

import { EntityImage } from '../EntityImage'

jest.mock('@longbox/client', () => ({
	...jest.requireActual('@longbox/client'),
	useSDK: jest.fn(),
}))

jest.mock('@/offline/resolveOfflineUrl', () => ({
	useOfflineImageSrc: jest.fn(),
}))

// AuthImage does its own async fetch/queryClient plumbing that's out of scope here -- mock it to a
// marker element so token-mode tests can assert EntityImage *rendered* it without exercising that
// machinery. Must be a forwardRef component: EntityImage forwards its `ref` through to whichever
// branch it renders.
jest.mock('../AuthImage', () => {
	const { forwardRef: fr } = jest.requireActual<typeof import('react')>('react')
	return {
		AuthImage: fr(
			(
				props: { src?: string; token?: string; lazy?: boolean; loading?: string },
				ref: React.Ref<HTMLDivElement>,
			) => (
				<div
					data-testid="auth-image-mock"
					data-src={props.src}
					data-token={props.token}
					data-lazy={String(props.lazy)}
					data-loading={props.loading}
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

describe('EntityImage', () => {
	afterEach(() => {
		jest.clearAllMocks()
	})

	it('renders a plain img with the offline object URL when offline hits, in session mode', () => {
		setSDK(false)
		mockedUseOfflineImageSrc.mockReturnValue('blob:mock')

		const { container } = render(<EntityImage src="/api/v2/media/1/page/1" />)

		const img = container.querySelector('img')
		expect(img).not.toBeNull()
		expect(img?.getAttribute('src')).toBe('blob:mock')
		expect(container.querySelector('[data-testid="auth-image-mock"]')).toBeNull()
	})

	it('renders a plain img with the offline object URL when offline hits, in token mode (offline wins over AuthImage)', () => {
		setSDK(true)
		mockedUseOfflineImageSrc.mockReturnValue('blob:mock')

		const { container } = render(<EntityImage src="/api/v2/media/1/page/1" />)

		const img = container.querySelector('img')
		expect(img).not.toBeNull()
		expect(img?.getAttribute('src')).toBe('blob:mock')
		expect(container.querySelector('[data-testid="auth-image-mock"]')).toBeNull()
	})

	it('falls through to a plain img with the network src on a miss, in session mode', () => {
		setSDK(false)
		mockedUseOfflineImageSrc.mockReturnValue(undefined)

		const { container } = render(<EntityImage src="/api/v2/media/1/page/1" />)

		const img = container.querySelector('img')
		expect(img).not.toBeNull()
		expect(img?.getAttribute('src')).toBe('/api/v2/media/1/page/1')
		expect(container.querySelector('[data-testid="auth-image-mock"]')).toBeNull()
	})

	it('falls through to AuthImage on a miss, in token mode', () => {
		setSDK(true)
		mockedUseOfflineImageSrc.mockReturnValue(undefined)

		const { container } = render(<EntityImage src="/api/v2/media/1/page/1" />)

		const authImageMock = container.querySelector('[data-testid="auth-image-mock"]')
		expect(authImageMock).not.toBeNull()
		expect(authImageMock?.getAttribute('data-src')).toBe('/api/v2/media/1/page/1')
		expect(authImageMock?.getAttribute('data-token')).toBe('test-token')
		// No plain <img> carrying the raw network src -- AuthImage owns rendering in this branch.
		expect(container.querySelector('img')).toBeNull()
	})

	it('carries onLoad and spread props (className/alt) on the offline img', () => {
		setSDK(false)
		mockedUseOfflineImageSrc.mockReturnValue('blob:mock')
		const onLoad = jest.fn()

		const { container } = render(
			<EntityImage
				src="/api/v2/media/1/page/1"
				onLoad={onLoad}
				className="page-image"
				alt="Page 1"
			/>,
		)

		const img = container.querySelector('img')
		expect(img).not.toBeNull()
		expect(img?.className).toBe('page-image')
		expect(img?.getAttribute('alt')).toBe('Page 1')
	})

	describe('lazy loading', () => {
		it('lazy-loads by default, decoding off the main thread', () => {
			setSDK(false)
			mockedUseOfflineImageSrc.mockReturnValue(undefined)

			const { container } = render(<EntityImage src="/api/v2/media/1/page/1" />)

			const img = container.querySelector('img')
			expect(img?.getAttribute('loading')).toBe('lazy')
			expect(img?.getAttribute('decoding')).toBe('async')
			expect(img?.getAttribute('fetchpriority')).toBeNull()
		})

		it('lazy-loads the offline (object URL) img too', () => {
			setSDK(false)
			mockedUseOfflineImageSrc.mockReturnValue('blob:mock')

			const { container } = render(<EntityImage src="/api/v2/media/1/page/1" />)

			expect(container.querySelector('img')?.getAttribute('loading')).toBe('lazy')
		})

		it('priority opts out of lazy and asks for a high fetch priority (readers, hero images)', () => {
			setSDK(false)
			mockedUseOfflineImageSrc.mockReturnValue(undefined)

			const { container } = render(<EntityImage src="/api/v2/media/1/page/1" priority />)

			const img = container.querySelector('img')
			expect(img?.getAttribute('loading')).toBe('eager')
			expect(img?.getAttribute('fetchpriority')).toBe('high')
		})

		it('an explicit loading prop from the caller wins over the lazy default', () => {
			setSDK(false)
			mockedUseOfflineImageSrc.mockReturnValue(undefined)

			const { container } = render(<EntityImage src="/api/v2/media/1/page/1" loading="eager" />)

			expect(container.querySelector('img')?.getAttribute('loading')).toBe('eager')
		})

		it('does NOT forward lazy to AuthImage -- its placeholder needs a sized box EntityImage cannot guarantee', () => {
			setSDK(true)
			mockedUseOfflineImageSrc.mockReturnValue(undefined)

			const { container } = render(<EntityImage src="/api/v2/media/1/page/1" />)

			const authImageMock = container.querySelector('[data-testid="auth-image-mock"]')
			expect(authImageMock?.getAttribute('data-lazy')).toBe('undefined')
			// The (inert on that path) attributes still pass through with the rest of the img props.
			expect(authImageMock?.getAttribute('data-loading')).toBe('lazy')
		})
	})

	it('does not re-fetch a network img once it has loaded (no shadow fetch behind the <img>)', () => {
		const get = setSDK(false)
		mockedUseOfflineImageSrc.mockReturnValue(undefined)

		const { container } = render(<EntityImage src="/api/v2/media/1/page/1" />)
		const img = container.querySelector('img')
		expect(img).not.toBeNull()

		// The retired passive cache re-GET every image the browser had just loaded, purely to stash a
		// copy in CacheStorage. The browser's own HTTP cache (the server sends ETag + Cache-Control on
		// these URLs) covers that, so the load handler must not touch the network at all.
		fireEvent.load(img as HTMLImageElement)

		expect(get).not.toHaveBeenCalled()
	})
})
