import { renderHook } from '@testing-library/react'
import { useWindowSize } from 'rooks'

import { useGridSize } from '../useGridSize'

jest.mock('rooks', () => ({ useWindowSize: jest.fn() }))

const atWidth = (innerWidth: number) => {
	jest
		.mocked(useWindowSize)
		.mockReturnValue({ innerWidth, innerHeight: 900 } as ReturnType<typeof useWindowSize>)
	return renderHook(() => useGridSize()).result.current.columns
}

describe('useGridSize', () => {
	// Default density is 'comfortable': mobile -> 2 columns, tablet -> 3.
	it('buckets a phone width as mobile', () => {
		expect(atWidth(375)).toBe(2)
		expect(atWidth(412)).toBe(2) // Pixel-class portrait
	})

	// Regression: 641-768px is where the old sidebar-width subtraction pushed the layout down into
	// the mobile bucket even though no sidebar is shown there. It must resolve to tablet now.
	it('buckets the 641-768px band as tablet, not mobile', () => {
		expect(atWidth(700)).toBe(3)
		expect(atWidth(768)).toBe(3)
	})

	it('buckets a small tablet width as tablet', () => {
		expect(atWidth(800)).toBe(3) // NXTPAPER 11" portrait-ish
		expect(atWidth(1024)).toBe(3)
	})

	it('buckets a desktop width above the tablet range', () => {
		expect(atWidth(1280)).toBe(6) // desktop-md, comfortable
	})
})
