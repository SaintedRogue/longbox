import { cn } from '@longbox/components'
import { Layers, Library } from 'lucide-react'

export type SeriesView = 'series' | 'collections'

type Props = {
	value: SeriesView
	onChange: (view: SeriesView) => void
}

const OPTIONS: { value: SeriesView; label: string; icon: typeof Layers }[] = [
	{ value: 'series', label: 'Series', icon: Library },
	{ value: 'collections', label: 'Collections', icon: Layers },
]

/**
 * Switches *what* the grid lists, as opposed to how it is sorted or displayed.
 *
 * A radiogroup rather than tabs: these are two views of one browse surface, not two
 * destinations, and the header tabs already own destination-level navigation. Labels are
 * hidden on narrow rows where the icons plus the active state carry the meaning, but they
 * stay in the accessible name.
 */
export default function SeriesViewToggle({ value, onChange }: Props) {
	return (
		<div
			role="radiogroup"
			aria-label="List series or collections"
			className="gap-0.5 p-0.5 flex items-center rounded-lg bg-muted"
		>
			{OPTIONS.map(({ value: option, label, icon: Icon }) => {
				const isActive = value === option
				return (
					<button
						key={option}
						type="button"
						role="radio"
						aria-checked={isActive}
						aria-label={label}
						title={label}
						onClick={() => onChange(option)}
						className={cn(
							'h-8 px-2 gap-1.5 text-xs font-medium flex items-center rounded-md transition-colors',
							isActive
								? 'shadow-sm bg-background text-foreground'
								: 'text-muted-foreground hover:text-foreground',
						)}
					>
						<Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
						<span className="sm:inline hidden">{label}</span>
					</button>
				)
			})}
		</div>
	)
}
