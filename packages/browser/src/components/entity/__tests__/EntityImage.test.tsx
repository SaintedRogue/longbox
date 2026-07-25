import { useSDK } from '@longbox/client'
import { fireEvent, render } from '@testing-library/react'

import { _resetCacheOnViewOnceForTests } from '@/offline/cacheOnViewOnce'
import * as passiveCache from '@/offline/passiveCache'
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

function setSDK(isTokenAuth: boolean) {
	mockedUseSDK.mockReturnValue({
		sdk: { isTokenAuth, token: isTokenAuth ? 'test-token' : undefined },
	} as unknown as ReturnType<typeof useSDK>)
}

describe('EntityImage', () => {
	beforeEach(() => {
		// `cacheOnViewOnce`'s claim set is module-level (session-scoped by design), so it has to be
		// cleared between cases or a later case reusing a src would see no shadow fetch at all.
		_resetCacheOnViewOnceForTests()
	})

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

	describe('passive cache (cacheOnView)', () => {
		it('fires cacheOnView on the network (cache-miss) img onLoad, in session mode', () => {
			setSDK(false)
			mockedUseOfflineImageSrc.mockReturnValue(undefined)
			const cacheOnViewSpy = jest.spyOn(passiveCache, 'cacheOnView').mockResolvedValue(undefined)

			const { container } = render(<EntityImage src="/api/v2/media/1/page/1" />)
			const img = container.querySelector('img')
			expect(img).not.toBeNull()

			fireEvent.load(img as HTMLImageElement)

			expect(cacheOnViewSpy).toHaveBeenCalledWith(
				'/api/v2/media/1/page/1',
				expect.objectContaining({ isTokenAuth: false }),
			)
		})

		it('does NOT fire cacheOnView on the offline-cache-hit img onLoad', () => {
			setSDK(false)
			mockedUseOfflineImageSrc.mockReturnValue('blob:mock')
			const cacheOnViewSpy = jest.spyOn(passiveCache, 'cacheOnView').mockResolvedValue(undefined)

			const { container } = render(<EntityImage src="/api/v2/media/1/page/1" />)
			const img = container.querySelector('img')
			expect(img).not.toBeNull()

			fireEvent.load(img as HTMLImageElement)

			expect(cacheOnViewSpy).not.toHaveBeenCalled()
		})

		it('does NOT fire cacheOnView from EntityImage on the AuthImage (token-mode) branch -- AuthImage.tsx owns that side channel', () => {
			setSDK(true)
			mockedUseOfflineImageSrc.mockReturnValue(undefined)
			const cacheOnViewSpy = jest.spyOn(passiveCache, 'cacheOnView').mockResolvedValue(undefined)

			const { container } = render(<EntityImage src="/api/v2/media/1/page/1" />)
			const authImageMock = container.querySelector('[data-testid="auth-image-mock"]')
			expect(authImageMock).not.toBeNull()

			expect(cacheOnViewSpy).not.toHaveBeenCalled()
		})

		it('shadow-fetches a given src at most once per session, across separate renders', () => {
			setSDK(false)
			mockedUseOfflineImageSrc.mockReturnValue(undefined)
			const cacheOnViewSpy = jest.spyOn(passiveCache, 'cacheOnView').mockResolvedValue(undefined)

			const first = render(<EntityImage src="/api/v2/media/1/page/1" />)
			fireEvent.load(first.container.querySelector('img') as HTMLImageElement)
			first.unmount()

			// The readers remount the same page image on every scale / page-set change; only the
			// first load should re-GET the bytes for the passive cache.
			const second = render(<EntityImage src="/api/v2/media/1/page/1" />)
			fireEvent.load(second.container.querySelector('img') as HTMLImageElement)

			expect(cacheOnViewSpy).toHaveBeenCalledTimes(1)
		})
	})
})
