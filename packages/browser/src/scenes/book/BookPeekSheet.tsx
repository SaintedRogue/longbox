import { cn, SheetPrimitive } from '@stump/components'
import { Suspense, useState } from 'react'
import { useNavigate, useParams } from 'react-router'

import { useBookOverview } from '@/components/book'

import BookOverviewContent from './BookOverviewContent'

/**
 * The book detail "peek" overlay. Rendered by AppLayout as a nested
 * `<Routes>` matched against the real browser location whenever
 * `state.backgroundLocation` is present (see AppRouter/BookCard) -- the main
 * route tree keeps rendering the browse context (grid, search results, etc.)
 * behind it, preserving scroll position.
 *
 * Deliberately uses `SheetPrimitive` directly rather than the shared `Sheet`
 * wrapper: `Sheet` fires `onClose` on every location change including
 * mount, which would immediately close a sheet that was opened by
 * navigating here.
 */
export default function BookPeekSheet() {
	const { id } = useParams()
	const navigate = useNavigate()
	const [open, setOpen] = useState(true)

	const handleOpenChange = (isOpen: boolean) => {
		setOpen(isOpen)
		if (!isOpen) {
			// Return to the background location this peek was opened over.
			navigate(-1)
		}
	}

	if (!id) return null

	return (
		<SheetPrimitive open={open} onOpenChange={handleOpenChange}>
			<SheetPrimitive.Content
				position="right"
				size="xl"
				closeIcon
				className={cn(
					'overflow-y-auto border-l-2 border-l-brand-500/70',
					// A restrained "pulled from the box" entrance: the default
					// slide-in-from-right/fade stay, plus a couple of degrees of
					// settle-in rotation -- composed with tw-animate-css's enter
					// keyframe rather than a bespoke one.
					'data-[state=open]:spin-in-2',
				)}
			>
				<SheetPrimitive.Header>
					<Suspense
						fallback={<SheetPrimitive.Title className="sr-only">Book details</SheetPrimitive.Title>}
					>
						<BookPeekSheetTitle id={id} />
					</Suspense>
				</SheetPrimitive.Header>

				<Suspense fallback={null}>
					<BookOverviewContent id={id} variant="sheet" />
				</Suspense>
			</SheetPrimitive.Content>
		</SheetPrimitive>
	)
}

/**
 * Title-only sliver of the book overview query, split out so the sheet
 * header (required by Radix for a11y) can resolve independently of the
 * heavier body content below it. Shares the same react-query cache key as
 * BookOverviewContent, so this does not issue a second network request.
 */
function BookPeekSheetTitle({ id }: { id: string }) {
	const {
		data: { mediaById: media },
	} = useBookOverview(id)

	return (
		<SheetPrimitive.Title className="sr-only">
			{media?.resolvedName ?? 'Book details'}
		</SheetPrimitive.Title>
	)
}
