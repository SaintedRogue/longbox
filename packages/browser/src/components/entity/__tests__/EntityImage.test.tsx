import { useSDK } from '@longbox/client'
import { render } from '@testing-library/react'

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
		AuthImage: fr((props: { src?: string; token?: string }, ref: React.Ref<HTMLDivElement>) => (
			<div data-testid="auth-image-mock" data-src={props.src} data-token={props.token} ref={ref} />
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
})
