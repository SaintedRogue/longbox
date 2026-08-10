import { dayLabel, isToday } from './utils'

describe('dayLabel', () => {
	it('labels ISO days with weekday and short month', () => {
		expect(dayLabel('2026-08-09')).toBe('Sun, Aug 9')
		expect(dayLabel('2026-08-15')).toBe('Sat, Aug 15')
		expect(dayLabel('2026-12-31')).toBe('Thu, Dec 31')
	})

	it('passes malformed input through untouched', () => {
		expect(dayLabel('not-a-date')).toBe('not-a-date')
	})
})

describe('isToday', () => {
	it('compares against the local calendar date', () => {
		const now = new Date(2026, 7, 9, 23, 30) // Aug 9 local, regardless of TZ
		expect(isToday('2026-08-09', now)).toBe(true)
		expect(isToday('2026-08-10', now)).toBe(false)
	})
})
