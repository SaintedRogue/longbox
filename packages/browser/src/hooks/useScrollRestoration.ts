import { useEffect, useLayoutEffect, useRef } from 'react'
import { type NavigationType, useLocation } from 'react-router-dom'

/**
 * Per-session scroll offsets keyed by history `location.key`. Mirrors React
 * Router's own `<ScrollRestoration>` semantics — which Longbox cannot use: it is
 * data-router-only and restores *window* scroll, whereas the app scrolls a custom
 * OverlayScrollbars viewport. See docs/adr/0001-router-and-scroll-restoration.md.
 */
const scrollPositions = new Map<string, number>()

/**
 * Resolve the app's active scroll container. OverlayScrollbars injects a viewport
 * child (tagged `data-artificial-scroll`) that becomes the real scroller; when the
 * user disables pretty scrollbars, that instance is torn down and `#main`
 * (`overflow-y-auto`) scrolls directly. Resolve lazily on every use — the element
 * is created (and recreated) asynchronously by AppLayout, so it may not exist on
 * the shell's first render (while auth is still loading and AppLayout returns null).
 */
export function getAppScroller(): HTMLElement | null {
	return (
		document.querySelector<HTMLElement>('[data-artificial-scroll="true"]') ??
		document.getElementById('main')
	)
}

/**
 * Save-and-restore the app scroll position across route navigations, keyed by
 * `location.key`: restore on POP (browser back/forward), reset to top on
 * PUSH/REPLACE. Mount once, high in the shell (AppLayout).
 *
 * Saving uses a single *capturing* `scroll` listener on `document` for the app's
 * lifetime, rather than a listener on the scroller element, because:
 *   - The scroller doesn't exist on the shell's first render (AppLayout returns
 *     null while auth loads), and it's recreated when OverlayScrollbars re-inits —
 *     an element-scoped listener keyed on the route would miss the first entry
 *     entirely and never save it.
 *   - Scroll events don't bubble, but they do *capture*, so a document-level
 *     capturing listener still sees the OverlayScrollbars viewport scroll.
 * The listener records under `keyRef.current` (the entry live when the scroll
 * fired), so it always attributes scroll to the right history entry.
 *
 * Peek overlays (Stream D) are unaffected: while a peek is open, AppLayout's
 * `location` reflects the *background* entry, so `location.key` does not change and
 * the restore effect does not re-run — the background scroll is preserved natively.
 *
 * `navigationType` is passed in rather than read via `useNavigationType()`: this
 * hook runs under AppRouter's `<Routes location={...}>`, whose LocationContext
 * hardcodes the type to POP, so a local read would always report POP. AppRouter
 * reads the true type (outside that override) and threads it through AppLayout.
 */
export function useScrollRestoration(navigationType: NavigationType) {
	const { key } = useLocation()

	// The live entry key, mirrored into a ref so the lifetime-scoped scroll listener below can read
	// the current entry without being torn down and rebuilt on every navigation. Updated in an
	// effect rather than during render (the listener only reads it asynchronously, on user scroll).
	const keyRef = useRef(key)
	useEffect(() => {
		keyRef.current = key
	}, [key])

	// Save: one capturing document listener for the app's lifetime.
	useEffect(() => {
		let frame = 0
		const onScroll = (event: Event) => {
			const scroller = getAppScroller()
			if (!scroller || event.target !== scroller) {
				return
			}
			cancelAnimationFrame(frame)
			frame = requestAnimationFrame(() => {
				scrollPositions.set(keyRef.current, scroller.scrollTop)
			})
		}
		document.addEventListener('scroll', onScroll, { capture: true, passive: true })
		return () => {
			cancelAnimationFrame(frame)
			document.removeEventListener('scroll', onScroll, { capture: true })
		}
	}, [])

	// Restore (POP) or reset (PUSH/REPLACE) when the entry changes. On POP the
	// content may still be growing (Suspense / react-query), so re-apply across a
	// bounded set of frames until the container can reach the saved offset.
	useLayoutEffect(() => {
		const target = navigationType === 'POP' ? scrollPositions.get(key) : undefined

		if (target == null) {
			const el = getAppScroller()
			if (el) {
				el.scrollTop = 0
			}
			return
		}

		let frames = 0
		const MAX_FRAMES = 60 // ~1s @ 60fps, then give up
		let raf = 0
		const apply = () => {
			const el = getAppScroller()
			if (!el) {
				return
			}
			const maxScroll = el.scrollHeight - el.clientHeight
			el.scrollTop = Math.min(target, maxScroll)
			frames += 1
			if (maxScroll < target && frames < MAX_FRAMES) {
				raf = requestAnimationFrame(apply)
			}
		}
		apply()

		return () => cancelAnimationFrame(raf)
		// navigationType is a primitive string that only changes alongside a new entry (`key`), so
		// listing it costs no redundant re-runs while keeping the deps exhaustive -- which lets
		// react-compiler optimize this effect instead of bailing on a disabled lint rule.
	}, [key, navigationType])
}
