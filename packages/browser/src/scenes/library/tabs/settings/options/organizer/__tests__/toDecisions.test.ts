import { OrganizeOverride, toDecisions } from '../organizeMoves'

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

const moveWithSrc = (
	src: string,
	canonicalName = 'Auto',
	externalId = 'auto-1',
	provider = 'comicvine',
) =>
	({
		src,
		dst: '',
		canonicalName,
		year: 2020,
		externalId,
		provider,
		confidence: 0.9,
		bucket: 'CONFIDENT',
		existingSeriesId: null,
	}) as any

const override = (o: Partial<OrganizeOverride> = {}): OrganizeOverride => ({
	canonicalName: 'Manual',
	year: 1999,
	externalId: 'ext-9',
	provider: 'metron',
	...o,
})

test('an override replaces the auto match for the same src', () => {
	const d = toDecisions(
		[moveWithSrc('/a.cbz')],
		new Set(['/a.cbz']),
		new Map([['/a.cbz', override()]]),
	)
	expect(d).toHaveLength(1)
	expect(d[0]).toMatchObject({
		src: '/a.cbz',
		canonicalName: 'Manual',
		externalId: 'ext-9',
		provider: 'metron',
		year: 1999,
		seriesId: null,
	})
})

test('an override for a previously-unmatched src emits a decision', () => {
	const d = toDecisions(
		[],
		new Set(['/b.cbz']),
		new Map([['/b.cbz', override({ canonicalName: 'Found' })]]),
	)
	expect(d).toEqual([
		{
			src: '/b.cbz',
			seriesId: null,
			canonicalName: 'Found',
			year: 1999,
			externalId: 'ext-9',
			provider: 'metron',
		},
	])
})

test('an unchecked override emits nothing', () => {
	const d = toDecisions([], new Set(), new Map([['/c.cbz', override()]]))
	expect(d).toEqual([])
})
