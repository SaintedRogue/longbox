import { act, render, screen } from '@testing-library/react'

import { SearchProgress } from '../SearchProgress'

const advance = (seconds: number) =>
	act(() => {
		jest.advanceTimersByTime(seconds * 1000)
	})

describe('SearchProgress', () => {
	beforeEach(() => jest.useFakeTimers())
	afterEach(() => jest.useRealTimers())

	it('names the provider being searched', () => {
		render(<SearchProgress providerLabel="Comic Vine" />)

		expect(screen.getByText(/Searching Comic Vine/)).toBeInTheDocument()
	})

	it('runs a clock so a slow search is visibly alive', () => {
		render(<SearchProgress providerLabel="Metron" />)
		expect(screen.getByText('0:00')).toBeInTheDocument()

		advance(5)
		expect(screen.getByText('0:05')).toBeInTheDocument()

		// Past a minute the mm:ss format has to keep making sense.
		advance(60)
		expect(screen.getByText('1:05')).toBeInTheDocument()
	})

	it('stays quiet while the wait is still normal', () => {
		render(<SearchProgress providerLabel="Metron" />)
		advance(5)

		expect(screen.queryByText(/can take up to a minute/)).not.toBeInTheDocument()
	})

	it('explains the wait once it stops looking normal', () => {
		render(<SearchProgress providerLabel="Metron" />)
		advance(12)

		expect(screen.getByText(/can take up to a minute/)).toBeInTheDocument()
	})

	it('reassures rather than alarms on a very long wait', () => {
		render(<SearchProgress providerLabel="Metron" />)
		advance(35)

		// The distinction that matters: a long wait is normal here, and the copy
		// must not read as an error the user should act on.
		expect(screen.getByText(/Still working/)).toBeInTheDocument()
		expect(screen.getByText(/not a failure/)).toBeInTheDocument()
	})
})
