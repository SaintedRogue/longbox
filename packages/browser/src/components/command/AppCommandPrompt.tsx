import { CommandPrompt } from '@longbox/components'
import { UserPermission } from '@longbox/graphql'
import {
	Book,
	CalendarDays,
	Download,
	Home,
	Library,
	ListFilter,
	Search,
	Settings,
	Sparkles,
	Users,
} from 'lucide-react'
import { useMemo } from 'react'

import { useAppContext } from '@/context'
import { usePaths } from '@/paths'

/**
 * The app-wide Cmd+K launcher: a jump-to for the top-level destinations.
 *
 * Deliberately *not* a live remote search box. `Command.Input` is uncontrolled
 * and filters its static items client-side, so making it search the server would
 * mean threading a controlled value through the primitives, disabling cmdk's own
 * filtering, debouncing, and rebuilding per-group loading and keyboard nav --
 * i.e. rebuilding /search inside a dialog. This links there instead.
 *
 * Mounted once in AppLayout: the component owns its own Cmd+K listener, so a
 * per-scene instance would register duplicates.
 */
export default function AppCommandPrompt() {
	const paths = usePaths()
	const { checkPermission } = useAppContext()

	const groups = useMemo(() => {
		const navigate = [
			{ href: paths.home(), icon: Home, label: 'Home' },
			{ href: paths.bookSearch(), icon: Book, label: 'Books' },
			{ href: paths.series(), icon: Sparkles, label: 'Series' },
			{ href: paths.libraries(), icon: Library, label: 'Libraries' },
			{ href: paths.characters(), icon: Users, label: 'Characters' },
			{ href: paths.calendar(), icon: CalendarDays, label: 'Release calendar' },
			{ href: paths.downloads(), icon: Download, label: 'Downloads' },
		]

		// Gated exactly as the sidebar gates the same destinations, so the palette
		// never offers a route the user would be bounced out of.
		if (checkPermission(UserPermission.AccessSmartList)) {
			navigate.push({ href: paths.smartLists(), icon: ListFilter, label: 'Smart lists' })
		}

		navigate.push({ href: paths.settings(), icon: Settings, label: 'Settings' })

		return [
			{
				heading: 'Search',
				items: [
					{
						href: paths.search(),
						icon: Search,
						label: 'Search everything…',
					},
				],
			},
			{ heading: 'Go to', items: navigate },
		]
	}, [paths, checkPermission])

	return (
		<CommandPrompt
			groups={groups}
			filterPrompt="Where do you want to go?"
			filterEmptyPrompt="Nothing matches that."
		/>
	)
}
