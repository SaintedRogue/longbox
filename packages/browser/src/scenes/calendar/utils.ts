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
