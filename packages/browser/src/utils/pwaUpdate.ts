/**
 * Routes where the app is actively rendering a book, i.e. where a reload would
 * interrupt someone mid-read:
 *
 * - `/books/:id/reader`, `/books/:id/epub-reader`, `/books/:id/pdf-reader` (see BookRouter)
 * - `/downloads/:id/read` (the offline reader)
 *
 * The pattern is deliberately not anchored at the start so it still matches when the
 * app is served from a base path (see the router context `basePath`).
 */
const READER_PATH_PATTERN = /\/(?:books\/[^/]+\/(?:epub-|pdf-)?reader|downloads\/[^/]+\/read)\/?$/

/**
 * Whether the given pathname renders one of the readers.
 */
export const isReaderPath = (pathname: string): boolean => READER_PATH_PATTERN.test(pathname)

export type PendingUpdateGate = {
	/**
	 * The pathname the app was on when the pending update was armed.
	 */
	armedOn: string
	/**
	 * The pathname the app is on right now.
	 */
	current: string
	/**
	 * Whether a modal dialog is currently open. Most of the app's forms live in
	 * dialogs, so an open dialog is a decent proxy for "there is in-progress state
	 * a reload would throw away".
	 */
	hasOpenDialog: boolean
}

/**
 * Whether a waiting service worker update may be applied right now.
 *
 * A pending update is only ever applied on a route change: navigating away from a
 * screen already discards that screen's state, so the reload costs nothing beyond
 * the page load. It is never applied while the user sits on a screen, never around
 * a reader route, and never while a dialog is open.
 */
export const canApplyPendingUpdate = ({
	armedOn,
	current,
	hasOpenDialog,
}: PendingUpdateGate): boolean => {
	// No navigation has happened yet -- never yank the page out from under someone
	if (current === armedOn) {
		return false
	}

	// Something modal is open, which very likely means a form is in progress
	if (hasOpenDialog) {
		return false
	}

	// Don't reload into a reader, the user is (about to be) reading
	if (isReaderPath(current)) {
		return false
	}

	// Don't reload straight out of a reader either: the reader's final progress save
	// may still be in flight, and a reload would abort it. Wait one more navigation.
	if (isReaderPath(armedOn)) {
		return false
	}

	return true
}
