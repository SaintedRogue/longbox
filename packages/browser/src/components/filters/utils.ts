import { OrderDirection } from '@longbox/graphql'
import { ColumnOrder } from '@longbox/sdk'

import { Ordering, OrderingField } from './context'

export const EXCLUDED_FILTER_KEYS = ['orderBy', 'direction', 'page', 'pageSize', 'search']
export const EXCLUDED_FILTER_KEYS_FOR_COUNTS = EXCLUDED_FILTER_KEYS.concat(['search'])

/**
 * The operators a filter field can be expressed with. Their presence is what marks an
 * object as a *leaf* -- one field's condition -- rather than a nested filter input.
 */
const OPERATOR_KEYS = new Set([
	'anyOf',
	'contains',
	'endsWith',
	'eq',
	'excludes',
	'gt',
	'gte',
	'is',
	'isAnyOf',
	'isNoneOf',
	'isNot',
	'like',
	'likeAnyOf',
	'likeNoneOf',
	'lt',
	'lte',
	'neq',
	'noneOf',
	'range',
	'startsWith',
])

const isLeafFilter = (value: object): boolean =>
	Object.keys(value).some((key) => OPERATOR_KEYS.has(key))

/**
 * Counts the fields carrying a condition, descending through nested inputs.
 *
 * The count used to be `Object.keys(filters).length` less a few excluded keys, so every
 * metadata filter -- genres, writers, publication year, all of them -- lived under the
 * single `metadata` key and read as one. A view narrowed by three genres and two writers
 * showed a badge of 1, which undersells how filtered the view actually is.
 *
 * Fields rather than values: "3 filters" is the useful reading, and it keeps a bounded
 * range (one field, two numbers) from counting double.
 */
const countFilterFields = (input: Record<string, unknown>): number =>
	Object.entries(input).reduce((total, [, value]) => {
		if (value == null) return total
		// A boolean combinator (`_and`/`_or`/`_not`) holding further inputs.
		if (Array.isArray(value)) {
			return (
				total +
				value.reduce(
					(sum: number, entry) => sum + countFilterFields(entry as Record<string, unknown>),
					0,
				)
			)
		}
		// A bare scalar is a field in its own right, e.g. `isStandalone: true`.
		if (typeof value !== 'object') return total + 1
		return total + (isLeafFilter(value) ? 1 : countFilterFields(value as Record<string, unknown>))
	}, 0)

export const getActiveFilterCount = (filters: Record<string, unknown>): number =>
	countFilterFields(
		Object.fromEntries(
			Object.entries(filters).filter(([key]) => !EXCLUDED_FILTER_KEYS_FOR_COUNTS.includes(key)),
		),
	)

export const clearFilters = (filters: Record<string, unknown>): Record<string, unknown> =>
	Object.keys(filters).reduce(
		(acc, key) => {
			if (EXCLUDED_FILTER_KEYS.includes(key)) {
				acc[key] = filters[key]
			}
			return acc
		},
		{} as Record<string, unknown>,
	)

/**
 * Converts the react-table sort object to an ordering object.
 *
 * Note that only the **first** sort is considered.
 */
export const tableSortToOrdering = (sort: ColumnOrder[]): Ordering => {
	if (sort[0]) {
		return {
			direction: sort[0].desc ? OrderDirection.Desc : OrderDirection.Asc,
			orderBy: sort[0].id as OrderingField,
		}
	} else {
		return {}
	}
}

/**
 * Converts the ordering object to a react-table sort object.
 */
export const orderingToTableSort = (ordering: Ordering): ColumnOrder[] => {
	if (ordering.orderBy) {
		return [
			{
				desc: ordering.direction === OrderDirection.Desc,
				id: ordering.orderBy,
			},
		]
	} else {
		return []
	}
}
