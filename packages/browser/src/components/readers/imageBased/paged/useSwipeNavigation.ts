import { useSwipeable } from 'react-swipeable'

type Params = {
	/**
	 * Whether swipe navigation is enabled at all. Mirrors the `swipeToNavigate` preference.
	 */
	enabled: boolean
	/**
	 * Whether the page is currently zoomed in. While zoomed, dragging pans the page and swipe
	 * navigation stands down -- otherwise a pan and a page turn would fight over the same gesture.
	 */
	isZoomed: boolean
	/**
	 * Navigate towards the left-hand page set. Reading direction is *not* this hook's concern:
	 * `ImageBasedReader` already reverses `pageSets` for RTL books, so "leftward" is leftward on
	 * screen in both directions and RTL falls out for free.
	 */
	onLeftward: () => void
	/**
	 * Navigate towards the right-hand page set. See `onLeftward` on reading direction.
	 */
	onRightward: () => void
}

/**
 * Horizontal swipe-to-turn-page for the paged reader.
 *
 * The gesture semantics are inverted with respect to the page that gets shown: swiping *left*
 * drags the current page off to the left, revealing the page to its right, so it navigates
 * rightward. This matches the side tap zones, which sit on the side they navigate towards.
 *
 * Vertical swipes are deliberately left alone. A page scaled to fit the width is usually taller
 * than the viewport, so vertical dragging has to stay native scrolling -- hence
 * `preventScrollOnSwipe: false`, and hence the `touch-action: pan-y` the caller sets while at rest.
 */
export function useSwipeNavigation({ enabled, isZoomed, onLeftward, onRightward }: Params) {
	const active = enabled && !isZoomed

	return useSwipeable({
		onSwipedLeft: active ? onRightward : undefined,
		onSwipedRight: active ? onLeftward : undefined,
		// Never swallow vertical scrolling -- a tall page still has to scroll under the finger.
		preventScrollOnSwipe: false,
		// Touch only. Tracking the mouse would turn a desktop panzoom drag into a page turn.
		trackMouse: false,
		trackTouch: true,
		// Enough travel to distinguish a deliberate horizontal swipe from a vertical scroll that
		// wandered, or from the small drift of a tap.
		delta: 50,
	})
}
