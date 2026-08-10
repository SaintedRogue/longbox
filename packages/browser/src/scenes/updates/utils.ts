/** Pure helpers for the updates feed, split out for direct testing. */

export type FeedItem = {
	mediaId: string
	seriesName: string
	mediaName: string
	createdAt: string
	isRead: boolean
}

export type DayGroup = {
	/** Local-timezone `YYYY-MM-DD` bucket key. */
	dayKey: string
	items: FeedItem[]
}

/** Local-timezone day key for an RFC 3339 timestamp — feeds group by the day the
 * viewer experienced, not UTC. */
export function dayKeyOf(rfc3339: string): string {
	const date = new Date(rfc3339)
	if (Number.isNaN(date.getTime())) {
		return rfc3339
	}
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
		date.getDate(),
	).padStart(2, '0')}`
}

/** Group a newest-first feed into contiguous day buckets, preserving order. */
export function groupByDay(items: FeedItem[]): DayGroup[] {
	const groups: DayGroup[] = []
	for (const item of items) {
		const dayKey = dayKeyOf(item.createdAt)
		const last = groups[groups.length - 1]
		if (last && last.dayKey === dayKey) {
			last.items.push(item)
		} else {
			groups.push({ dayKey, items: [item] })
		}
	}
	return groups
}

/** "Today", "Yesterday", or the locale date. */
export function dayGroupLabel(dayKey: string, now: Date = new Date()): string {
	const todayKey = dayKeyOf(now.toISOString())
	if (dayKey === todayKey) {
		return 'Today'
	}
	const yesterday = new Date(now)
	yesterday.setDate(yesterday.getDate() - 1)
	if (dayKey === dayKeyOf(yesterday.toISOString())) {
		return 'Yesterday'
	}
	const [year, month, day] = dayKey.split('-').map(Number)
	if (!year || !month || !day) {
		return dayKey
	}
	return new Date(year, month - 1, day).toLocaleDateString(undefined, {
		weekday: 'short',
		month: 'short',
		day: 'numeric',
	})
}
