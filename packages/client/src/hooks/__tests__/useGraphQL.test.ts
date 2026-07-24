import { computeReconnectDelay } from '../useGraphQL'

describe('computeReconnectDelay', () => {
	it('returns a delay within [0, cap] for a range of attempt numbers', () => {
		const expectedCaps = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000]

		expectedCaps.forEach((cap, attempt) => {
			for (let i = 0; i < 50; i++) {
				const delay = computeReconnectDelay(attempt)
				expect(delay).toBeGreaterThanOrEqual(0)
				expect(delay).toBeLessThanOrEqual(cap)
			}
		})
	})

	it('saturates the cap at 30000ms for large attempt numbers', () => {
		for (let i = 0; i < 50; i++) {
			expect(computeReconnectDelay(10)).toBeLessThanOrEqual(30_000)
			expect(computeReconnectDelay(100)).toBeLessThanOrEqual(30_000)
		}
	})
})
