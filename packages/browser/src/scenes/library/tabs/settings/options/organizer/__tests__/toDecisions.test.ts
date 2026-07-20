import { toDecisions } from '../organizeMoves'

const move = (over: Partial<Parameters<typeof toDecisions>[0][number]>) =>
	({
		src: '/lib/Batman 001.cbz',
		dst: '/lib/Batman (2016)/Batman 001.cbz',
		canonicalName: 'Batman',
		year: 2016,
		externalId: 'cv-1',
		provider: 'comicvine',
		confidence: 0.92,
		bucket: 'CONFIDENT',
		existingSeriesId: null,
		...over,
	}) as Parameters<typeof toDecisions>[0][number]

describe('toDecisions', () => {
	it('includes only checked moves and maps fields', () => {
		const a = move({ src: '/lib/a.cbz' })
		const b = move({ src: '/lib/b.cbz' })
		const out = toDecisions([a, b], new Set(['/lib/a.cbz']))
		expect(out).toHaveLength(1)
		expect(out[0]).toMatchObject({
			src: '/lib/a.cbz',
			canonicalName: 'Batman',
			year: 2016,
			externalId: 'cv-1',
			provider: 'comicvine',
			seriesId: null,
		})
	})

	it('threads existingSeriesId as seriesId', () => {
		const m = move({ existingSeriesId: 'series-123' })
		const [d] = toDecisions([m], new Set([m.src]))
		expect(d?.seriesId).toBe('series-123')
	})

	it('returns empty when nothing checked', () => {
		expect(toDecisions([move({})], new Set())).toEqual([])
	})
})
