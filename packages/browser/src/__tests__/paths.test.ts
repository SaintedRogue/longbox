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
