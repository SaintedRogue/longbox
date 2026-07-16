import { deriveDownloadFormat } from '../downloadFormat'

describe('deriveDownloadFormat', () => {
	it.each([
		['epub', 'epub'],
		['EPUB', 'epub'],
		['.epub', 'epub'],
		['pdf', 'pdf'],
		['PDF', 'pdf'],
		['.pdf', 'pdf'],
		['cbz', 'cbz'],
		['CBZ', 'cbz'],
		['.cbz', 'cbz'],
		['zip', 'cbz'],
		['ZIP', 'cbz'],
		['cbr', 'cbr'],
		['CBR', 'cbr'],
		['.cbr', 'cbr'],
		['rar', 'cbr'],
		['RAR', 'cbr'],
	])('maps extension %p to %p', (extension, expected) => {
		expect(deriveDownloadFormat(extension)).toBe(expected)
	})

	it.each([[undefined], [''], ['txt'], ['mobi'], ['azw3']])('returns null for %p', (extension) => {
		expect(deriveDownloadFormat(extension)).toBeNull()
	})
})
