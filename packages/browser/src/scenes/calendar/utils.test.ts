import { dayLabel, dayNumber, isToday, weekdayLabel, weekRangeLabel } from './utils'

/** A Sunday-aligned week, the shape `releaseCalendar` always returns. */
const week = (start: string) => {
	const [y, m, d] = start.split('-').map(Number)
	return Array.from({ length: 7 }, (_, i) => {
		const date = new Date(Date.UTC(y!, m! - 1, d! + i))
		return date.toISOString().slice(0, 10)
	})
}

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

describe('weekdayLabel / dayNumber', () => {
	it('splits a day into its two rendered parts', () => {
		expect(weekdayLabel('2026-08-09')).toBe('Sun')
		expect(dayNumber('2026-08-09')).toBe('9')
		expect(dayNumber('2026-08-31')).toBe('31')
	})

	it('returns empty strings for malformed input rather than throwing', () => {
		expect(weekdayLabel('nope')).toBe('')
		expect(dayNumber('nope')).toBe('')
	})
})

describe('weekRangeLabel', () => {
	/** Repeating an unchanged month reads as noise, and it is unchanged six weeks in seven. */
	it('names the month once when the week sits inside one', () => {
		expect(weekRangeLabel(week('2026-08-09'))).toBe('Aug 9 – 15')
	})

	it('names both months when the week straddles them', () => {
		expect(weekRangeLabel(week('2026-08-30'))).toBe('Aug 30 – Sep 5')
	})

	it('appends the year only when it is not the current one', () => {
		const thisYear = new Date().getFullYear()
		expect(weekRangeLabel(week(`${thisYear}-03-01`))).not.toMatch(/\d{4}/)
		expect(weekRangeLabel(week(`${thisYear + 2}-03-01`))).toContain(String(thisYear + 2))
	})

	it('is empty for an empty week rather than rendering a stray dash', () => {
		expect(weekRangeLabel([])).toBe('')
	})
})
