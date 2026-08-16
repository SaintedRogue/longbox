import { Badge, cn, Text, ToolTip } from '@longbox/components'
import { useState } from 'react'

type Props = {
	value: unknown
	highlight?: boolean
	compareWith?: unknown
}

/**
 * How many badges a list shows before it collapses.
 *
 * Character lists on a collected edition are not small — League of Comic Geeks returns 183
 * for a single X-Men omnibus. Rendering all of them puts one row several screens tall and
 * pushes every other field out of view, so the row that is supposed to help you compare
 * becomes the reason you cannot. Twelve is about one line at the grid's column width.
 */
const COLLAPSED_BADGES = 12

export function FieldValue({ value, highlight, compareWith }: Props) {
	// Hooks run before any early return: this component renders for every field, and a
	// conditional hook would break on the first row whose value is empty.
	const [expanded, setExpanded] = useState(false)

	if (value == null || value === '') {
		return (
			<Text size="xs" variant="muted">
				—
			</Text>
		)
	}

	if (Array.isArray(value)) {
		if (value.length === 0) {
			return (
				<Text size="xs" variant="muted">
					—
				</Text>
			)
		}

		const currentSet =
			highlight && Array.isArray(compareWith) ? new Set(compareWith.map(String)) : null

		const overflow = value.length - COLLAPSED_BADGES
		// New values sort first when collapsed, so the twelve you can see are the ones the
		// match would actually change. Showing the first twelve alphabetically would hide
		// exactly the information the comparison exists to surface.
		const ordered =
			currentSet && overflow > 0
				? [...value].sort(
						(a, b) => Number(currentSet.has(String(a))) - Number(currentSet.has(String(b))),
					)
				: value
		const shown = expanded ? ordered : ordered.slice(0, COLLAPSED_BADGES)

		return (
			<div className="gap-1 flex flex-wrap items-center">
				{shown.map((item, i) => {
					const isNew = currentSet != null && !currentSet.has(String(item))
					return (
						<Badge key={i} variant={isNew ? 'primary' : 'default'} size="sm">
							{String(item)}
						</Badge>
					)
				})}
				{overflow > 0 && (
					<button
						type="button"
						onClick={() => setExpanded((open) => !open)}
						className="px-1.5 py-0.5 text-xs rounded cursor-pointer border border-dashed border-border text-muted-foreground hover:text-foreground"
					>
						{expanded ? 'Show fewer' : `+${overflow} more`}
					</button>
				)}
			</div>
		)
	}

	const str = String(value)
	const isTruncatable = str.length > 120

	if (isTruncatable) {
		return (
			<ToolTip content={<div className="max-w-[400px]">{str}</div>}>
				<Text
					size="sm"
					className={cn('line-clamp-2 cursor-help', highlight && 'font-semibold text-primary')}
				>
					{str}
				</Text>
			</ToolTip>
		)
	}

	return (
		<Text size="sm" className={cn(highlight && 'font-semibold text-primary')}>
			{str}
		</Text>
	)
}
