import paths from '../paths'

describe('paths.downloads', () => {
	it('returns the static /downloads path', () => {
		expect(paths.downloads()).toBe('/downloads')
	})
})

describe('paths.offlineReader', () => {
	it('returns the /downloads/:id/read path for the given book id', () => {
		expect(paths.offlineReader('book-1')).toBe('/downloads/book-1/read')
	})
})

describe('paths.bookReader', () => {
	it('builds the image reader route with no page param', () => {
		expect(paths.bookReader('1')).toBe('/books/1/reader?')
	})

	it('keeps the incognito flag on the image reader route', () => {
		expect(paths.bookReader('1', { isIncognito: true })).toBe('/books/1/reader?incognito=true')
	})

	it('routes epub books to the epub reader', () => {
		expect(paths.bookReader('1', { isEpub: true })).toBe('/books/1/epub-reader?stream=false')
	})
})
