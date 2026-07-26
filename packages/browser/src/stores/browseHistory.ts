import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

/**
 * Where each browse list was last left, so that navigating *up* returns you to it.
 *
 * The path builders (`paths.librarySeries`, `paths.seriesOverview`) have always accepted an
 * optional page, and no caller ever passed one -- so breadcrumbs, the series-to-library link
 * and the book-to-series link all resolved to page 1. Threading a page through every one of
 * those call sites would mean each link knowing where its reader came from; recording the
 * position once, per list, and letting the up-links ask is the smaller contract.
 *
 * Whole relative URLs are stored rather than querystrings, because a library has two
 * independent lists behind one breadcrumb. `/libraries/x/books?page=5` answers "which tab" and
 * "which page" together; `?page=5` alone would send someone browsing books to the series tab.
 *
 * Session-scoped on purpose, matching `useScrollRestoration`, which also does not survive a
 * reload: a fresh tab, or a link opened cold, should land at the top of the list rather than
 * wherever some earlier visit happened to stop.
 */
export type BrowseHistoryStore = {
	/** scene key -> the relative URL that list was last showing */
	lastVisited: Record<string, string>
	remember: (sceneKey: string, relativeUrl: string) => void
	/** The remembered location for this list, or `fallback` if there isn't a meaningful one. */
	resolve: (sceneKey: string, fallback: string) => string
}

/** A list showing nothing but its own path is at its defaults, so there is no position to keep. */
const hasPosition = (relativeUrl: string) => relativeUrl.includes('?')

export const useBrowseHistoryStore = create<BrowseHistoryStore>()(
	persist(
		(set, get) => ({
			lastVisited: {},
			remember: (sceneKey, relativeUrl) =>
				set((state) => {
					const next = { ...state.lastVisited }
					if (hasPosition(relativeUrl)) {
						next[sceneKey] = relativeUrl
					} else {
						// Back at defaults: drop the entry so the up-link falls through to its own
						// path rather than pinning a stale page.
						delete next[sceneKey]
					}
					return { lastVisited: next }
				}),
			resolve: (sceneKey, fallback) => get().lastVisited[sceneKey] ?? fallback,
		}),
		{
			name: 'longbox-browse-history',
			storage: createJSONStorage(() => sessionStorage),
			// The actions are functions; only the data is worth persisting.
			partialize: (state) => ({ lastVisited: state.lastVisited }) as BrowseHistoryStore,
		},
	),
)

/**
 * Keyed per entity rather than per list. A library's two tabs share one key so that its
 * breadcrumb can return you to whichever you were actually using.
 *
 * Deliberately *not* consulted by top-level navigation. The rule is "up restores, go to
 * resets": breadcrumbs and entity links continue a journey you are already on, so they return
 * you to where you were; picking a library from the sidebar or top bar starts a new one, and
 * landing on page 5 of a list you have not looked at in an hour would be surprising rather
 * than helpful. `LibrarySideBarSection`, `LibraryNavigationItem` and `LastVisitedLibrary`
 * therefore keep resolving to the start of the library.
 */
export const browseSceneKey = {
	library: (id: string) => `library:${id}`,
	series: (id: string) => `series:${id}`,
} as const
