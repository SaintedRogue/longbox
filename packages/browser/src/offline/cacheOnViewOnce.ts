import type { Api } from '@longbox/sdk'

import { cacheOnView } from './passiveCache'

/**
 * URLs whose passive-cache "shadow fetch" has already been kicked off in this session.
 *
 * Plain module-level singleton, deliberately: the point is to survive component unmount/remount
 * (the readers remount their page `<img>`s constantly -- scale changes, page-set recalculation,
 * next-set/current-set transitions), which a `useRef` or React-Query entry would not.
 */
const shadowFetchedUrls = new Set<string>()

/**
 * `cacheOnView`, but at most once per URL per session.
 *
 * `cacheOnView` re-GETs a URL that an `<img>` has *just* finished loading, purely to get the bytes
 * in hand for the passive cache. Repeating that on every subsequent load of the same URL is pure
 * waste: the very first call already either wrote the blob or found it present, so every repeat is
 * a redundant request whose only remaining effect is an LRU touch that is, by definition, already
 * recent. A live reader trace measured 16 requests for 6 unique pages, largely from this.
 *
 * The URL is un-claimed if the shadow fetch rejects, so a transient failure can be retried later in
 * the session. (`cacheOnView` swallows its own errors, so in practice this is belt-and-braces.)
 */
export function cacheOnViewOnce(url: string, sdk: Api): Promise<void> {
	if (shadowFetchedUrls.has(url)) return Promise.resolve()

	shadowFetchedUrls.add(url)
	return cacheOnView(url, sdk).catch(() => {
		shadowFetchedUrls.delete(url)
	})
}

/** Test-only: drops all session claims so cases don't leak "already shadow-fetched" state. */
export function _resetCacheOnViewOnceForTests(): void {
	shadowFetchedUrls.clear()
}
