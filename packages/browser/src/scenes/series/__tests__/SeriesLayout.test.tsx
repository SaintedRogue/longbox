import { render } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

import SeriesLayout from '../SeriesLayout'

/**
 * Opening one series and then another used to show the first one again, for every series
 * rather than any particular one. The read was keyed on a bare `['seriesById']` with no id
 * in it, so all series shared a single react-query cache entry: whichever you opened first
 * populated it, and every later series re-rendered that same cached payload.
 */

const mockUseSuspenseGraphQL = jest.fn()

jest.mock('@longbox/client', () => ({
	PREFETCH_STALE_TIME: 0,
	useSDK: () => ({
		sdk: { cacheKey: (key: string, args: unknown[] = []) => [key, ...args] },
	}),
	useSuspenseGraphQL: (...args: unknown[]) => mockUseSuspenseGraphQL(...args),
}))
jest.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ prefetchQuery: jest.fn() }) }))
jest.mock('@/hooks', () => ({ usePreferences: () => ({ preferences: {} }) }))
jest.mock('@/components/container', () => ({
	SceneContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))
jest.mock('../SeriesHeader', () => ({
	__esModule: true,
	default: () => <div data-testid="series-header" />,
}))

const renderAt = (id: string) =>
	render(
		<MemoryRouter initialEntries={[`/series/${id}/books`]}>
			<Routes>
				<Route path="/series/:id/*" element={<SeriesLayout />} />
			</Routes>
		</MemoryRouter>,
	)

const keyOfLastCall = () => mockUseSuspenseGraphQL.mock.calls.at(-1)?.[1]

beforeEach(() => {
	mockUseSuspenseGraphQL.mockReset()
	mockUseSuspenseGraphQL.mockReturnValue({ data: { seriesById: { id: 'whatever' } } })
})

describe('SeriesLayout', () => {
	it('keys the series read by the series in the route', () => {
		renderAt('absolute-carnage')

		expect(keyOfLastCall()).toContain('absolute-carnage')
	})

	it('uses a different cache key for a different series', () => {
		renderAt('absolute-carnage')
		const first = keyOfLastCall()

		renderAt('immortal-hulk')
		const second = keyOfLastCall()

		expect(second).not.toEqual(first)
		expect(second).toContain('immortal-hulk')
	})

	it('asks for the series in the route', () => {
		renderAt('immortal-hulk')

		expect(mockUseSuspenseGraphQL.mock.calls.at(-1)?.[2]).toEqual({ id: 'immortal-hulk' })
	})
})
