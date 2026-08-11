import { ReadingStatus } from '@longbox/graphql'

import { FilterInput } from '../context'
import { fieldsForEntity, selectionCount } from '../picker/fields'
import { getActiveFilterCount } from '../utils'

/**
 * The badge on the filter control used to be a count of *top-level keys*, so everything
 * under `metadata` -- which is nearly every filter there is -- collapsed into one. These
 * pin the two things that fixed it: descending into nested inputs, and stopping at the
 * operator object rather than counting the numbers inside it.
 */
describe('getActiveFilterCount', () => {
	it('counts nothing when there are no filters', () => {
		expect(getActiveFilterCount({})).toBe(0)
	})

	it('counts each metadata field separately rather than counting `metadata` once', () => {
		const filters = {
			metadata: {
				genres: { likeAnyOf: ['Horror', 'Sci-Fi', 'Crime'] },
				writers: { likeAnyOf: ['Alan Moore'] },
			},
		}
		expect(getActiveFilterCount(filters)).toBe(2)
	})

	it('counts a bounded range as one field, not one per bound', () => {
		const filters = {
			metadata: { year: { range: { from: 1987, to: 2026, inclusive: true } } },
		}
		expect(getActiveFilterCount(filters)).toBe(1)
	})

	it('counts an open-ended range as one field', () => {
		expect(getActiveFilterCount({ metadata: { year: { gte: 1987 } } })).toBe(1)
	})

	it('counts top-level and nested fields together', () => {
		const filters = {
			extension: { anyOf: ['cbz'] },
			metadata: { genres: { likeAnyOf: ['Horror'] } },
			readingStatus: { isAnyOf: [ReadingStatus.NotStarted] },
		}
		expect(getActiveFilterCount(filters)).toBe(3)
	})

	it('ignores the browse-state keys that are not filters', () => {
		const filters = {
			direction: 'ASC',
			orderBy: 'NAME',
			page: 2,
			pageSize: 20,
			search: 'swamp thing',
		}
		expect(getActiveFilterCount(filters)).toBe(0)
	})

	it('descends into boolean combinators', () => {
		const filters = {
			_or: [{ metadata: { genres: { likeAnyOf: ['Horror'] } } }, { extension: { eq: 'cbz' } }],
		}
		expect(getActiveFilterCount(filters)).toBe(2)
	})
})

describe('picker fields', () => {
	const mediaField = (key: string) => {
		const field = fieldsForEntity('media').find((candidate) => candidate.key === key)
		if (!field) throw new Error(`no media field ${key}`)
		return field
	}

	it('round-trips a metadata selection through read and write', () => {
		const genre = mediaField('genre')
		if (genre.kind !== 'values') throw new Error('expected a values field')

		const filters = genre.write({}, ['Horror', 'Crime'])
		expect(genre.read(filters)).toEqual(['Horror', 'Crime'])
		expect(getActiveFilterCount(filters as Record<string, unknown>)).toBe(1)
	})

	/**
	 * Clearing has to remove the husk, not just the values: `{"metadata":{"genres":{}}}`
	 * would keep the badge lit over a view that is no longer filtered.
	 */
	it('clears a field back to an empty filter input', () => {
		const genre = mediaField('genre')
		if (genre.kind !== 'values') throw new Error('expected a values field')

		const filters = genre.write(genre.write({}, ['Horror']), [])
		expect(filters).toEqual({})
		expect(getActiveFilterCount(filters as Record<string, unknown>)).toBe(0)
	})

	it('leaves other fields alone when one is cleared', () => {
		const genre = mediaField('genre')
		const writer = mediaField('writer')
		if (genre.kind !== 'values' || writer.kind !== 'values') throw new Error('expected values')

		const both = writer.write(genre.write({}, ['Horror']), ['Alan Moore'])
		const cleared = genre.write(both, [])
		expect(writer.read(cleared)).toEqual(['Alan Moore'])
		expect(genre.read(cleared)).toEqual([])
	})

	/**
	 * The overview calls this `publishers` and the filter input calls it `publisher`. The
	 * two are wired together by hand, so a test holds them together.
	 */
	it('writes publisher through the singular filter key', () => {
		const publisher = mediaField('publisher')
		if (publisher.kind !== 'values') throw new Error('expected a values field')

		const filters = publisher.write({}, ['DC']) as { metadata?: Record<string, unknown> }
		expect(filters.metadata).toHaveProperty('publisher')
		expect(publisher.read(filters as FilterInput)).toEqual(['DC'])
	})

	it('reads a single `eq` extension written by the old filter drawer', () => {
		const extension = mediaField('extension')
		if (extension.kind !== 'values') throw new Error('expected a values field')

		expect(extension.read({ extension: { eq: 'cbz' } } as FilterInput)).toEqual(['cbz'])
	})

	it('round-trips both bounds of a range field', () => {
		const year = mediaField('year')
		if (year.kind !== 'range') throw new Error('expected a range field')

		const filters = year.write({}, { from: 1987, to: 2026 })
		expect(year.read(filters)).toEqual({ from: 1987, to: 2026 })
		expect(selectionCount(year, filters)).toBe(1)
	})

	it('round-trips a one-sided range', () => {
		const year = mediaField('year')
		if (year.kind !== 'range') throw new Error('expected a range field')

		const filters = year.write({}, { from: 1987, to: null })
		expect(year.read(filters)).toEqual({ from: 1987, to: undefined })
	})

	it('clears a range when both bounds are blank', () => {
		const year = mediaField('year')
		if (year.kind !== 'range') throw new Error('expected a range field')

		expect(year.write(year.write({}, { from: 1987 }), { from: null, to: null })).toEqual({})
	})

	it('exposes no fields for entities without a filter vocabulary', () => {
		expect(fieldsForEntity('library')).toEqual([])
	})
})
