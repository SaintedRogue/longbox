import { resolveInitialPage } from '../resolveInitialPage'

describe('resolveInitialPage', () => {
	it('uses saved progress when there is no explicit start page', () => {
		expect(resolveInitialPage(undefined, 5, 10)).toBe(5)
	})

	it('prefers an explicit start page over saved progress (Read from beginning)', () => {
		expect(resolveInitialPage(1, 5, 10)).toBe(1)
	})

	it('defaults to page 1 when neither is present', () => {
		expect(resolveInitialPage(undefined, null, 10)).toBe(1)
		expect(resolveInitialPage(undefined, undefined, 10)).toBe(1)
	})

	it('clamps a stale progress page above the last page down to the last page', () => {
		expect(resolveInitialPage(undefined, 99, 10)).toBe(10)
	})

	it('clamps values below 1 up to 1', () => {
		expect(resolveInitialPage(undefined, -3, 10)).toBe(1)
	})
})
