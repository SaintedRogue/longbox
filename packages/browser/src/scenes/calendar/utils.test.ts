import {
	dayLabel,
	dayNumber,
	isSameMonth,
	isToday,
	monthLabel,
	relativeTime,
	weekdayLabel,
	weekRangeLabel,
} from './utils'

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

describe('isSameMonth', () => {
	/** The month grid pads with adjacent-month days, which must render as padding. */
	it('separates a month from its padding days', () => {
		expect(isSameMonth('2026-08-01', '2026-08-01')).toBe(true)
		expect(isSameMonth('2026-08-31', '2026-08-01')).toBe(true)
		expect(isSameMonth('2026-07-31', '2026-08-01')).toBe(false)
		expect(isSameMonth('2026-09-01', '2026-08-01')).toBe(false)
	})

	/** Same month number, different year, is not the same month. */
	it('does not confuse the same month in another year', () => {
		expect(isSameMonth('2027-08-15', '2026-08-01')).toBe(false)
	})
})

describe('relativeTime', () => {
	const now = new Date('2026-08-15T12:00:00Z')
	const ago = (ms: number) => new Date(now.getTime() - ms).toISOString()

	it('coarsens as the gap grows', () => {
		expect(relativeTime(ago(5_000), now)).toBe('just now')
		expect(relativeTime(ago(90_000), now)).toBe('1m ago')
		expect(relativeTime(ago(3 * 3_600_000), now)).toBe('3h ago')
		expect(relativeTime(ago(2 * 86_400_000), now)).toBe('2d ago')
	})

	/** Past a week, the date itself is easier to reason about than a day count. */
	it('falls back to a date once it is a week old', () => {
		expect(relativeTime(ago(30 * 86_400_000), now)).toMatch(/\d/)
		expect(relativeTime(ago(30 * 86_400_000), now)).not.toContain('ago')
	})

	/** A server clock slightly ahead of the browser must not render "in -3 seconds". */
	it('treats a future timestamp as just now', () => {
		expect(relativeTime(new Date(now.getTime() + 5_000).toISOString(), now)).toBe('just now')
	})

	it('is empty for an unparseable timestamp', () => {
		expect(relativeTime('nope', now)).toBe('')
	})
})

describe('monthLabel', () => {
	/** The upcoming list runs a quarter ahead, so a bare month name can straddle a year. */
	it('names the year only when it is not the current one', () => {
		const thisYear = new Date().getFullYear()
		expect(monthLabel(`${thisYear}-08-09`)).toBe('August')
		expect(monthLabel(`${thisYear + 2}-08-09`)).toBe(`August ${thisYear + 2}`)
	})

	it('is empty for malformed input', () => {
		expect(monthLabel('nope')).toBe('')
	})
})
