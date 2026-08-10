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
