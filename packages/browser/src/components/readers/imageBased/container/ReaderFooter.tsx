/* eslint-disable react-compiler/react-compiler */
import { useSDK } from '@longbox/client'
import { cn, ProgressBar, Text, usePreviousIsDifferent } from '@longbox/components'
import { ReadingDirection, ReadingMode } from '@longbox/graphql'
import { formatHumanDuration } from '@longbox/i18n'
import { PagePreviewWidth } from '@longbox/sdk'
import { motion } from 'framer-motion'
import { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ItemProps, ScrollerProps, Virtuoso, VirtuosoHandle } from 'react-virtuoso'

import { EntityImage } from '@/components/entity'
import { usePreferences } from '@/hooks/usePreferences'
import { useBookPreferences } from '@/scenes/book/reader/useBookPreferences'

import { useImageBaseReaderContext } from '../context'

const SIZE_MODIFIER = 1.5

/**
 * The width to request each preview at. Items are painted at 100 CSS px (150 for the enlarged
 * current set), so 320 covers a 2x render and 480 a 3x one. Choosing off device pixel ratio rather
 * than always asking for the largest keeps a 1x/2x client from paying for pixels it cannot show,
 * and both are ~20x lighter than the source page these previews used to be.
 */
const previewWidth = (): PagePreviewWidth => ((globalThis.devicePixelRatio ?? 1) > 2 ? 480 : 320)

export default function ReaderFooter() {
	const { sdk } = useSDK()
	const { book, currentPage, setCurrentPage, imageSizes, pageSets, timer } =
		useImageBaseReaderContext()
	const {
		settings: { showToolBar, preload },
		bookPreferences: { readingMode, readingDirection, trackElapsedTime },
	} = useBookPreferences({ book })
	const {
		preferences: { thumbnailRatio },
	} = usePreferences()

	const virtuosoRef = useRef<VirtuosoHandle>(null)

	const currentPageSetIdx = useMemo(
		() => pageSets.findIndex((set) => set.includes(currentPage - 1)),
		[currentPage, pageSets],
	)
	const currentSet = useMemo(
		() => pageSets.find((set) => set.includes(currentPage - 1)) || [currentPage - 1],
		[currentPage, pageSets],
	)

	const showToolBarChanged = usePreviousIsDifferent(showToolBar)
	const readingDirectionChanged = usePreviousIsDifferent(readingDirection)

	/**
	 * The footer animates in and out rather than unmounting, so the preview strip would otherwise
	 * start fetching a thumbnail for every visible page the moment a book is opened -- competing
	 * for bandwidth with the page the reader is actually trying to paint, and doing it whether or
	 * not the toolbar is ever shown. Latched rather than read straight off `showToolBar` so
	 * dismissing the toolbar doesn't discard previews the user is about to want back.
	 */
	const [toolBarHasBeenShown, setToolBarHasBeenShown] = useState(showToolBar)
	useEffect(() => {
		if (showToolBar) setToolBarHasBeenShown(true)
	}, [showToolBar])
	// Centering the *first* open is `initialTopMostItemIndex`'s job, not this effect's: the strip
	// mounts a render after the toolbar is shown, and a `scrollToIndex` against a freshly mounted
	// list that has not measured an item yet leaves the current page pinned to the left edge.
	// Every later open runs through here, by which point the list is mounted and measured.
	useEffect(() => {
		if (showToolBar) {
			virtuosoRef.current?.scrollToIndex({
				align: 'center',
				behavior: showToolBarChanged || readingDirectionChanged ? 'auto' : 'smooth',
				index: currentPageSetIdx,
			})
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [showToolBar, currentPageSetIdx])

	const elapsedSeconds = timer.getCurrentTime()
	const formattedReadTime = formatHumanDuration(elapsedSeconds)

	const renderItem = useCallback(
		(idx: number, indexes: number[]) => {
			const isDoubleSpread = indexes.length === 2
			const isLandscape = indexes.some((page) => (imageSizes?.[page]?.ratio || 0) >= 1)
			const isCurrentSet = currentPageSetIdx === idx

			let pageSetSize = {
				width: 100,
				height: 100 / thumbnailRatio,
			}
			let containerSize

			if (isLandscape || isDoubleSpread) {
				pageSetSize = {
					height: pageSetSize.height,
					width: pageSetSize.width * 2,
				}
			}

			if (!isCurrentSet) {
				containerSize = {
					height: pageSetSize.height * SIZE_MODIFIER + 10, // add space for the translateY(-10px)
					width: pageSetSize.width,
				}
			} else {
				containerSize = {
					height: pageSetSize.height * SIZE_MODIFIER + 10, // add space for the translateY(-10px)
					width: pageSetSize.width * SIZE_MODIFIER,
				}
				pageSetSize = {
					height: pageSetSize.height * SIZE_MODIFIER,
					width: pageSetSize.width * SIZE_MODIFIER,
				}
			}

			return (
				<div className="flex flex-col justify-end" style={containerSize}>
					<div
						className={cn(
							'shadow-xl flex cursor-pointer overflow-hidden rounded-lg border-2 border-transparent transition duration-300 hover:border-primary',
							{ 'rounded-[10px] border-primary': isCurrentSet },
						)}
						style={{
							...pageSetSize,
							transform: isCurrentSet ? 'translateY(-10px)' : 'translateY(0px)',
						}}
					>
						{/*
						 * Deliberately no `onLoad` -> `setPageSize`. These are downscaled previews, so
						 * their natural dimensions are the preview's, not the page's -- and the shared
						 * size cache they used to be written into is what `generatePageSets` reads to
						 * decide which pages are landscape. A resize rounds twice, so a near-square
						 * page could come back the other side of that test and flip double-page
						 * pairing. Real page dimensions come from the server's analysis data and from
						 * the reader's own page loads, both of which measure the actual page.
						 */}
						{indexes.map((index) => (
							<EntityImage
								src={sdk.media.bookPageURL(book.id, index + 1, { width: previewWidth() })}
								className="h-full w-full object-cover"
								key={index}
								onClick={() => setCurrentPage(index + 1)}
							/>
						))}
					</div>
					{!isCurrentSet && (
						<Text size="sm" className="shrink-0 text-center text-[#898d94]">
							{[...indexes]
								.sort((a, b) => a - b)
								.map((i) => i + 1)
								.join('-')}
						</Text>
					)}
				</div>
			)
		},
		[imageSizes, sdk, book.id, setCurrentPage, currentPageSetIdx, thumbnailRatio],
	)

	return (
		<motion.nav
			initial={false}
			animate={showToolBar ? 'visible' : 'hidden'}
			variants={transition}
			transition={{ duration: 0.2, ease: 'easeInOut' }}
			// @ts-expect-error: It does have className?
			className="bottom-0 left-0 gap-2 text-white shadow-lg fixed z-100 flex w-full flex-col justify-end overflow-hidden"
		>
			{readingMode === ReadingMode.Paged && toolBarHasBeenShown && (
				<Virtuoso
					ref={virtuosoRef}
					style={{
						height:
							(100 / thumbnailRatio) * SIZE_MODIFIER + // item height (all items have the same fixed height)
							12 + // scrollbar vertical height
							10 + // translateY padding
							8, // add some vertical padding between the scrollbar and items
					}}
					horizontalDirection
					data={pageSets}
					components={{
						Item,
						Scroller,
					}}
					itemContent={renderItem}
					overscan={{ main: preload.ahead || 1, reverse: preload.behind || 1 }}
					initialTopMostItemIndex={{
						align: 'center',
						index:
							readingDirection === ReadingDirection.Rtl
								? pageSets.length - currentPageSetIdx
								: currentPageSetIdx,
					}}
				/>
			)}

			<div className="gap-2 flex w-full flex-col pr-[max(1rem,var(--spacing-safe-right))] pb-[calc(1rem+var(--spacing-safe-bottom))] pl-[max(1rem,var(--spacing-safe-left))]">
				<ProgressBar
					size="sm"
					value={currentPage}
					max={book.pages}
					className="bg-[#0c0c0c]"
					indicatorClassName="bg-[#898d94]"
					inverted={readingDirection === ReadingDirection.Rtl && readingMode === ReadingMode.Paged}
				/>

				<div
					className={cn('flex flex-row justify-between', { 'justify-around': !trackElapsedTime })}
				>
					{trackElapsedTime && (
						<Text className="text-sm text-[#898d94]">Reading time: {formattedReadTime}</Text>
					)}

					<Text className="text-sm text-[#898d94]">
						{[...currentSet]
							.map((idx) => idx + 1)
							.sort((a, b) => a - b)
							.join('-')}
						{' of '}
						{book.pages}
					</Text>
				</div>
			</div>
		</motion.nav>
	)
}

const Scroller = forwardRef<HTMLDivElement, ScrollerProps>(({ children, ...props }, ref) => {
	return (
		<div className="x-6 overflow-y-hidden" ref={ref} {...props}>
			{children}
		</div>
	)
})
Scroller.displayName = 'Scroller'

const Item = forwardRef<HTMLDivElement, ItemProps<number[]>>(
	({ children, style, ...props }, ref) => {
		return (
			<div
				className="px-1 select-none"
				ref={ref}
				{...props}
				style={{
					...style,
					verticalAlign: 'bottom',
				}}
			>
				{children}
			</div>
		)
	},
)
Item.displayName = 'Item'

const transition = {
	hidden: {
		opacity: 0,
		transition: {
			duration: 0.2,
			ease: 'easeInOut',
		},
		y: '100%',
	},
	visible: {
		opacity: 1,
		transition: {
			duration: 0.2,
			ease: 'easeInOut',
		},
		y: 0,
	},
}
