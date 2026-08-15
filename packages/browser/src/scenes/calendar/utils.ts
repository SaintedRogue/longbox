/** Pure helpers for the release-calendar scene, split out for direct testing. */

export const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

/**
 * Human label for an ISO `YYYY-MM-DD` day: "Sun, Aug 9". Parsed manually so the
 * label reflects the calendar date itself, never the viewer's timezone shift.
 */
export function dayLabel(isoDate: string): string {
	const [year, month, day] = isoDate.split('-').map(Number)
	if (!year || !month || !day) {
		return isoDate
	}
	const date = new Date(Date.UTC(year, month - 1, day))
	const weekday = DAY_LABELS[date.getUTCDay()]
	const monthName = date.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })
	return `${weekday}, ${monthName} ${day}`
}

/** True when the ISO day is today's calendar date in the viewer's locale. */
export function isToday(isoDate: string, now: Date = new Date()): boolean {
	const local = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
		now.getDate(),
	).padStart(2, '0')}`
	return isoDate === local
}

/** Parse an ISO `YYYY-MM-DD` as a UTC date, or null if it isn't one. */
function parseIsoDay(isoDate: string): Date | null {
	const [year, month, day] = isoDate.split('-').map(Number)
	if (!year || !month || !day) return null
	return new Date(Date.UTC(year, month - 1, day))
}

/** Just the weekday, e.g. "Sun". */
export function weekdayLabel(isoDate: string): string {
	const date = parseIsoDay(isoDate)
	return date ? (DAY_LABELS[date.getUTCDay()] ?? '') : ''
}

/** Just the day of the month, e.g. 9 — rendered large in the day header. */
export function dayNumber(isoDate: string): string {
	return String(parseIsoDay(isoDate)?.getUTCDate() ?? '')
}

/**
 * How long ago an RFC 3339 timestamp was, in the coarsest useful unit.
 *
 * Staleness is the question being asked of the sync time ("is what I'm looking at
 * current?"), and a relative answer answers it directly where an absolute one makes the
 * reader do the arithmetic. Falls back to a local date once it's old enough that "43 days
 * ago" stops being easier to reason about than the date itself.
 */
export function relativeTime(iso: string, now: Date = new Date()): string {
	const then = new Date(iso)
	if (Number.isNaN(then.getTime())) return ''

	const seconds = Math.floor((now.getTime() - then.getTime()) / 1000)
	if (seconds < 0) return 'just now' // clock skew; "in -3 seconds" helps nobody
	if (seconds < 60) return 'just now'

	const minutes = Math.floor(seconds / 60)
	if (minutes < 60) return `${minutes}m ago`

	const hours = Math.floor(minutes / 60)
	if (hours < 24) return `${hours}h ago`

	const days = Math.floor(hours / 24)
	if (days < 7) return `${days}d ago`

	return then.toLocaleDateString()
}

/**
 * "August" — or "August 2027" when it isn't the current year.
 *
 * The upcoming list can run a quarter ahead, so a bare month name would be ambiguous
 * across a year boundary; including the year only when it differs keeps the common case
 * from carrying a redundant number.
 */
export function monthLabel(isoDate: string): string {
	const date = parseIsoDay(isoDate)
	if (!date) return ''

	const month = date.toLocaleString('en-US', { month: 'long', timeZone: 'UTC' })
	return date.getUTCFullYear() === new Date().getFullYear()
		? month
		: `${month} ${date.getUTCFullYear()}`
}

/**
 * A compact label for the whole week: "Aug 9 – 15", or "Aug 30 – Sep 5" when the week
 * straddles two months. Repeating the month on both sides reads as noise when it hasn't
 * changed, which is the case six weeks out of seven.
 */
export function weekRangeLabel(isoDates: string[]): string {
	const first = isoDates.at(0)
	const last = isoDates.at(-1)
	if (!first || !last) return ''

	const start = parseIsoDay(first)
	const end = parseIsoDay(last)
	if (!start || !end) return ''

	const month = (date: Date) => date.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })
	const sameMonth = start.getUTCMonth() === end.getUTCMonth()

	const left = `${month(start)} ${start.getUTCDate()}`
	const right = sameMonth ? String(end.getUTCDate()) : `${month(end)} ${end.getUTCDate()}`

	// Include the year only when it isn't the current one, so the common case stays short.
	const yearSuffix =
		end.getUTCFullYear() === new Date().getFullYear() ? '' : `, ${end.getUTCFullYear()}`

	return `${left} – ${right}${yearSuffix}`
}
