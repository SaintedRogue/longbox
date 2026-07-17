import { useAuthQuery, useSDK } from '@stump/client'
import { cn, cx } from '@stump/components'
import { UserPermission, UserPreferences } from '@stump/graphql'
import { isAxiosError } from '@stump/sdk'
import { useQueryClient } from '@tanstack/react-query'
import { useOverlayScrollbars } from 'overlayscrollbars-react'
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef } from 'react'
import Confetti from 'react-confetti'
import { useErrorBoundary } from 'react-error-boundary'
import {
	Location,
	NavigationType,
	Outlet,
	Route,
	Routes,
	useLocation,
	useNavigate,
} from 'react-router-dom'
import { useMediaMatch, useWindowSize } from 'rooks'
import { toast } from 'sonner'

import BackgroundFetchIndicator from '@/components/BackgroundFetchIndicator'
import JobOverlay from '@/components/jobs/JobOverlay'
import { MobileTopBar, SideBar, TopBar } from '@/components/navigation'
import RouteLoadingIndicator from '@/components/RouteLoadingIndicator'

import { AppContext, PermissionEnforcerOptions } from './context'
import { useIsMobile, useScrollRestoration, useTheme } from './hooks'
import { useCoreEvent } from './hooks/useCoreEvent'
import { useOfflineDownloads } from './offline/useDownloads'
import { useProgressOutbox } from './offline/useProgressOutbox'
import { OfflineAppShell } from './OfflineAppShell'
import { useAppStore, useUserStore } from './stores'

const BookPeekSheet = lazy(() => import('./scenes/book/BookPeekSheet'))

type AppLayoutProps = {
	/**
	 * The real browser location, set only while a peek overlay (e.g. the book
	 * detail sheet) should be open. Rendered inside this component's own
	 * AppContext.Provider (rather than back up in AppRouter) so overlay
	 * content has access to the same permission/user context as the rest of
	 * the app -- the main route tree here is matched against
	 * `state.backgroundLocation` instead, so `useLocation()` in this
	 * component does not reflect the real URL while peeking.
	 */
	overlayLocation?: Location
	/**
	 * The real navigation type (POP/PUSH/REPLACE), read in AppRouter. It must be
	 * threaded in rather than read here via `useNavigationType()`: AppRouter
	 * renders the main tree through `<Routes location={...}>` (always set, for the
	 * peek overlay), which wraps this subtree in a LocationContext that hardcodes
	 * navigationType to POP — so a local `useNavigationType()` would always report
	 * POP. Scroll restoration needs the true type.
	 */
	navigationType: NavigationType
}

export function AppLayout({ overlayLocation, navigationType }: AppLayoutProps) {
	const location = useLocation()
	const navigate = useNavigate()

	const mainRef = useRef<HTMLDivElement>(null)
	const isMobile = useIsMobile()
	// Canvas motion can't be quieted from CSS, so the reduced-motion preference is honoured here in
	// JS -- the CSS block in preset.css covers everything else.
	const prefersReducedMotion = useMediaMatch('(prefers-reduced-motion: reduce)')
	const windowSize = useWindowSize()

	const { showBoundary } = useErrorBoundary()

	const { sdk } = useSDK()

	const showConfetti = useAppStore((state) => state.showConfetti)
	const setShowConfetti = useAppStore((state) => state.setShowConfetti)
	const onConnectionWithServerChanged = useAppStore((state) => state.setIsConnectedWithServer)

	const storeUser = useUserStore((state) => state.user)
	const checkUserPermission = useUserStore((state) => state.checkUserPermission)
	const setUser = useUserStore((state) => state.setUser)

	const { isDarkVariant, shouldUseGradient } = useTheme()
	const [initialize, instance] = useOverlayScrollbars({
		options: {
			scrollbars: {
				theme: isDarkVariant ? 'os-theme-light' : 'os-theme-dark',
			},
		},
	})

	const hideScrollBar = storeUser?.preferences?.enableHideScrollbar ?? false
	const jobOverlayEnabled = storeUser?.preferences?.enableJobOverlay ?? true
	const showJobOverlay = jobOverlayEnabled && !location.pathname.match(/\/settings\/jobs/)

	const isRefSet = !!mainRef.current
	/**
	 * An effect to initialize the overlay scrollbars
	 */
	useEffect(() => {
		// TODO: make this only on desktop? or a setting for 'pretty' scrollbars
		const { current: scrollContainer } = mainRef
		if (scrollContainer && !hideScrollBar) {
			initialize(scrollContainer)
		}
	}, [initialize, isRefSet, hideScrollBar])
	// The confetti burst self-clears via onConfettiComplete, but that never fires when the burst is
	// suppressed for reduced motion -- so clear the flag here, or it would linger and fire later.
	useEffect(() => {
		if (showConfetti && prefersReducedMotion) {
			setShowConfetti(false)
		}
	}, [showConfetti, prefersReducedMotion, setShowConfetti])
	/**
	 * An effect to find the added viewport element and add the necessary flexbox classes
	 * in order to not break the layout of children elements. This is because overlayscrollbars
	 * will append a new element to the DOM to handle the scrolling
	 */
	useEffect(() => {
		const viewport = instance()?.elements().viewport
		if (!viewport) {
			return
		}

		const requiredClasses = 'relative flex flex-1 flex-col'.split(' ')
		const missingClasses = requiredClasses.filter((c) => !viewport.classList.contains(c))
		if (missingClasses.length) {
			viewport.classList.add(...missingClasses)
		}
		viewport.dataset.artificialScroll = 'true'
	}, [instance, isRefSet])
	/**
	 * An effect to destroy the overlay scrollbars instance when it exists but hideScrollBar is true
	 */
	useEffect(() => {
		const instantiatedInstance = instance()
		if (hideScrollBar && instantiatedInstance) {
			instantiatedInstance.destroy()
		}
	}, [instance, isRefSet, hideScrollBar])

	// Restore scroll position on back/forward, reset to top on new navigations.
	// Mounted after the OverlayScrollbars setup so the viewport it targets exists.
	useScrollRestoration(navigationType)

	// Flush any durable reading-progress rows queued while offline (see the readers'
	// terminal onError branches) on mount and on every `online` event.
	useProgressOutbox()

	// Register the SDK-backed download fetcher (so enqueue() can actually fetch bytes) and
	// hydrate the durable-records projection from IndexedDB (so past downloads appear on load).
	useOfflineDownloads()

	/**
	 * If the user prefers the top bar, we hide the sidebar
	 */
	const preferTopBar = useMemo(() => {
		const userPreferences = storeUser?.preferences ?? ({} as UserPreferences)
		return userPreferences?.primaryNavigationMode === 'TOPBAR'
	}, [storeUser])

	/**
	 * Soft hiding the sidebar allows a nice animation when toggling the sidebar
	 * stacking preference
	 */
	const softHideSidebar = useMemo(() => {
		const userPreferences = storeUser?.preferences ?? ({} as UserPreferences)
		const { enableDoubleSidebar, enableReplacePrimarySidebar } = userPreferences

		// hide sidebar when double sidebar is enabled and replace primary sidebar is enabled and on a route where
		// a secondary sidebar is displayed (right now, just settings/*)
		if (enableDoubleSidebar && enableReplacePrimarySidebar) {
			return (location.pathname.match(/\/settings\/.+/) ?? []).length > 0
		} else {
			return false
		}
	}, [location, storeUser])

	/**
	 * If enabled, the client will refetch certain queries to hydrate the UI with
	 * new data. Otherwise, the client will wait for the job output before deciding
	 * what data to refetch.
	 */
	const liveRefetch = useMemo(
		() => (storeUser?.preferences ?? ({} as UserPreferences)).enableLiveRefetch || false,
		[storeUser],
	)

	/**
	 * Whenever we are in a Stump reader, we remove all navigation elements from
	 * the DOM
	 */
	const hideAllNavigation = useMemo(
		() => (location.pathname.match(/\/book(s?)\/.+\/(.*-?reader)/) ?? []).length > 0,
		[location],
	)

	const hideSidebar = hideAllNavigation || preferTopBar
	const hideTopBar = isMobile || hideAllNavigation || !preferTopBar

	useCoreEvent({ liveRefetch, onConnectionWithServerChanged })

	/**
	 * A callback to enforce a permission on the currently logged in user.
	 */
	const enforcePermission = useCallback(
		(
			permission: UserPermission,
			{ onFailure }: PermissionEnforcerOptions = {
				onFailure: () => navigate('..'),
			},
		) => {
			if (!checkUserPermission(permission)) {
				onFailure()
			}
		},
		[checkUserPermission, navigate],
	)

	// TODO: platform specific hotkeys?

	const { error, user } = useAuthQuery({
		enabled: !storeUser,
	})

	const client = useQueryClient()
	const logout = useCallback(async () => {
		try {
			await sdk.auth.logout()
			client.clear()
			setUser(null)
			navigate('/auth')
			toast.success('You have been logged out')
		} catch (error) {
			console.error('Error logging out:', { error })
			toast.error('There was an error logging you out. Please try again.')
		}
	}, [sdk, client, setUser, navigate])

	useEffect(() => {
		if (user) {
			setUser(user)
		}
	}, [user, setUser])

	const axiosError = isAxiosError(error) ? error : null
	const isUnauthorized = axiosError?.response?.status === 401
	const isNetworkError = axiosError?.code === 'ERR_NETWORK'
	// Cold offline load: server unreachable AND we have no cached identity to render the full
	// app with. A reachability failure is not an identity failure -- degrade to the offline shell
	// (local, downloads-backed content) instead of blocking the whole app behind a redirect.
	const isOffline = isNetworkError && !storeUser

	// FIXME(desktop): There is a bug somewhere here that causes a network error to be thrown before the auth takes effect.
	// It happens intermittently, annoyingly. I'm not sure what's causing it, but it would be nice to fix it
	useEffect(() => {
		if (isUnauthorized) {
			navigate('/auth', { state: { from: location } })
		} else if (error && !isNetworkError) {
			console.error('An unknown error occurred:', error)
			showBoundary(error)
		}
		// ERR_NETWORK: do NOT redirect -- render the offline shell (below) instead.
	}, [isUnauthorized, isNetworkError, error, showBoundary, location, navigate])

	if (isOffline) {
		return <OfflineAppShell />
	}

	if (!storeUser || error) {
		return null
	}

	return (
		<AppContext.Provider
			value={{
				checkPermission: checkUserPermission,
				enforcePermission,
				isServerOwner: storeUser.isServerOwner,
				user: storeUser,
				logout,
			}}
		>
			<Suspense fallback={<RouteLoadingIndicator />}>
				{showConfetti && !prefersReducedMotion && (
					<Confetti
						height={windowSize.innerHeight || undefined}
						width={windowSize.innerWidth || undefined}
						onConfettiComplete={() => setShowConfetti(false)}
						style={{
							zIndex: 1000,
						}}
					/>
				)}
				{!hideAllNavigation && <MobileTopBar />}
				{!hideTopBar && <TopBar />}
				<div className={cx('flex h-full flex-1', { 'pb-12': preferTopBar && !hideTopBar })}>
					<Suspense fallback={null}>
						{!hideSidebar && <SideBar hidden={softHideSidebar} />}
					</Suspense>
					<main
						id="main"
						className={cn(
							'flex w-full flex-1 flex-col overflow-x-hidden overflow-y-auto bg-background',
							{
								'scrollbar-hide': storeUser.preferences?.enableHideScrollbar,
							},
							{
								'bg-linear-to-br from-background-gradient-from to-background-gradient-to':
									shouldUseGradient,
							},
						)}
						ref={mainRef}
					>
						<div className="relative flex flex-1 flex-col">
							{!!storeUser.preferences?.showQueryIndicator && <BackgroundFetchIndicator />}
							<Suspense fallback={<RouteLoadingIndicator />}>
								<Outlet />
							</Suspense>
						</div>
					</main>
				</div>

				{showJobOverlay && <JobOverlay />}

				{overlayLocation && (
					<Suspense fallback={null}>
						<Routes location={overlayLocation}>
							<Route path="/books/:id" element={<BookPeekSheet />} />
						</Routes>
					</Suspense>
				)}
			</Suspense>
		</AppContext.Provider>
	)
}
