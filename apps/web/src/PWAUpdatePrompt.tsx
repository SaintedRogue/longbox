import { canApplyPendingUpdate, checkBuildRev, fetchServerBuildRev } from '@longbox/browser'
import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { toast } from 'sonner'
import { useRegisterSW } from 'virtual:pwa-register/react'

import { baseUrl } from './baseUrl'

/**
 * How often to ask the browser to re-fetch the service worker script. Without this the
 * only update check happens at page load, so a long-lived tab can sit on a stale build
 * indefinitely -- which is exactly what happened during a live debugging session (a
 * shipped feature looked missing, and IndexedDB was missing stores the new build creates).
 */
const UPDATE_CHECK_INTERVAL_MS = 15 * 60 * 1000

const OPEN_DIALOG_SELECTOR =
	'[role="dialog"]:not([data-state="closed"]), [role="alertdialog"]:not([data-state="closed"])'

const TOAST_ID = 'pwa-update'

const hasOpenDialog = () => !!document.querySelector(OPEN_DIALOG_SELECTOR)

/**
 * Ask the browser to re-fetch the service worker script. A rejection means the server is
 * unreachable or the SW script 404s -- there is nothing to do but try again later.
 */
const requestUpdateCheck = (registration: ServiceWorkerRegistration) =>
	registration.update().catch(() => {})

export default function PWAUpdatePrompt() {
	const { pathname } = useLocation()

	const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null)
	// The pathname the pending update is waiting on. `null` means nothing is pending.
	const [armedOn, setArmedOn] = useState<string | null>(null)

	const {
		needRefresh: [needRefresh],
		updateServiceWorker,
	} = useRegisterSW({
		onRegisteredSW: (_, swRegistration) => setRegistration(swRegistration ?? null),
	})

	// Poll for a newer service worker instead of only checking on page load. Also checks
	// whenever the tab is brought back to the foreground, which is the common case for a
	// tab that has been sitting open across a deploy.
	useEffect(() => {
		if (!registration) return

		const checkForUpdate = () => {
			if (document.visibilityState !== 'visible') return
			if (!navigator.onLine) return
			requestUpdateCheck(registration)
		}

		const interval = setInterval(checkForUpdate, UPDATE_CHECK_INTERVAL_MS)
		document.addEventListener('visibilitychange', checkForUpdate)

		return () => {
			clearInterval(interval)
			document.removeEventListener('visibilitychange', checkForUpdate)
		}
	}, [registration])

	// Ask the server directly whether it is still serving the build this bundle was compiled
	// from, rather than inferring it from the service worker. `registration.update()` above can
	// come back clean for reasons that have nothing to do with the app being current -- the SW
	// script erroring mid-deploy, a lost registration, a throttled check -- and when it does, the
	// tab keeps happily running code the server no longer serves. That is the exact failure this
	// is here to catch, and a rev comparison answers it definitively.
	//
	// A mismatch does NOT get its own UI: it just kicks the service worker, so the update lands
	// through the same needRefresh -> toast -> apply-on-navigate path as every other update.
	//
	// This is a check against *this* server, not an upstream release check. Nothing here contacts
	// github.com or any other external host.
	useEffect(() => {
		if (!registration) return

		const controller = new AbortController()

		const compareBuilds = () => {
			if (document.visibilityState !== 'visible') return
			if (!navigator.onLine) return

			// `checkBuildRev` stays silent unless it is certain: an unstamped bundle (every local
			// dev build, which has no GIT_REV) and a failed request both mean "no opinion".
			void checkBuildRev({
				buildRev: __LONGBOX_BUILD_REV__,
				fetchServerRev: () => fetchServerBuildRev(baseUrl, controller.signal),
				onMismatch: () => requestUpdateCheck(registration),
			})
		}

		// On boot, when the tab comes back to the foreground, and when the connection returns
		compareBuilds()
		document.addEventListener('visibilitychange', compareBuilds)
		window.addEventListener('online', compareBuilds)

		return () => {
			controller.abort()
			document.removeEventListener('visibilitychange', compareBuilds)
			window.removeEventListener('online', compareBuilds)
		}
	}, [registration])

	// Apply a pending update on the next route change, never underneath the user. See
	// `canApplyPendingUpdate` for the guards (reader routes, open dialogs).
	useEffect(() => {
		if (!needRefresh) return

		if (armedOn === null) {
			setArmedOn(pathname)
		} else if (pathname !== armedOn) {
			if (canApplyPendingUpdate({ armedOn, current: pathname, hasOpenDialog: hasOpenDialog() })) {
				toast.dismiss(TOAST_ID)
				updateServiceWorker(true)
				return
			}

			// Couldn't apply here (mid-read, or a dialog is open). Re-arm so the *next*
			// navigation gets another shot.
			setArmedOn(pathname)
		}

		// Re-asserted on every navigation while an update is pending, so a toast that was
		// dismissed (or missed) comes back rather than leaving the user on stale code.
		toast('A new version of Longbox is available', {
			id: TOAST_ID,
			description: 'It will be applied automatically the next time you navigate.',
			duration: Infinity,
			action: {
				label: 'Reload now',
				onClick: () => updateServiceWorker(true),
			},
		})
	}, [needRefresh, pathname, armedOn, updateServiceWorker])

	return null
}
