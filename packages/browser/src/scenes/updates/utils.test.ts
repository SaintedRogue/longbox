import { dayKeyOf, type FeedItem, groupByDay } from './utils'

const item = (mediaId: string, createdAt: string): FeedItem => ({
	mediaId,
	seriesName: 'Saga',
	mediaName: `Saga #${mediaId}`,
	createdAt,
	isRead: false,
})

describe('dayKeyOf', () => {
	it('buckets by the local calendar day', () => {
		const key = dayKeyOf('2026-08-09T12:00:00Z')
		expect(key).toMatch(/^\d{4}-\d{2}-\d{2}$/)
	})

	it('passes malformed input through untouched', () => {
		expect(dayKeyOf('garbage')).toBe('garbage')
	})
})

describe('groupByDay', () => {
	it('groups contiguous same-day items and preserves order', () => {
		const groups = groupByDay([
			item('3', '2026-08-09T18:00:00'),
			item('2', '2026-08-09T09:00:00'),
			item('1', '2026-08-08T22:00:00'),
		])
		expect(groups.map((g) => g.items.map((i) => i.mediaId))).toEqual([['3', '2'], ['1']])
	})

	it('handles an empty feed', () => {
		expect(groupByDay([])).toEqual([])
	})
})
