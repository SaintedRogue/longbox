import paths from '../paths'

describe('paths.downloads', () => {
	it('returns the static /downloads path', () => {
		expect(paths.downloads()).toBe('/downloads')
	})
})
