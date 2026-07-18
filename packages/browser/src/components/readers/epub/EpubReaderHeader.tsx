import { cn, Spacer, Text } from '@longbox/components'
import { ArrowLeft } from 'lucide-react'
import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'

import { useBookPreferences } from '@/scenes/book/reader/useBookPreferences'

import paths from '../../../paths'
import { useEpubReaderContext } from './context'
import {
	BookmarkToggle,
	ControlButton,
	ControlsContainer,
	FullScreenToggle,
	SearchCommand,
	ThemeControls,
} from './controls'
import { LocationManager } from './locations'

export default function EpubReaderHeader() {
	const {
		readerMeta: { bookEntity },
	} = useEpubReaderContext()
	const {
		bookPreferences: { fontFamily },
	} = useBookPreferences({ book: bookEntity })
	const location = useLocation()

	const [exitTo] = useState(
		() =>
			(location.state as { from?: string } | null)?.from ??
			paths.bookOverview(bookEntity?.id || ''),
	)

	return (
		<ControlsContainer position="top">
			<div className="gap-x-2 flex items-center">
				<Link to={exitTo} title="Book Overview">
					<ControlButton>
						<ArrowLeft className="h-4 w-4" />
					</ControlButton>
				</Link>

				<LocationManager />
			</div>

			<Spacer />

			<Text
				size="sm"
				className={cn('line-clamp-1', {
					[`font-${fontFamily?.toLowerCase().replace(/_/g, '')}`]: !!fontFamily,
				})}
			>
				{bookEntity.resolvedName}
			</Text>

			<Spacer />

			<div className="gap-x-2 flex items-center">
				<SearchCommand />
				<ThemeControls />
				<FullScreenToggle />
				<BookmarkToggle />
			</div>
		</ControlsContainer>
	)
}
