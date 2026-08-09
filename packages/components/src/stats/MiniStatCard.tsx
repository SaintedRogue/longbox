import { LucideIcon } from 'lucide-react'

import { cn } from '../utils'

export type MiniStatCardProps = {
	icon?: LucideIcon
	value: string | number
	suffix?: string
	/**
	 * What the number means, e.g. "Series". Without it the chip reads to a screen reader as a
	 * bare number next to a decorative icon, which is meaningless out of context. Also used as
	 * the tooltip, since the icon alone does not say what is being counted.
	 */
	label?: string
	className?: string
}

// TODO: yoinked from expo but ignored colors for now, put somewhere else!

export function MiniStatCard({ icon: Icon, value, suffix, label, className }: MiniStatCardProps) {
	return (
		<div
			className={cn('gap-1.5 px-1.5 py-1 flex items-center rounded-lg bg-muted', className)}
			title={label}
		>
			{Icon && (
				<div className="h-5 w-5 flex shrink-0 items-center justify-center rounded-md bg-muted-foreground/15">
					<Icon className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
				</div>
			)}
			{label && <span className="sr-only">{label}:</span>}
			<span className="text-xs font-semibold text-foreground tabular-nums">{value}</span>
			{suffix && <span className="text-xs font-medium text-foreground opacity-50">{suffix}</span>}
		</div>
	)
}
