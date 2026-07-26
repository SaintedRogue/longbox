import { act, render } from '@testing-library/react'
import type { NavigationType } from 'react-router-dom'

// react-router models these as an enum, but the enum object lives in the module this file
// mocks -- so the values are spelled out and cast rather than imported at runtime.
const PUSH = 'PUSH' as NavigationType
const POP = 'POP' as NavigationType

import { useScrollRestoration } from '../useScrollRestoration'

/**
 * Restoring scroll on POP is a race against content that has not laid out yet: the list
 * remounts at zero height, so the saved offset is unreachable for some number of frames while
 * react-query resolves and the grid fills in. The hook re-applies across a bounded set of
 * frames to cover that gap.
 *
 * Removing the peek overlay makes this load-bearing -- browse grids now genuinely unmount on
 * drill-down, so every back-navigation depends on this loop converging. The budget therefore
 * has to outlast a cold list, and it has to yield the moment the user starts scrolling
 * themselves rather than yanking the viewport out from under them.
 */

let mockKey = 'entry-1'
jest.mock('react-router-dom', () => ({ useLocation: () => ({ key: mockKey }) }))

function Harness({ navigationType }: { navigationType: NavigationType }) {
	useScrollRestoration(navigationType)
	return null
}

let rafQueue: FrameRequestCallback[] = []

const flushFrames = (count: number) => {
	for (let i = 0; i < count; i++) {
		const pending = rafQueue
		rafQueue = []
		act(() => pending.forEach((cb) => cb(0)))
	}
}

function mountScroller() {
	const el = document.createElement('div')
	el.id = 'main'
	let scrollTop = 0
	let scrollHeight = 500
	Object.defineProperty(el, 'scrollTop', {
		get: () => scrollTop,
		set: (value: number) => {
			scrollTop = value
		},
	})
	Object.defineProperty(el, 'clientHeight', { get: () => 500 })
	Object.defineProperty(el, 'scrollHeight', { get: () => scrollHeight })
	document.body.appendChild(el)

	return {
		el,
		grow: (height: number) => {
			scrollHeight = height
		},
		collapse: () => {
			scrollHeight = 500
		},
	}
}

describe('useScrollRestoration', () => {
	let scroller: ReturnType<typeof mountScroller>

	beforeEach(() => {
		document.body.replaceChildren()
		rafQueue = []
		mockKey = 'entry-1'
		scroller = mountScroller()
		jest.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
			rafQueue.push(cb)
			return rafQueue.length
		})
		jest.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined)
	})

	afterEach(() => jest.restoreAllMocks())

	/** Visit entry-1, scroll it, leave for entry-2 -- so entry-1 has a saved offset to restore. */
	const visitScrollAndLeave = (offset: number) => {
		const view = render(<Harness navigationType={PUSH} />)

		scroller.grow(4000)
		scroller.el.scrollTop = offset
		// Dispatched on the scroller itself, not on document: the hook's save listener ignores
		// any event whose target is not the scroller. Scroll events do not bubble, but the
		// capture phase still walks document -> target, which is what the listener relies on.
		act(() => {
			scroller.el.dispatchEvent(new Event('scroll'))
		})
		// the save listener is rAF-throttled
		flushFrames(1)

		mockKey = 'entry-2'
		view.rerender(<Harness navigationType={PUSH} />)

		return view
	}

	it('restores the saved offset when the list is already at full height', () => {
		const view = visitScrollAndLeave(800)

		mockKey = 'entry-1'
		view.rerender(<Harness navigationType={POP} />)

		expect(scroller.el.scrollTop).toBe(800)
	})

	it('keeps retrying while a slow list is still growing, past a one second budget', () => {
		const view = visitScrollAndLeave(800)

		// Coming back to a cold list: it remounts at zero height and stays there while the
		// query resolves.
		scroller.collapse()
		mockKey = 'entry-1'
		view.rerender(<Harness navigationType={POP} />)
		expect(scroller.el.scrollTop).toBe(0)

		flushFrames(90) // ~1.5s at 60fps -- past the old 60 frame cutoff
		scroller.grow(4000)
		flushFrames(1)

		expect(scroller.el.scrollTop).toBe(800)
	})

	it('gives up as soon as the user scrolls, instead of yanking the viewport back', () => {
		const view = visitScrollAndLeave(800)

		scroller.collapse()
		mockKey = 'entry-1'
		view.rerender(<Harness navigationType={POP} />)

		act(() => {
			window.dispatchEvent(new Event('wheel'))
		})

		scroller.grow(4000)
		flushFrames(5)

		expect(scroller.el.scrollTop).toBe(0)
	})

	it('resets to the top on a forward navigation', () => {
		const view = visitScrollAndLeave(800)

		mockKey = 'entry-3'
		view.rerender(<Harness navigationType={PUSH} />)

		expect(scroller.el.scrollTop).toBe(0)
	})
})
