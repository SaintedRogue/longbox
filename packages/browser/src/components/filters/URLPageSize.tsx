import { NativeSelect, Text } from '@longbox/components'
import { useLocaleContext } from '@longbox/i18n'
import { useCallback, useMemo } from 'react'

import { useURLPageParams } from './useFilterScene'

/**
 * Page size comes from a fixed set, so it is a select rather than free text. It was a 24-28px
 * `<input type="number">` that only committed on Enter -- the same trap as the old page field,
 * with the added problem that nothing told you which sizes were sensible.
 *
 * 40 is included because it is the default on screens wider than 1600px (see useURLPageParams),
 * and a value the app can pick for you should always be one you can pick back.
 */
const PAGE_SIZES = [20, 40, 60, 100] as const

export default function URLPageSize() {
	const { pageSize, setPageSize } = useURLPageParams()
	const { t } = useLocaleContext()

	// A size set from elsewhere (a shared link, a responsive default) still has to be
	// representable, or the select would silently render as something the user never chose.
	const options = useMemo(() => {
		const sizes = PAGE_SIZES.includes(pageSize as (typeof PAGE_SIZES)[number])
			? [...PAGE_SIZES]
			: [...PAGE_SIZES, pageSize].sort((a, b) => a - b)
		return sizes.map((size) => ({ label: String(size), value: String(size) }))
	}, [pageSize])

	const handleChange = useCallback(
		(event: React.ChangeEvent<HTMLSelectElement>) => {
			const parsed = parseInt(event.target.value, 10)
			if (!isNaN(parsed) && parsed > 0) {
				setPageSize(parsed)
			}
		},
		[setPageSize],
	)

	return (
		// Hidden below `sm`: the footer is one fixed-height row, and on a 375px screen the page
		// controls alone claim 308 of the 343 usable pixels. Page size is a preference you set
		// once; paging is the thing you do constantly, so paging wins the width. The setting
		// stays available from `sm` up, and any size chosen there is honoured on mobile via the
		// URL -- it is the control that is hidden, not the value.
		<div className="gap-x-2 sm:flex hidden shrink-0 items-center">
			<NativeSelect
				size="xs"
				className="pl-2 pr-7 w-auto"
				options={options}
				value={String(pageSize)}
				onChange={handleChange}
				aria-label={t('pagination.pageSize.label')}
			/>
			<Text size="sm" variant="muted" className="inline-flex shrink-0">
				per page
			</Text>
		</div>
	)
}
