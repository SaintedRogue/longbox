import { browseSceneKey, useBrowseHistoryStore } from '../browseHistory'

/**
 * Every "up" link in the app used to drop you at page 1, because `paths.librarySeries(id)`
 * and friends take an optional page that no caller ever passed. Rather than thread a page
 * through every link, each browse scene records where it was left and the up-links ask.
 *
 * Whole relative URLs are stored, not just the querystring: a breadcrumb points at *the
 * library*, and a library has two independent lists behind it. Remembering `/libraries/x/books
 * ?page=5` answers both "which tab" and "which page" in one value; remembering `?page=5` alone
 * would send someone browsing books back to the series tab.
 */

describe('browseSceneKey', () => {
	it('distinguishes two libraries', () => {
		expect(browseSceneKey.library('lib-1')).not.toBe(browseSceneKey.library('lib-2'))
	})

	it('distinguishes a series from a library of the same id', () => {
		expect(browseSceneKey.series('x')).not.toBe(browseSceneKey.library('x'))
	})
})

describe('useBrowseHistoryStore', () => {
	beforeEach(() => useBrowseHistoryStore.setState({ lastVisited: {} }))

	const { remember } = useBrowseHistoryStore.getState()
	const resolve = (key: string, fallback: string) =>
		useBrowseHistoryStore.getState().resolve(key, fallback)

	it('returns the fallback for a list that has never been visited', () => {
		expect(resolve(browseSceneKey.library('lib-1'), '/libraries/lib-1')).toBe('/libraries/lib-1')
	})

	it('returns where a list was left, in place of the fallback', () => {
		remember(browseSceneKey.library('lib-1'), '/libraries/lib-1/books?page=5')

		expect(resolve(browseSceneKey.library('lib-1'), '/libraries/lib-1')).toBe(
			'/libraries/lib-1/books?page=5',
		)
	})

	it('remembers which tab of a library was in use, not just the page', () => {
		remember(browseSceneKey.library('lib-1'), '/libraries/lib-1/series?page=3')
		remember(browseSceneKey.library('lib-1'), '/libraries/lib-1/books?page=1')

		expect(resolve(browseSceneKey.library('lib-1'), '/libraries/lib-1')).toBe(
			'/libraries/lib-1/books?page=1',
		)
	})

	it('keeps positions for different lists independent', () => {
		remember(browseSceneKey.library('lib-1'), '/libraries/lib-1/books?page=5')
		remember(browseSceneKey.series('ser-1'), '/series/ser-1/books?page=2')

		expect(resolve(browseSceneKey.library('lib-1'), '/x')).toBe('/libraries/lib-1/books?page=5')
		expect(resolve(browseSceneKey.series('ser-1'), '/x')).toBe('/series/ser-1/books?page=2')
	})

	it('falls back once a list is back at its defaults, rather than pinning a bare path', () => {
		remember(browseSceneKey.library('lib-1'), '/libraries/lib-1/books?page=5')
		remember(browseSceneKey.library('lib-1'), '/libraries/lib-1/books')

		expect(resolve(browseSceneKey.library('lib-1'), '/libraries/lib-1')).toBe('/libraries/lib-1')
	})
})
