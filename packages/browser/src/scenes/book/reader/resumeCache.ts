import { BookReaderSceneQuery } from '@longbox/graphql'

type CachedReaderQuery = BookReaderSceneQuery | undefined

type ResumePoint = {
	/** The 1-indexed page the reader was left on */
	page: number
	/** Total pages in the book, used to keep the cached completion percentage coherent */
	pages: number
	/** Total elapsed seconds for the session, as last reported to the server */
	elapsedSeconds: number
}

/**
 * Rewrite a cached `BookReaderScene` payload so it reports `page` as the saved reading position.
 *
 * The reader seeds its starting page from this query *once*, at mount, out of whatever react-query
 * already has. Progress is written by a mutation that returns nothing the cache can be updated
 * from, so the entry kept describing where the book was opened rather than where it was left:
 * close a book on page 40 and re-open it inside the 30 minute `gcTime` and the cached entry -- a
 * synchronous hit, since a suspense query renders stale data and refetches behind it rather than
 * re-suspending -- put you back on page 1. Waiting long enough for the entry to be evicted made it
 * work again, which is exactly what "it doesn't reliably remember my page" looks like from
 * outside.
 *
 * Patching from the reader's own last reported page (rather than from a mutation response) also
 * keeps this correct when the write only made it as far as the offline outbox.
 */
export function withResumePoint(
	cached: CachedReaderQuery,
	{ page, pages, elapsedSeconds }: ResumePoint,
): CachedReaderQuery {
	const media = cached?.mediaById
	if (!media) return cached

	return {
		...cached,
		mediaById: {
			...media,
			readProgress: {
				...media.readProgress,
				page,
				elapsedSeconds,
				// Mirrors the server's own `compute_page_based_percentage`, so the value a
				// background refetch replaces this with is the value already here.
				percentageCompleted: pages > 0 ? Math.min(page / pages, 1) : 0,
			},
		},
	}
}
