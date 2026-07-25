import { canApplyPendingUpdate, isReaderPath } from '../pwaUpdate'

describe('isReaderPath', () => {
	it.each([
		'/books/1/reader',
		'/books/1/epub-reader',
		'/books/1/pdf-reader',
		'/books/1/reader/',
		'/downloads/book-1/read',
	])('treats %s as a reader route', (pathname) => {
		expect(isReaderPath(pathname)).toBe(true)
	})

	it('still matches when the app is served from a base path', () => {
		expect(isReaderPath('/longbox/books/1/reader')).toBe(true)
	})

	it.each([
		'/books/1',
		'/books/1/manage',
		'/books',
		'/libraries/1',
		'/downloads',
		'/series/1',
		'/',
	])('does not treat %s as a reader route', (pathname) => {
		expect(isReaderPath(pathname)).toBe(false)
	})
})

describe('canApplyPendingUpdate', () => {
	it('applies once the user navigates somewhere else', () => {
		expect(
			canApplyPendingUpdate({
				armedOn: '/libraries/1',
				current: '/books/1',
				hasOpenDialog: false,
			}),
		).toBe(true)
	})

	it('never applies while the user is still on the same route', () => {
		expect(
			canApplyPendingUpdate({
				armedOn: '/libraries/1',
				current: '/libraries/1',
				hasOpenDialog: false,
			}),
		).toBe(false)
	})

	it('never applies while a dialog is open, since a form may be in progress', () => {
		expect(
			canApplyPendingUpdate({
				armedOn: '/libraries/1',
				current: '/books/1',
				hasOpenDialog: true,
			}),
		).toBe(false)
	})

	it('never reloads into a reader', () => {
		expect(
			canApplyPendingUpdate({
				armedOn: '/books/1',
				current: '/books/1/reader',
				hasOpenDialog: false,
			}),
		).toBe(false)
	})

	it('waits one more navigation when leaving a reader, so progress saves can land', () => {
		expect(
			canApplyPendingUpdate({
				armedOn: '/books/1/reader',
				current: '/books/1',
				hasOpenDialog: false,
			}),
		).toBe(false)

		// ...and applies on the navigation after that
		expect(
			canApplyPendingUpdate({
				armedOn: '/books/1',
				current: '/libraries/1',
				hasOpenDialog: false,
			}),
		).toBe(true)
	})
})
