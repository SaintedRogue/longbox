import { cn, useBoolean } from '@longbox/components'
import { lazy, Suspense } from 'react'

import { DEBUG_ENV } from '../index.ts'

/**
 * The markdown stack (react-markdown -> rehype-raw -> parse5, plus remark -> micromark) is
 * roughly 450KB of source, and this component is its only live entry point. It renders on
 * detail views only -- never on first paint -- so it is split out of the initial chunk.
 */
const Markdown = lazy(() => import('./markdown/MarkdownPreview.tsx'))

/**
 * Renders `children` as markdown, falling back to the same text unformatted while the markdown
 * chunk loads. Descriptions are overwhelmingly plain prose, so the fallback is visually near
 * identical and the upgrade doesn't read as a flash.
 */
function LazyMarkdown({ className, children }: { className?: string; children: string }) {
	return (
		<Suspense
			fallback={
				<div className={cn('whitespace-pre-wrap text-foreground', className)}>{children}</div>
			}
		>
			<Markdown className={className}>{children}</Markdown>
		</Suspense>
	)
}

type Props = {
	text?: string | null
	muted?: boolean
}

const COLLAPSED_HEIGHT = 72
const MAX_EXPANDED_HEIGHT = 300

export default function ReadMore({ text, muted }: Props) {
	const [showingAll, { toggle }] = useBoolean(false)

	const resolvedText = text ? text : DEBUG_ENV ? DEBUG_FAKE_TEXT : ''
	const canReadMore = resolvedText.length > 250

	if (!resolvedText && !DEBUG_ENV) {
		return null
	}

	if (!canReadMore) {
		return <LazyMarkdown className={cn({ 'opacity-80': muted })}>{resolvedText}</LazyMarkdown>
	}

	return (
		<div>
			<div
				className={showingAll ? 'overflow-y-auto' : 'overflow-hidden'}
				style={{
					maxHeight: showingAll ? MAX_EXPANDED_HEIGHT : COLLAPSED_HEIGHT,
					transition: 'max-height 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
				}}
			>
				<LazyMarkdown className={cn({ 'opacity-80': muted })}>{resolvedText}</LazyMarkdown>
			</div>

			<div
				className="-mt-8 h-8 pointer-events-none bg-linear-to-t from-background to-transparent transition-opacity duration-150"
				style={{ opacity: showingAll ? 0 : 1 }}
			/>

			<div className="mt-2 relative flex w-full items-center">
				<div className="flex-1 border-t border-dashed border-border" />
				<button
					onClick={toggle}
					className="px-3 py-0.5 text-xs font-medium cursor-pointer rounded-full border border-dashed border-border bg-background text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
				>
					{showingAll ? 'Read less' : 'Read more'}
				</button>
				<div className="flex-1 border-t border-dashed border-border" />
			</div>
		</div>
	)
}

const DEBUG_FAKE_TEXT =
	'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed varius semper dolor, eget egestas velit porta ut. \
	Integer blandit lectus nisi, a suscipit eros malesuada eu. Praesent vel sodales ipsum, ut porttitor erat. Aliquam faucibus erat a ante \
	consectetur imperdiet. Curabitur in est ac nisi feugiat facilisis a in nisi. Ut auctor rutrum nibh a tincidunt. Proin non hendrerit risus, \
	sagittis malesuada odio. Phasellus condimentum hendrerit libero nec ultrices.\
	Praesent lacinia, magna vel sodales tempus, tellus metus ultricies odio, non porttitor lectus tortor ac ante. \
	Nullam malesuada nec massa eget facilisis. Aenean in nisi lacus. Etiam et tortor vel lacus maximus imperdiet. Fusce \
	scelerisque dapibus fermentum. Nunc non mauris rhoncus neque tincidunt convallis id et nisl. Donec lobortis at lectus quis venenatis. \
	Ut lacus urna, accumsan sed nisl eget, auctor auctor massa. Duis scelerisque aliquam scelerisque. In hac habitasse platea dictumst. Suspendisse \
	consequat nisi nec enim finibus, sit amet gravida sem ultrices. Vestibulum feugiat erat et tincidunt pellentesque. Sed interdum mi ac quam convallis lobortis.'
