import { cn } from '@stump/components'
import { ReadingDirection, ReadingMode } from '@stump/graphql'
import { motion } from 'framer-motion'

import { useBookPreferences } from '@/scenes/book/reader/useBookPreferences'

import { useImageBaseReaderContext } from '../context'

const transition = {
	hidden: { opacity: 0 },
	visible: { opacity: 1 },
}

/**
 * A hairline reading-progress fill pinned to the bottom edge. It is shown only while the
 * toolbar is hidden; when the toolbar opens, the full footer's own ProgressBar takes over,
 * so the two never stack. `pointer-events-none` keeps taps falling through to the page so
 * tap-to-toggle-toolbar still works.
 */
export default function ReaderProgressLine() {
	const { book, currentPage } = useImageBaseReaderContext()
	const {
		settings: { showToolBar },
		bookPreferences: { readingMode, readingDirection },
	} = useBookPreferences({ book })

	const lastPage = Math.max(1, book.pages)
	const pct = Math.min(100, Math.max(0, (currentPage / lastPage) * 100))
	const isRtl = readingDirection === ReadingDirection.Rtl && readingMode === ReadingMode.Paged

	return (
		<motion.div
			// @ts-expect-error: role/aria-*/data-*/className are valid on motion components in this setup
			role="progressbar"
			aria-valuemin={1}
			aria-valuemax={book.pages}
			aria-valuenow={currentPage}
			data-state={showToolBar ? 'hidden' : 'visible'}
			className={cn('inset-x-0 bottom-0 h-0.5 pointer-events-none fixed z-[90] flex', {
				'justify-end': isRtl,
			})}
			style={{ marginBottom: 'var(--spacing-safe-bottom, 0px)' }}
			initial={false}
			animate={showToolBar ? 'hidden' : 'visible'}
			variants={transition}
			transition={{ duration: 0.2, ease: 'easeInOut' }}
		>
			<div className="h-full bg-[#898d94]" style={{ width: `${pct}%` }} />
		</motion.div>
	)
}
