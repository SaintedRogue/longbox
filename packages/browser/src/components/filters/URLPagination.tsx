import { cn, IconButton, ToolTip } from '@longbox/components'
import { useLocaleContext } from '@longbox/i18n'
import { ChevronLeft, ChevronRight, MoreHorizontal } from 'lucide-react'
import { useCallback, useMemo } from 'react'
import { useWindowSize } from 'rooks'

import { usePagination } from '../../hooks/usePagination'
import PagePopoverForm from '../PagePopoverForm'

type Props = {
	pages: number
	currentPage: number
	onChangePage: (page: number) => void
	onPrefetchPage?: (page: number) => void
}

/**
 * How many page numbers to show at once.
 *
 * Deliberately small on narrow screens, because the budget is real: a 375px viewport leaves
 * 343px inside the footer's padding, and every slot is a 44px touch target. `usePagination`
 * pads its window with first/last/ellipsis, so asking for 5 yields *seven* slots -- 396px
 * with the two arrows, which overflows. Asking for 3 yields at most five slots (308px) and
 * still keeps page 1 and the last page one tap away. Shrinking the buttons instead would buy
 * the space by breaking the touch minimum, which is the wrong trade on the surface that is
 * hardest to tap accurately.
 */
const visiblePageCount = (screenWidth: number | null) => {
	if (screenWidth == null) return 7
	if (screenWidth < 640) return 3
	if (screenWidth < 1024) return 7
	return 10
}

/**
 * The page control in the browse footer.
 *
 * This was previously a 28px `<input type="number">` that only committed on Enter and
 * silently reverted whatever you had typed if you clicked away, which made moving through a
 * 13-page library a chore. Pages are now directly clickable; the jump-to-page form survives
 * behind the ellipsis, where it earns its place on lists too long to enumerate.
 */
export default function URLPagination({ pages, currentPage, onChangePage, onPrefetchPage }: Props) {
	const { t } = useLocaleContext()
	const { innerWidth: screenWidth } = useWindowSize()

	const numbersToShow = useMemo(() => visiblePageCount(screenWidth), [screenWidth])
	const { pageRange } = usePagination({ currentPage, numbersToShow, totalPages: pages })

	const handlePrefetch = useCallback(
		(page: number) => {
			if (page >= 1 && page <= pages) {
				onPrefetchPage?.(page)
			}
		},
		[onPrefetchPage, pages],
	)

	const handleChangePage = useCallback(
		(page: number) => {
			if (page >= 1 && page <= pages && page !== currentPage) {
				onChangePage(page)
			}
		},
		[onChangePage, pages, currentPage],
	)

	// Nothing to paginate through -- render nothing rather than a row of dead controls.
	if (pages <= 1) {
		return null
	}

	return (
		<nav aria-label={t('pagination.label')} className="gap-0.5 flex items-center">
			<ToolTip content={t('pagination.buttons.previousPage')} size="sm" align="end">
				<IconButton
					size="xs"
					variant="ghost"
					disabled={currentPage <= 1}
					onClick={() => handleChangePage(currentPage - 1)}
					onMouseEnter={() => handlePrefetch(currentPage - 1)}
					aria-label={t('pagination.buttons.previousPage')}
					className="h-11 w-11 md:h-7 md:w-7 shrink-0"
				>
					<ChevronLeft className="h-4 w-4" />
				</IconButton>
			</ToolTip>

			{pageRange.map((page, index) => {
				if (typeof page === 'number') {
					const isCurrent = page === currentPage
					return (
						<button
							key={`page-${page}`}
							type="button"
							onClick={() => handleChangePage(page)}
							onMouseEnter={() => handlePrefetch(page)}
							onFocus={() => handlePrefetch(page)}
							aria-current={isCurrent ? 'page' : undefined}
							className={cn(
								// 44px minimum on touch, tightened once there is a pointer and the footer
								// shrinks to 40px.
								'h-11 min-w-11 px-2 text-sm md:h-7 md:min-w-7 md:text-xs inline-flex shrink-0 items-center justify-center rounded-md tabular-nums transition-colors',
								isCurrent
									? 'bg-fill-brand-secondary font-semibold text-foreground'
									: 'text-foreground-muted hover:bg-background-surface-hover hover:text-foreground',
							)}
						>
							{page}
						</button>
					)
				}

				// The ellipsis is the jump-to-page affordance, not decoration: on a 99 page list
				// the numbers alone cannot reach the middle.
				return (
					<PagePopoverForm
						key={`ellipsis-${index}`}
						pos={index}
						currentPage={currentPage}
						totalPages={pages}
						onPageChange={handleChangePage}
						trigger={
							<button
								type="button"
								aria-label={t('pagination.input.label')}
								className="h-11 w-11 md:h-7 md:w-7 text-foreground-muted hover:bg-background-surface-hover inline-flex shrink-0 items-center justify-center rounded-md hover:text-foreground"
							>
								<MoreHorizontal className="h-4 w-4" />
							</button>
						}
					/>
				)
			})}

			<ToolTip content={t('pagination.buttons.nextPage')} size="sm" align="end">
				<IconButton
					size="xs"
					variant="ghost"
					disabled={currentPage >= pages}
					onClick={() => handleChangePage(currentPage + 1)}
					onMouseEnter={() => handlePrefetch(currentPage + 1)}
					aria-label={t('pagination.buttons.nextPage')}
					className="h-11 w-11 md:h-7 md:w-7 shrink-0"
				>
					<ChevronRight className="h-4 w-4" />
				</IconButton>
			</ToolTip>
		</nav>
	)
}
