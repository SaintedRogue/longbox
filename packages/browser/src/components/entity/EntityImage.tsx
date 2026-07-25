import { useSDK } from '@longbox/client'
import { forwardRef, Suspense, useCallback } from 'react'

import { cacheOnViewOnce } from '@/offline/cacheOnViewOnce'
import { useOfflineImageSrc } from '@/offline/resolveOfflineUrl'

import { AuthImage } from './AuthImage'

type Props = {
	onLoad?: ({ height, width }: { height: number; width: number }) => void
	/**
	 * Whether to lazy load the image. Defaults to `true`: most usages are covers/pages in scrolling
	 * grids, tables and lists where the majority of images are offscreen on first paint. Set
	 * `priority` (rather than `lazy={false}`) for above-the-fold images so the intent is explicit.
	 */
	lazy?: boolean
	/**
	 * Opt out of lazy loading for an image that must not be deferred -- an above-the-fold hero, or
	 * the readers' page images, where deferring would defeat the whole point of the reader's
	 * preloading. Forces an eager load at high fetch priority, and wins over `lazy`.
	 */
	priority?: boolean
} & Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'onLoad'>

const EntityImage = forwardRef<HTMLImageElement, Props>(
	(
		{ src, onLoad, lazy = true, priority = false, loading, decoding, fetchPriority, ...props },
		ref,
	) => {
		const { sdk } = useSDK()

		// Checked above the token/session split: session-mode's plain <img> is browser-fetched (no JS
		// to intercept at the network layer), so the only way to serve cached bytes there is to swap
		// `src` for an object URL before render -- which also means offline must win in token mode too,
		// since AuthImage would otherwise re-fetch over the network. useOfflineImageSrc resolves to
		// `undefined` until checked and for non-downloaded images, so the common (non-downloaded) path
		// still renders the network image immediately with no blank flash.
		const offlineSrc = useOfflineImageSrc(typeof src === 'string' ? src : undefined)

		// An explicit `loading`/`decoding`/`fetchPriority` from the caller always wins over the
		// defaults derived from `lazy`/`priority`. `decoding="async"` is the default on every path --
		// it keeps decodes off the main thread regardless of when the fetch starts.
		const loadingProps = {
			decoding: decoding ?? ('async' as const),
			loading: loading ?? (lazy && !priority ? ('lazy' as const) : ('eager' as const)),
			...(fetchPriority || priority ? { fetchPriority: fetchPriority ?? ('high' as const) } : {}),
		}

		const handleImageLoad = useCallback(
			(e: React.SyntheticEvent<HTMLImageElement, Event>) => {
				const img = e.target as HTMLImageElement
				if (img.naturalHeight && img.naturalWidth) {
					onLoad?.({ height: img.naturalHeight, width: img.naturalWidth })
				}
			},
			[onLoad],
		)

		// Session-mode, network (cache-miss) branch only: the browser fetched `src` directly (no JS
		// interception), so this is a "shadow fetch" side channel -- re-GET the same bytes to feed the
		// passive cache, without changing how the visible <img> itself loads. Offline-hit and
		// AuthImage (token-mode) branches are handled elsewhere (resolveOfflineUrl / AuthImage.tsx).
		// `cacheOnViewOnce` (not `cacheOnView`) so a URL that gets loaded repeatedly -- the readers
		// remount the same page image on every scale/page-set change -- only shadow-fetches once.
		const handleNetworkImageLoad = useCallback(
			(e: React.SyntheticEvent<HTMLImageElement, Event>) => {
				handleImageLoad(e)
				if (typeof src === 'string') {
					void cacheOnViewOnce(src, sdk)
				}
			},
			[handleImageLoad, src, sdk],
		)

		const renderImage = () => {
			if (offlineSrc) {
				return (
					<img {...loadingProps} {...props} src={offlineSrc} ref={ref} onLoad={handleImageLoad} />
				)
			} else if (sdk.isTokenAuth) {
				// `lazy` is deliberately NOT forwarded: AuthImage's lazy mode needs a placeholder with
				// real dimensions to observe, and EntityImage's box is caller-controlled (the readers
				// size from the loaded image's intrinsic size), so a zero-height placeholder would
				// never intersect and the image would never load. The loading/decoding attributes are
				// still passed through -- inert on AuthImage's object-URL <img>, but harmless.
				return (
					<AuthImage
						src={src || ''}
						token={sdk.token || ''}
						{...loadingProps}
						{...props}
						ref={ref}
						onLoad={handleImageLoad}
					/>
				)
			} else {
				return (
					<img src={src} {...loadingProps} {...props} ref={ref} onLoad={handleNetworkImageLoad} />
				)
			}
		}

		return <Suspense>{renderImage()}</Suspense>
	},
)
EntityImage.displayName = 'EntityImage'

export { EntityImage }
