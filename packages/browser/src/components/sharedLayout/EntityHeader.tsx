import {
	Button,
	cn,
	DropdownMenu,
	DropdownMenuProps,
	Heading,
	Link,
	MiniStatCard,
	Tabs,
	useSticky,
} from '@longbox/components'
import { useLocaleContext } from '@longbox/i18n'
import { EllipsisVertical, Info, Settings } from 'lucide-react'
import { useLocation } from 'react-router'
import { useMediaMatch } from 'rooks'

import { usePreferences } from '@/hooks'

/**
 * How much width a stat has to earn before it appears.
 *
 * The header carries identity, navigation and settings; stats are the only thing on the row
 * that can be dropped without losing a function. Revealing them in tiers keeps a tablet from
 * cramming five chips between the title and the tabs, and everything stays reachable via the
 * info sheet regardless of width.
 *
 * These are **container** queries, not viewport ones. The sidebar takes ~208px, so a 768px
 * tablet leaves the header barely more room than a 560px phone in landscape — keying off the
 * viewport showed two chips there and squeezed the library name down to "Co…". Measuring the
 * row's own width instead means the tiers stay correct whether the sidebar is open, collapsed,
 * or replaced by the top bar.
 */
export type StatPriority = 1 | 2 | 3 | 4

const PRIORITY_VISIBILITY: Record<StatPriority, string> = {
	1: 'hidden @lg:flex',
	2: 'hidden @2xl:flex',
	3: 'hidden @4xl:flex',
	4: 'hidden @6xl:flex',
}

type Stat = React.ComponentProps<typeof MiniStatCard> & {
	key: string
	priority?: StatPriority
}

type Tab = {
	isActive: boolean
	label: string
	onHover?: () => void
	to: string
}

type Props = {
	name: string
	tabs: Tab[]
	actions?: DropdownMenuProps['groups']
	stats?: Stat[]
	settingsLink?: string
	onInfoClick?: () => void
}

export function EntityHeader({ name, tabs, actions, stats, settingsLink, onInfoClick }: Props) {
	const isMobile = useMediaMatch('(max-width: 768px)')
	const location = useLocation()
	const { t } = useLocaleContext()
	const {
		preferences: { primaryNavigationMode, layoutMaxWidthPx },
	} = usePreferences()

	const preferTopBar = primaryNavigationMode === 'TOPBAR'

	const { ref, isSticky } = useSticky<HTMLDivElement>({
		extraOffset: isMobile || primaryNavigationMode === 'TOPBAR' ? 56 : 0,
	})

	const isSettingsActive = settingsLink ? location.pathname.includes(settingsLink) : false
	const activeTab = isSettingsActive
		? // a lil hacky but basically forcing a non-existing tab to be active so none are
			settingsLink
		: tabs.find((tab) => tab.isActive)?.to

	return (
		<div
			ref={ref}
			className={cn('top-0 h-12 sticky z-50 w-full border-b border-border transition-colors', {
				'bg-background': isSticky,
				'bg-transparent': !isSticky,
			})}
		>
			<div
				className={cn('h-12 px-4 gap-3 @container flex items-center', {
					'mx-auto': preferTopBar && !!layoutMaxWidthPx,
				})}
				style={{ maxWidth: preferTopBar ? layoutMaxWidthPx || undefined : undefined }}
			>
				<div className="gap-3 min-w-0 flex items-center">
					{/* Capped rather than free-shrinking: a genuinely long name truncates, but a
					    short one like "Comics" must never lose characters to make room for a
					    stat chip. The name outranks the chips. */}
					<Heading size="sm" className="max-w-[14rem] shrink-0 truncate">
						{name}
					</Heading>

					{actions && (
						<DropdownMenu
							align="end"
							contentWrapperClassName="w-48"
							trigger={
								<Button
									variant="outline"
									size="icon"
									className="size-7 shrink-0"
									aria-label={t('common.moreOptions')}
								>
									<EllipsisVertical className="h-4 w-4" />
								</Button>
							}
							groups={actions}
						/>
					)}

					{stats && (
						// The chips decide their own visibility from the container width; this
						// wrapper only spaces them.
						<div className="gap-2 flex shrink-0 items-center">
							{stats.map(({ key, priority = 1, ...stat }) => (
								<MiniStatCard key={key} className={PRIORITY_VISIBILITY[priority]} {...stat} />
							))}
						</div>
					)}
				</div>

				<div className="flex-1" />

				{onInfoClick && (
					// 44px tap target through tablet widths -- those are touch devices too --
					// and compact only at lg where a pointer is the likely input.
					<button
						className="h-11 w-11 lg:h-7 lg:w-7 group flex shrink-0 items-center justify-center rounded-lg bg-primary/15"
						onClick={onInfoClick}
						aria-label={t('common.info')}
					>
						<Info className="h-4 w-4 text-primary" />
					</button>
				)}

				<Tabs value={activeTab} size="sm">
					<Tabs.List>
						{tabs.map((tab) => (
							<Tabs.Trigger key={tab.to} value={tab.to} asChild>
								<Link to={tab.to} underline={false} onMouseEnter={tab.onHover}>
									{tab.label}
								</Link>
							</Tabs.Trigger>
						))}
					</Tabs.List>
				</Tabs>

				{settingsLink && (
					<Link
						to={settingsLink}
						underline={false}
						className={cn(
							'h-11 w-11 lg:h-7 lg:w-7 flex shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
							{ 'bg-muted text-foreground': isSettingsActive },
						)}
						aria-label={t('sidebar.buttons.settings')}
					>
						<Settings className="h-4 w-4" />
					</Link>
				)}
			</div>
		</div>
	)
}
