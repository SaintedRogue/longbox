import { cn } from '@stump/components'

type Props = {
	/**
	 * Drop the handle-slot detail. Recommended below ~24px, where the slot
	 * muddies rather than reads (per the brand icon guidance).
	 */
	simplified?: boolean
	className?: string
}

/**
 * The Longbox line-mark: a comic longbox drawn as an open wireframe.
 *
 * Rendered as `stroke="currentColor"` so it adopts the surrounding text color
 * (`text-foreground`, `text-muted`, etc.) and adapts to every theme with no
 * per-theme asset. Size it with `h-*`/`w-*` on `className`.
 */
export default function LongboxMark({ simplified, className }: Props) {
	return (
		<svg
			viewBox="0 0 200 200"
			fill="none"
			stroke="currentColor"
			strokeWidth={4.5}
			strokeLinejoin="round"
			strokeLinecap="round"
			role="img"
			aria-label="Longbox"
			className={cn('h-6 w-6', className)}
		>
			<path d="M60 92 L25 70 L25 126 L60 148 Z" />
			<path d="M60 92 L175 92 L175 148 L60 148 Z" />
			<path d="M56 94 L21 72 L21 60 L56 82 Z" />
			<path d="M56 94 L179 94 L179 82 L56 82 Z" />
			<path d="M56 82 L179 82 L144 60 L21 60 Z" />
			{!simplified && (
				<path d="M35 96 L50 105 M35 96 Q32 96 32 99 L32 101 Q32 104 35 106 L48 114 Q51 114 51 111 L51 109 Q51 106 48 104 Z" />
			)}
		</svg>
	)
}
