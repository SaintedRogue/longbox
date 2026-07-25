import { lazy, Suspense, useEffect, useState } from 'react'

import { IconButton } from '../button'
import { Dropdown } from '../dropdown'
import { Popover } from '../popover'
import { cn } from '../utils'

// TODO: this should probably be moved to the browser package so I can
// use react-query for better caching AND language support

/**
 * emoji-mart is ~160KB and only ever renders inside the popover below, so it is split out of
 * the chunk that loads it. This component is rendered once per library in the always-mounted
 * sidebar, so an eager import put the whole picker in the initial bundle for every visitor.
 */
const Picker = lazy(() => import('@emoji-mart/react'))

/**
 * Shared across every picker instance: the sidebar renders one per library, and the emoji set
 * is identical for all of them, so a per-instance fetch meant N identical requests.
 *
 * TODO: this reaches an external CDN, which is wrong for a self-hosted server -- it leaks the
 * deployment's existence to a third party and cannot work air-gapped. It should be a bundled
 * `@emoji-mart/data` dependency instead. Deferring the fetch to first open (rather than mount)
 * at least means it never fires unless someone actually opens the picker.
 */
let emojiDataPromise: Promise<unknown> | null = null

function loadEmojiData(): Promise<unknown> {
	emojiDataPromise ??= fetch('https://cdn.jsdelivr.net/npm/@emoji-mart/data').then((response) =>
		response.json(),
	)
	return emojiDataPromise
}

type Emoji = {
	id: string
	name: string
	native: string
	unified: string
}
type Props = {
	value?: string
	disabled?: boolean
	placeholder?: string | React.ReactNode
	triggerProps?: React.ComponentProps<typeof IconButton>
	onEmojiSelect: (emoji?: Emoji) => void
	onLoadError?: (error: Error) => void
} & Pick<React.ComponentProps<typeof Popover.Content>, 'align'>
export default function EmojiPicker({
	value,
	disabled,
	placeholder,
	onEmojiSelect,
	onLoadError,
	triggerProps,
	...contentProps
}: Props) {
	const [isOpen, setIsOpen] = useState(false)
	const [data, setData] = useState<unknown>()

	// Only loaded once the picker is actually opened. This used to run on mount, which meant
	// every page load hit an external CDN once per library in the sidebar -- the app's only
	// outbound third-party request -- whether or not anyone touched the emoji picker.
	useEffect(() => {
		if (!isOpen || data) {
			return
		}

		let cancelled = false
		loadEmojiData()
			.then((loaded) => {
				if (!cancelled) {
					setData(loaded)
				}
			})
			.catch((error) => {
				// Drop the shared promise so a later open retries rather than caching the failure.
				emojiDataPromise = null
				if (cancelled) {
					return
				}
				onLoadError?.(error instanceof Error ? error : new Error('Failed to load emojis'))
			})

		return () => {
			cancelled = true
		}
	}, [isOpen, data, onLoadError])

	const handleEmojiSelect = (emoji: Emoji) => {
		onEmojiSelect(emoji)
		setIsOpen(false)
	}

	const renderTrigger = () => {
		const content = value ?? placeholder ?? '😀'

		const { className, ...rest } = triggerProps ?? {}
		return (
			<IconButton
				type="button"
				className={cn('h-6 w-6 text-sm', className)}
				variant="ghost"
				{...rest}
				disabled={disabled}
			>
				{content}
			</IconButton>
		)
	}

	return (
		<div>
			{!isOpen && (
				<Dropdown>
					<Dropdown.Trigger asChild disabled={disabled}>
						{renderTrigger()}
					</Dropdown.Trigger>
					<Dropdown.Content align="start">
						<Dropdown.Label className="text-xs">Emoji options</Dropdown.Label>
						<Dropdown.Item disabled={disabled} onClick={() => setIsOpen(true)}>
							Change
						</Dropdown.Item>
						<Dropdown.Item disabled={disabled || !value} onClick={() => onEmojiSelect(undefined)}>
							Remove
						</Dropdown.Item>
					</Dropdown.Content>
				</Dropdown>
			)}

			{isOpen && (
				<Popover open={isOpen} onOpenChange={setIsOpen}>
					<Popover.Trigger asChild disabled={disabled}>
						{renderTrigger()}
					</Popover.Trigger>
					<Popover.Content
						className="p-0 border-none! bg-transparent! shadow-none!"
						{...contentProps}
					>
						<Suspense fallback={null}>
							<Picker data={data} onEmojiSelect={handleEmojiSelect} />
						</Suspense>
					</Popover.Content>
				</Popover>
			)}
		</div>
	)
}
