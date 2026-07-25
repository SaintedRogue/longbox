import { queryClient, useSDK } from '@longbox/client'
import { forwardRef, useCallback, useEffect, useState } from 'react'

import { cacheAlreadyFetched } from '@/offline/passiveCache'

type Props = {
	token?: string
	/**
	 * Defer the fetch until the image is at (or near) the viewport.
	 *
	 * The native `loading="lazy"` attribute is **inert** here: this component never points an
	 * `<img>` at a network URL -- it fetches the bytes itself over XHR (so a Bearer/api-key request
	 * carries its credentials) and only then renders an `<img>` at an already-resolved object URL.
	 * So lazy loading has to be implemented by hand, which is what this flag turns on: while off
	 * screen, a same-box placeholder is rendered and watched with an IntersectionObserver, and the
	 * fetch only starts once it intersects. Once fetched, it is never un-fetched.
	 *
	 * Opt-in rather than default-on because the placeholder has to have real dimensions for the
	 * observer to ever fire. That holds for callers that render into a sized box (`ThumbnailImage`),
	 * but not for ones whose sizing comes from the intrinsic size of the loaded image (`EntityImage`
	 * in the readers, where a zero-height placeholder would never intersect and the page would
	 * simply never load).
	 */
	lazy?: boolean
} & React.ImgHTMLAttributes<HTMLImageElement>

/** Start fetching a bit before the image scrolls into view, so it is usually decoded by the time
 *  it is actually on screen. Matches the spirit of the browser's own lazy-loading margin. */
const LAZY_ROOT_MARGIN = '400px'

export const AuthImage = forwardRef<HTMLImageElement, Props>(
	({ token, src, lazy = false, ...props }, ref) => {
		const { sdk } = useSDK()

		const [imageURL, setImageURL] = useState<string | null>(null)

		// A callback ref (state, not `useRef`) so the observer effect re-runs when the placeholder
		// actually mounts -- a ref's `.current` mutation wouldn't retrigger it, and reading a ref
		// during render is exactly the pattern react-compiler rejects.
		const [placeholder, setPlaceholder] = useState<HTMLElement | null>(null)
		// Latched: once true it never goes back to false, so scrolling away mid-flight (or after)
		// can't cancel or re-trigger the fetch. Non-lazy callers start "visible" immediately, as do
		// environments without IntersectionObserver (older browsers, jsdom) -- degrading to the
		// previous eager behaviour is strictly better than never loading.
		const [isVisible, setIsVisible] = useState(
			() => !lazy || typeof IntersectionObserver === 'undefined',
		)

		useEffect(() => {
			if (isVisible || !placeholder) return

			const observer = new IntersectionObserver(
				(entries) => {
					if (entries.some((entry) => entry.isIntersecting)) {
						setIsVisible(true)
						observer.disconnect()
					}
				},
				{ rootMargin: LAZY_ROOT_MARGIN },
			)
			observer.observe(placeholder)

			return () => observer.disconnect()
		}, [isVisible, placeholder])

		const doFetch = useCallback(
			async (url: string) => {
				const response = await sdk.axios.get(url, { responseType: 'arraybuffer' })
				const blob = new Blob([response.data], {
					type: contentHeader(response.headers['content-type']),
				})
				return blob
			},
			[sdk.axios],
		)
		const fetchImage = useCallback(
			async (url: string) => {
				const data = await queryClient.fetchQuery({
					queryKey: ['AuthImage.fetchImage', url],
					staleTime: 1000 * 60 * 60 * 24 * 5, // 5 days
					queryFn: async () => doFetch(url),
				})
				// Bytes are already in hand -- zero extra network cost to also feed the passive cache.
				void cacheAlreadyFetched(url, data)

				const imageURL = URL.createObjectURL(data)
				setImageURL(imageURL)
			},
			[doFetch],
		)

		useEffect(() => {
			if (token && src && isVisible && !imageURL) {
				fetchImage(src)
			}
		}, [token, src, fetchImage, imageURL, isVisible])

		useEffect(() => {
			return () => {
				if (imageURL) {
					URL.revokeObjectURL(imageURL)
				}
			}
		}, [imageURL])

		if (!imageURL) {
			// Only lazy mode renders a placeholder, and only while still off screen -- it exists purely
			// to give the observer something with the image's box to watch. Eager mode keeps the
			// historical "render nothing until the bytes resolve" behaviour.
			if (lazy && !isVisible) {
				return (
					<span
						ref={setPlaceholder}
						aria-hidden
						data-testid="auth-image-lazy-placeholder"
						className={props.className}
						style={props.style}
					/>
				)
			}
			return null
		}

		return <img {...props} ref={ref} src={imageURL ?? undefined} />
	},
)
AuthImage.displayName = 'AuthImage'

const contentHeader = (raw: unknown) => {
	if (typeof raw === 'string') return raw
	return 'application/octet-stream'
}
