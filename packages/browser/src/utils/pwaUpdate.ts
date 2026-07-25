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

/**
 * The server route that reports which build the server itself came out of.
 *
 * It is a POST, not a GET -- see `apps/server/src/routers/api/v2/mod.rs`. It is also one of the
 * few unauthenticated routes on the API, so this works on the login screen too.
 */
export const SERVER_VERSION_ROUTE = '/api/v2/version'

/**
 * Ask the server which git rev it was built from.
 *
 * The response is Rust's `LongboxVersion`, which is `#[serde(rename_all = "camelCase")]` -- so the
 * fields on the wire are `semver`, `buildChannel`, `rev`, `compileTime`. `rev` is the only one we
 * care about here.
 *
 * Throws if the server is unreachable or answers with anything but a 2xx; callers treat that as
 * "don't know", never as "out of date".
 */
export const fetchServerBuildRev = async (
	baseUrl: string,
	signal?: AbortSignal,
): Promise<string> => {
	const response = await fetch(`${baseUrl.replace(/\/+$/, '')}${SERVER_VERSION_ROUTE}`, {
		method: 'POST',
		signal,
	})

	if (!response.ok) {
		throw new Error(`Version check failed with status ${response.status}`)
	}

	const { rev } = (await response.json()) as { rev?: unknown }
	return typeof rev === 'string' ? rev : ''
}

export type BuildRevHandshake = {
	/**
	 * The git rev baked into this bundle at build time (`__LONGBOX_BUILD_REV__`, fed by the
	 * `GIT_REV` build arg). Empty/undefined for any build that wasn't stamped -- notably every
	 * local `yarn build` -- which means "unknown", and unknown must never be reported as stale.
	 */
	buildRev: string | undefined | null
	/**
	 * Reads the rev the *server* was built from. Rejecting (offline, 5xx, logged out of a future
	 * authenticated variant) is fine and means "unknown".
	 */
	fetchServerRev: () => Promise<string | undefined | null>
	/**
	 * Invoked only when both revs are known and differ.
	 */
	onMismatch: () => void
}

/**
 * Compare the build this bundle came from against the build the server is running.
 *
 * This is a *self*-check against the user's own server -- deliberately not an upstream release
 * checker (one was removed from this fork during the rebrand; nothing here talks to github.com).
 * A mismatch means the server has been redeployed since this tab loaded its JavaScript, which is
 * the condition that used to go unnoticed for hours: the tab looks healthy while running code the
 * server no longer serves.
 *
 * It stays quiet unless it is certain: an unstamped bundle, a server that doesn't report a rev, or
 * a request that fails all resolve to "no opinion" rather than nagging. That is what keeps it from
 * firing in development, where `GIT_REV` is never set.
 */
export const checkBuildRev = async ({
	buildRev,
	fetchServerRev,
	onMismatch,
}: BuildRevHandshake): Promise<void> => {
	// Unstamped bundle (dev build) -- there is nothing to compare against
	if (!buildRev) return

	let serverRev: string | undefined | null
	try {
		serverRev = await fetchServerRev()
	} catch {
		// Unreachable server / offline / non-2xx. Silence is correct: we cannot tell whether we
		// are stale, and a false "you're out of date" is worse than a missed one.
		return
	}

	if (!serverRev || serverRev === buildRev) return

	onMismatch()
}
