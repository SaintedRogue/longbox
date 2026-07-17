import { fireEvent, render, screen } from '@testing-library/react'

import { useSwipeNavigation } from '../useSwipeNavigation'

type Props = Parameters<typeof useSwipeNavigation>[0]

function Harness(props: Props) {
	const handlers = useSwipeNavigation(props)
	return (
		<div {...handlers} data-testid="surface">
			page
		</div>
	)
}

/**
 * react-swipeable reads real touch events, so a swipe has to be acted out rather than stubbed.
 * The travel comfortably clears the hook's 50px delta.
 */
const swipe = (from: number, to: number) => {
	const surface = screen.getByTestId('surface')
	const touch = (x: number) => ({ touches: [{ clientX: x, clientY: 100 }] })
	fireEvent.touchStart(surface, touch(from))
	fireEvent.touchMove(surface, touch((from + to) / 2))
	fireEvent.touchMove(surface, touch(to))
	fireEvent.touchEnd(surface)
}

const swipeLeft = () => swipe(300, 100)
const swipeRight = () => swipe(100, 300)

describe('useSwipeNavigation', () => {
	const onLeftward = jest.fn()
	const onRightward = jest.fn()
	const renderHarness = (overrides: Partial<Props> = {}) =>
		render(
			<Harness
				enabled
				isZoomed={false}
				onLeftward={onLeftward}
				onRightward={onRightward}
				{...overrides}
			/>,
		)

	beforeEach(() => {
		onLeftward.mockClear()
		onRightward.mockClear()
	})

	// Swiping left drags the page off to the left, revealing what is to its right.
	it('navigates rightward when swiping left', () => {
		renderHarness()
		swipeLeft()
		expect(onRightward).toHaveBeenCalledTimes(1)
		expect(onLeftward).not.toHaveBeenCalled()
	})

	it('navigates leftward when swiping right', () => {
		renderHarness()
		swipeRight()
		expect(onLeftward).toHaveBeenCalledTimes(1)
		expect(onRightward).not.toHaveBeenCalled()
	})

	// While zoomed the same drag is a pan, so swipe navigation has to stand down or the page would
	// jump to the next set as soon as the reader dragged across a zoomed-in panel.
	it('does not navigate while zoomed in', () => {
		renderHarness({ isZoomed: true })
		swipeLeft()
		swipeRight()
		expect(onLeftward).not.toHaveBeenCalled()
		expect(onRightward).not.toHaveBeenCalled()
	})

	it('does not navigate when the preference is off', () => {
		renderHarness({ enabled: false })
		swipeLeft()
		swipeRight()
		expect(onLeftward).not.toHaveBeenCalled()
		expect(onRightward).not.toHaveBeenCalled()
	})

	it('ignores travel below the swipe threshold', () => {
		renderHarness()
		swipe(200, 190)
		expect(onLeftward).not.toHaveBeenCalled()
		expect(onRightward).not.toHaveBeenCalled()
	})
})
