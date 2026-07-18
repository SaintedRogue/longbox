import { useSDK } from '@longbox/client'
import { forwardRef, Suspense, useCallback } from 'react'

import { useOfflineImageSrc } from '@/offline/resolveOfflineUrl'

import { AuthImage } from './AuthImage'

type Props = {
	onLoad?: ({ height, width }: { height: number; width: number }) => void
} & Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'onLoad'>

const EntityImage = forwardRef<HTMLImageElement, Props>(({ src, onLoad, ...props }, ref) => {
	const { sdk } = useSDK()

	// Checked above the token/session split: session-mode's plain <img> is browser-fetched (no JS
	// to intercept at the network layer), so the only way to serve cached bytes there is to swap
	// `src` for an object URL before render -- which also means offline must win in token mode too,
	// since AuthImage would otherwise re-fetch over the network. useOfflineImageSrc resolves to
	// `undefined` until checked and for non-downloaded images, so the common (non-downloaded) path
	// still renders the network image immediately with no blank flash.
	const offlineSrc = useOfflineImageSrc(typeof src === 'string' ? src : undefined)

	const handleImageLoad = useCallback(
		(e: React.SyntheticEvent<HTMLImageElement, Event>) => {
			const img = e.target as HTMLImageElement
			if (img.naturalHeight && img.naturalWidth) {
				onLoad?.({ height: img.naturalHeight, width: img.naturalWidth })
			}
		},
		[onLoad],
	)

	const renderImage = () => {
		if (offlineSrc) {
			return <img {...props} src={offlineSrc} ref={ref} onLoad={handleImageLoad} />
		} else if (sdk.isTokenAuth) {
			return (
				<AuthImage
					src={src || ''}
					token={sdk.token || ''}
					{...props}
					ref={ref}
					onLoad={handleImageLoad}
				/>
			)
		} else {
			return <img src={src} {...props} ref={ref} onLoad={handleImageLoad} />
		}
	}

	return <Suspense>{renderImage()}</Suspense>
})
EntityImage.displayName = 'EntityImage'

export { EntityImage }
