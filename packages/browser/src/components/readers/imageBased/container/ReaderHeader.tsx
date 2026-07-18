import { Link, Text } from '@longbox/components'
import { motion } from 'framer-motion'
import { ArrowLeft, Fullscreen, Shrink } from 'lucide-react'
import { useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useFullscreen } from 'rooks'

import { usePaths } from '@/paths'
import { useBookPreferences } from '@/scenes/book/reader/useBookPreferences'

import { useImageBaseReaderContext } from '../context'
import ControlButton from './ControlButton'
import SettingsDialog from './SettingsDialog'
import TimerMenu from './TimerMenu'

export default function ReaderHeader() {
	const { book } = useImageBaseReaderContext()
	const {
		settings: { showToolBar },
	} = useBookPreferences({ book })
	const paths = usePaths()
	const location = useLocation()

	const { id, resolvedName } = book

	const [exitTo] = useState(
		() => (location.state as { from?: string } | null)?.from ?? paths.bookOverview(id),
	)

	const { isFullscreenAvailable, isFullscreenEnabled, toggleFullscreen } = useFullscreen()

	const FullScreenIcon = isFullscreenEnabled ? Shrink : Fullscreen

	return (
		<motion.nav
			// @ts-expect-error: It does have className?
			// The bar grows by the top inset (pt-safe on top of the base 3rem height) so the
			// controls keep their full row clear of the status bar / punch-hole. Horizontal
			// padding holds at 1rem in portrait and widens to a side notch in landscape.
			className="left-0 top-0 fixed z-100 flex h-[calc(3rem+var(--spacing-safe-top))] w-full items-center pt-safe pr-[max(1rem,var(--spacing-safe-right))] pl-[max(1rem,var(--spacing-safe-left))] text-foreground"
			initial={false}
			animate={showToolBar ? 'visible' : 'hidden'}
			variants={transition}
			transition={{ duration: 0.2, ease: 'easeInOut' }}
		>
			<div className="gap-2 flex w-full items-center justify-between">
				<div className="space-x-4 flex shrink-0 items-center">
					<Link
						className="flex items-center text-foreground hover:text-foreground/80"
						title="Go to media overview"
						to={exitTo}
					>
						<ArrowLeft size={'1.25rem'} />
					</Link>
				</div>

				<Text className="min-w-0 truncate text-foreground">{resolvedName}</Text>

				<div className="space-x-1.5 flex shrink-0 items-center">
					{isFullscreenAvailable && (
						<ControlButton onClick={toggleFullscreen}>
							<FullScreenIcon className="h-4 w-4" />
						</ControlButton>
					)}

					<TimerMenu />

					<SettingsDialog />
				</div>
			</div>
		</motion.nav>
	)
}

const transition = {
	hidden: {
		opacity: 0,
		transition: {
			duration: 0.2,
			ease: 'easeInOut',
		},
		y: '-100%',
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
