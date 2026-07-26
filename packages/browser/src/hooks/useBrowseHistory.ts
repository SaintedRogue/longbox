import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

import { useBrowseHistoryStore } from '@/stores/browseHistory'

/**
 * Record where this browse list currently is, so "up" links can return to it.
 *
 * Mount in a browse scene and pass its scene key. Writes on every location change, which is
 * cheap: browse state is replaced rather than pushed (see useFilterScene), so a page change
 * produces one write, not one per history entry.
 */
export function useRememberBrowsePosition(sceneKey: string) {
	const { pathname, search } = useLocation()
	const remember = useBrowseHistoryStore((state) => state.remember)

	useEffect(() => {
		remember(sceneKey, `${pathname}${search}`)
	}, [remember, sceneKey, pathname, search])
}

/**
 * Resolve where an "up" link should point: the remembered position for that list, or
 * `fallback` when there is nothing worth returning to.
 *
 * Subscribed rather than read once, so a link rendered alongside a list (a breadcrumb on the
 * same screen) stays correct as that list is paged.
 */
export function useBrowseReturnPath(sceneKey: string, fallback: string): string {
	return useBrowseHistoryStore((state) => state.lastVisited[sceneKey] ?? fallback)
}
