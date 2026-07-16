import { ReadingDirection, ReadingImageScaleFit, ReadingMode } from '@stump/graphql'

import { ImageReaderBookRef } from '@/components/readers/imageBased/context'
import type { DownloadRecord } from '@/offline/db'

/**
 * Maps a durable `DownloadRecord` (the offline catalog entry written by the download manager) to
 * the `ImageReaderBookRef` shape `ImageBasedReader` and `useBookPreferences({ book })` require --
 * i.e. `NonNullable<BookReaderSceneQuery['mediaById']>` (see
 * packages/browser/src/components/readers/imageBased/context.ts). This is the offline seam: normally
 * that object comes from the `mediaById` GraphQL query (BookReaderScene.tsx), which fails when the
 * server is unreachable. A `DownloadRecord` only carries a subset of that shape, so fields the reader
 * dereferences but a `DownloadRecord` can't supply are given safe defaults:
 *
 * - `readProgress`: `null` -- explicitly nullable on the real query, so "no progress" is a
 *   legitimate value, not a fabrication. `ImageBasedReader`/`useBookTimer` read
 *   `media?.readProgress?.elapsedSeconds` and tolerate this.
 * - `libraryConfig`: required (non-nullable) on the real type, but a `DownloadRecord` has no library
 *   association carried offline. Defaulted to the same values `DEFAULT_BOOK_PREFERENCES`
 *   (packages/client/src/stores/reader.ts) uses, so `useBookPreferences`'s
 *   `defaultsFromLibraryConfig` produces the app's normal out-of-the-box reading experience rather
 *   than an arbitrary guess.
 * - `analysisData`: `null` -- optional/nullable on the real type; `useImageSizes` treats a missing
 *   `dimensions` array as "measure pages as they load", which is the correct offline fallback (no
 *   pre-computed page dimensions are cached in a `DownloadRecord`).
 * - `nextInSeries`: `{ nodes: [] }` -- required (non-nullable) on the real type, but "what's next in
 *   the series" is server-side series knowledge with no offline equivalent. `NextInSeries.tsx`
 *   treats an empty `nodes` array as "nothing to show" and renders null.
 */
export function synthesizeReaderBook(record: DownloadRecord): ImageReaderBookRef {
	return {
		id: record.bookId,
		resolvedName: record.title,
		pages: record.pageCount ?? record.pageUrls?.length ?? 0,
		extension: record.format,
		readProgress: null,
		libraryConfig: {
			defaultReadingImageScaleFit: ReadingImageScaleFit.Height,
			defaultReadingMode: ReadingMode.Paged,
			defaultReadingDir: ReadingDirection.Ltr,
		},
		analysisData: null,
		nextInSeries: {
			nodes: [],
		},
	}
}
