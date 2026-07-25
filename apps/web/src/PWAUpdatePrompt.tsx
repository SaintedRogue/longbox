import { canApplyPendingUpdate } from '@longbox/browser'
import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { toast } from 'sonner'
import { useRegisterSW } from 'virtual:pwa-register/react'

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
			registration.update().catch(() => {
				// The server is unreachable / the SW script 404s -- nothing to do but retry later
			})
		}

		const interval = setInterval(checkForUpdate, UPDATE_CHECK_INTERVAL_MS)
		document.addEventListener('visibilitychange', checkForUpdate)

		return () => {
			clearInterval(interval)
			document.removeEventListener('visibilitychange', checkForUpdate)
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
