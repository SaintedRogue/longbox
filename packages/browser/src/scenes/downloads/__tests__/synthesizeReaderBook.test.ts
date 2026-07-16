import { ReadingDirection, ReadingImageScaleFit, ReadingMode } from '@stump/graphql'

import type { DownloadRecord } from '@/offline/db'

import { synthesizeReaderBook } from '../synthesizeReaderBook'

function makeRecord(overrides: Partial<DownloadRecord> = {}): DownloadRecord {
	return {
		bookId: 'book-1',
		title: 'Saga Vol. 1',
		format: 'cbz',
		pageCount: 24,
		pageUrls: Array.from({ length: 24 }, (_, i) => `/page/${i}`),
		sizeBytes: 12_345,
		downloadedAt: 1_700_000_000_000,
		...overrides,
	}
}

describe('synthesizeReaderBook', () => {
	it('maps the DownloadRecord id/title/format onto the reader book ref', () => {
		const record = makeRecord({ bookId: 'book-1', title: 'Saga Vol. 1', format: 'cbz' })

		const book = synthesizeReaderBook(record)

		expect(book.id).toBe('book-1')
		expect(book.resolvedName).toBe('Saga Vol. 1')
		expect(book.extension).toBe('cbz')
	})

	it('uses pageCount for pages when present', () => {
		const record = makeRecord({ pageCount: 24, pageUrls: Array(5).fill('/page') })

		const book = synthesizeReaderBook(record)

		expect(book.pages).toBe(24)
	})

	it('falls back to pageUrls.length when pageCount is missing', () => {
		const record = makeRecord({ pageCount: undefined, pageUrls: ['/page/0', '/page/1', '/page/2'] })

		const book = synthesizeReaderBook(record)

		expect(book.pages).toBe(3)
	})

	it('falls back to 0 pages when neither pageCount nor pageUrls is present', () => {
		const record = makeRecord({ pageCount: undefined, pageUrls: undefined })

		const book = synthesizeReaderBook(record)

		expect(book.pages).toBe(0)
	})

	it('sets readProgress to null (no offline progress source)', () => {
		const book = synthesizeReaderBook(makeRecord())

		expect(book.readProgress).toBeNull()
	})

	it('defaults libraryConfig to the reader defaults (Paged / LTR / Height)', () => {
		const book = synthesizeReaderBook(makeRecord())

		expect(book.libraryConfig).toEqual({
			defaultReadingImageScaleFit: ReadingImageScaleFit.Height,
			defaultReadingMode: ReadingMode.Paged,
			defaultReadingDir: ReadingDirection.Ltr,
		})
	})

	it('sets analysisData to null (no cached page dimensions offline)', () => {
		const book = synthesizeReaderBook(makeRecord())

		expect(book.analysisData).toBeNull()
	})

	it('sets nextInSeries to an empty nodes list (no offline series knowledge)', () => {
		const book = synthesizeReaderBook(makeRecord())

		expect(book.nextInSeries).toEqual({ nodes: [] })
	})
})
