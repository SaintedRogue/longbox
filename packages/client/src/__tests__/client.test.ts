import { queryClient } from '../client'

/**
 * These defaults are what make a back-navigation into a list feel instant.
 *
 * With `staleTime: 0` every list refetched the moment it remounted, and with the react-query
 * default `gcTime` of 5 minutes a list you had been away from longer than that was evicted
 * entirely -- so returning re-suspended, the grid rendered at zero height, and scroll
 * restoration had nothing to restore against before its retry budget ran out. Caching the
 * list long enough to survive a drill-down is a precondition for "back puts me where I was",
 * not a micro-optimisation.
 */
describe('queryClient defaults', () => {
	const queries = queryClient.getDefaultOptions().queries

	it('keeps list data fresh long enough that a drill-down and back does not refetch', () => {
		expect(queries?.staleTime).toBeGreaterThanOrEqual(30_000)
	})

	it('retains cached lists well beyond the 5 minute default so returning paints synchronously', () => {
		expect(queries?.gcTime).toBeGreaterThanOrEqual(30 * 60 * 1000)
	})

	it('still refetches on window focus so a long-lived tab does not go stale', () => {
		expect(queries?.refetchOnWindowFocus).toBe(true)
	})
})
