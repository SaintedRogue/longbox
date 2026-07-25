import { useSDK } from '@longbox/client'
import { cn } from '@longbox/components'
import { AnimatePresence, motion } from 'framer-motion'
import { forwardRef, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { cacheOnViewOnce } from '@/offline/cacheOnViewOnce'
import { useOfflineImageSrc } from '@/offline/resolveOfflineUrl'

import { AuthImage } from '../entity/AuthImage'
import { ThumbnailPlaceholder, ThumbnailPlaceholderData } from './ThumbnailPlaceholder'

export type ThumbnailImageSize = {
	height: number | string
	width: number | string
}

export type ThumbnailGradient = {
	colors: string[]
	/**
	 * CSS gradient direction (e.g., 'to bottom', '180deg')
	 */
	direction?: string
}

export type BorderAndShadowStyle = {
	borderRadius?: number | string
	borderWidth?: number
	shadowRadius?: number
	shadowColor?: string
	shadowOffsetX?: number
	shadowOffsetY?: number
}

export type ThumbnailImageProps = {
	src: string
	alt?: string
	size?: ThumbnailImageSize
	gradient?: ThumbnailGradient
	placeholderData?: ThumbnailPlaceholderData | null
	/**
	 * Override the default border and shadow style
	 */
	borderAndShadowStyle?: Partial<BorderAndShadowStyle>
	className?: string
	imageClassName?: string
	/**
	 * Whether to lazy load the image, which should help with perf. Defaults to `true`: virtually
	 * every usage is a cover inside a scrolling grid/carousel, the majority of which are offscreen
	 * on first paint (a live home page measured 26 of 30 covers offscreen). Set `priority` instead
	 * of `lazy={false}` for above-the-fold images so the intent is explicit.
	 */
	lazy?: boolean
	/**
	 * Opt out of lazy loading for a genuinely above-the-fold image (e.g. a detail page's hero
	 * cover, which is usually the LCP element). Forces an eager load at high fetch priority, and
	 * wins over `lazy`.
	 */
	priority?: boolean
	onLoad?: () => void
	onError?: () => void
}

export const ThumbnailImage = forwardRef<HTMLDivElement, ThumbnailImageProps>(
	(
		{
			src,
			alt = '',
			size,
			gradient,
			placeholderData,
			borderAndShadowStyle,
			className,
			imageClassName,
			lazy = true,
			priority = false,
			onLoad,
			onError,
		},
		ref,
	) => {
		const { sdk } = useSDK()

		// Mirrors EntityImage's pattern: offline hits win over both AuthImage and a plain network
		// <img>, so cached bytes are served (and reused) instead of re-fetching over the network.
		const offlineSrc = useOfflineImageSrc(src)

		const [isLoaded, setIsLoaded] = useState(false)
		const [hasError, setHasError] = useState(false)

		const imageRef = useRef<HTMLImageElement | null>(null)

		// Note: I added this because the placeholder was ALWAYS flashing on initial load,
		// so this should help prevent that
		useLayoutEffect(() => {
			if (imageRef.current?.complete && imageRef.current.naturalWidth > 0) {
				setIsLoaded(true)
			}
		}, [src])

		// https://developer.mozilla.org/en-US/docs/Web/API/Document/visibilitychange_event
		useEffect(() => {
			const handleVisibilityChange = () => {
				if (document.visibilityState === 'visible' && imageRef.current) {
					const img = imageRef.current
					// Note: Apparently naturalWidth is 0 if returning after tab was suspended
					if (isLoaded && (!img.complete || img.naturalWidth === 0)) {
						setIsLoaded(false)
					}
				}
			}

			document.addEventListener('visibilitychange', handleVisibilityChange)
			return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
		}, [isLoaded])

		const computedStyles = useMemo(() => {
			const widthNum = typeof size?.width === 'number' ? size.width : 192
			return {
				borderRadius: borderAndShadowStyle?.borderRadius ?? widthNum / 20,
				borderWidth: borderAndShadowStyle?.borderWidth ?? Math.max(0.3, widthNum / 500),
				shadowRadius: borderAndShadowStyle?.shadowRadius ?? widthNum / 100,
				shadowColor: borderAndShadowStyle?.shadowColor ?? 'rgba(0,0,0,0.2)',
				shadowOffsetX: borderAndShadowStyle?.shadowOffsetX ?? 0,
				shadowOffsetY: borderAndShadowStyle?.shadowOffsetY ?? 1,
			}
		}, [size?.width, borderAndShadowStyle])

		const containerStyle = useMemo(
			() => ({
				width: size?.width,
				height: size?.height,
				borderRadius: computedStyles.borderRadius,
				boxShadow: `${computedStyles.shadowOffsetX}px ${computedStyles.shadowOffsetY}px ${computedStyles.shadowRadius}px ${computedStyles.shadowColor}`,
			}),
			[size, computedStyles],
		)

		const borderStyle = useMemo(
			() => ({
				borderRadius: computedStyles.borderRadius,
				borderWidth: computedStyles.borderWidth,
			}),
			[computedStyles],
		)

		const gradientStyle = useMemo(() => {
			if (!gradient?.colors || gradient.colors.length === 0) {
				return null
			}
			const direction = gradient.direction ?? 'to bottom'
			return {
				background: `linear-gradient(${direction}, ${gradient.colors.join(', ')})`,
				borderRadius: computedStyles.borderRadius,
			}
		}, [gradient, computedStyles.borderRadius])

		const handleLoad = () => {
			setIsLoaded(true)
			onLoad?.()
		}

		// Session-mode, network (cache-miss) branch only -- same "shadow fetch" side channel as
		// EntityImage.tsx. The offline-hit branch and AuthImage (token-mode) are handled elsewhere.
		// Once-per-session (see `cacheOnViewOnce`): the same cover is re-rendered across grids,
		// carousels and peek sheets, and every repeat re-GET was pure waste.
		const handleNetworkLoad = () => {
			handleLoad()
			void cacheOnViewOnce(src, sdk)
		}

		const handleError = () => {
			setHasError(true)
			onError?.()
		}

		const imageClasses = cn('inset-0 absolute z-15 h-full w-full object-cover', imageClassName)

		const imageStyle = { borderRadius: computedStyles.borderRadius }

		// `priority` always wins: an above-the-fold cover must not be deferred behind the browser's
		// lazy-loading heuristics, and gets `fetchpriority="high"` so it isn't queued behind the
		// (now lazy) covers further down the page.
		const isLazy = lazy && !priority

		// Lazy loading attributes for improved scroll performance. `decoding="async"` is applied on
		// both paths -- it keeps the decode off the main thread regardless of when the fetch starts.
		const lazyProps = {
			decoding: 'async' as const,
			loading: isLazy ? ('lazy' as const) : ('eager' as const),
			...(priority ? { fetchPriority: 'high' as const } : {}),
		}

		const renderImage = () => {
			if (offlineSrc) {
				return (
					<img
						ref={imageRef}
						src={offlineSrc}
						alt={alt}
						className={imageClasses}
						style={imageStyle}
						onLoad={handleLoad}
						onError={handleError}
						{...lazyProps}
					/>
				)
			}

			if (sdk.isTokenAuth) {
				// `loading="lazy"` is inert on AuthImage (it fetches over XHR, then renders an
				// already-resolved object URL), so `lazy` is passed explicitly: it switches AuthImage
				// to its IntersectionObserver-gated mode. Safe here specifically because a
				// ThumbnailImage always renders into a sized box (`containerStyle` / the caller's
				// aspect-ratio wrapper), so AuthImage's placeholder has real dimensions to observe.
				return (
					<AuthImage
						ref={imageRef}
						src={src}
						token={sdk.token || ''}
						alt={alt}
						className={imageClasses}
						style={imageStyle}
						onLoad={handleLoad}
						onError={handleError}
						lazy={isLazy}
						{...lazyProps}
					/>
				)
			}

			return (
				<img
					ref={imageRef}
					src={src}
					alt={alt}
					className={imageClasses}
					style={imageStyle}
					onLoad={handleNetworkLoad}
					onError={handleError}
					{...lazyProps}
				/>
			)
		}

		return (
			<div ref={ref} className={cn('relative overflow-hidden', className)} style={containerStyle}>
				<ThumbnailPlaceholder {...placeholderData} className="rounded-[inherit]" />

				<AnimatePresence>
					{!hasError && (
						<motion.div
							key={src}
							initial={{ opacity: 0 }}
							animate={{ opacity: isLoaded ? 1 : 0 }}
							transition={{ duration: 0.3, ease: 'easeOut' }}
							// @ts-expect-error: It has className
							className="inset-0 absolute z-15"
						>
							{renderImage()}
						</motion.div>
					)}
				</AnimatePresence>

				{gradientStyle && <div className="inset-0 absolute z-20" style={gradientStyle} />}

				<div
					className="inset-0 pointer-events-none absolute z-25 border-thumbnail-border"
					style={{
						...borderStyle,
						borderStyle: 'solid',
					}}
				/>
			</div>
		)
	},
)

ThumbnailImage.displayName = 'ThumbnailImage'
