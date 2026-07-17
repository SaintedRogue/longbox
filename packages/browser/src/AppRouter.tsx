import { LocaleProvider } from '@stump/i18n'
import { type AllowedLocale } from '@stump/i18n'
import { lazy, useState } from 'react'
import { Location, Route, Routes, useLocation, useNavigationType } from 'react-router-dom'

import { AppLayout } from './AppLayout.tsx'
import { RouterProvider } from './context/RouterContext.tsx'
import { BookRouter } from './scenes/book'
import { BookClubRouter } from './scenes/bookClub'
import { LibraryRouter } from './scenes/library'
import { SeriesRouter } from './scenes/series'
import { SettingsRouter } from './scenes/settings'
import { SmartListRouter } from './scenes/smartList'
import { useAppStore, useUserStore } from './stores'

const HomeScene = lazy(() => import('./scenes/home'))
const DownloadsRouter = lazy(() => import('./scenes/downloads/DownloadsRouter'))
const FourOhFour = lazy(() => import('./scenes/error/FourOhFour.tsx'))
const ServerConnectionErrorScene = lazy(
	() => import('./scenes/error/ServerConnectionErrorScene.tsx'),
)
const LoginOrClaimScene = lazy(() => import('./scenes/auth'))

type AppRouterProps = {
	basePath?: string
}

export function AppRouter({ basePath }: AppRouterProps = {}) {
	const locale = useUserStore((store) => store.userPreferences?.locale)
	const baseUrl = useAppStore((state) => state.baseUrl)
	const resolvedLocale = (locale as AllowedLocale) || 'en-US'

	// The real browser location. When a peek overlay (e.g. the book detail
	// sheet) is open, `state.backgroundLocation` holds the location the main
	// route tree should keep rendering "behind" the overlay, while this
	// (true) location is what the overlay itself matches against. See
	// BookPeekSheet / BookCard for producers of this state contract.
	const location = useLocation()
	// Read the true navigation type HERE, outside the `<Routes location={...}>`
	// override below — inside it, React Router forces navigationType to POP.
	// Threaded to AppLayout for scroll restoration (POP restores, PUSH resets).
	const navigationType = useNavigationType()

	// A backgroundLocation restored from a full page (re)load is stale: the
	// background tree's data and scroll are gone, so the URL must resolve to
	// its full-page scene instead (the deep-link contract) -- there'd
	// otherwise be no in-app path back to it. `window.history.state` survives
	// a same-document reload (F5), and @remix-run/router seeds the initial
	// Location.state from `history.state.usr`, so a peek opened before a
	// refresh would otherwise come back as a peek over a freshly-remounted
	// (and therefore blank-scrolled) background. Strip it once, synchronously
	// before first paint, from both the live render and history itself (so
	// back/forward landing back on this entry stays stripped too).
	const [strippedStaleBackground] = useState(() => {
		const usr = (window.history.state as { usr?: { backgroundLocation?: Location } } | null)?.usr
		if (usr?.backgroundLocation) {
			window.history.replaceState(
				{ ...window.history.state, usr: { ...usr, backgroundLocation: undefined } },
				'',
			)
			return true
		}
		return false
	})
	// The first location key seen by this instance, captured once. useState (not a ref) so it can
	// be compared during render without tripping react-compiler's no-refs-during-render rule; the
	// value is write-once either way.
	const [initialLocationKey] = useState(location.key)

	const rawBackgroundLocation = (location.state as { backgroundLocation?: Location } | null)
		?.backgroundLocation
	// Comparing the current entry's key against the first-seen key is how a stale restored
	// background (see above) is detected.
	const isInitialLocation = location.key === initialLocationKey
	const backgroundLocation =
		strippedStaleBackground && isInitialLocation ? undefined : rawBackgroundLocation

	if (!baseUrl) {
		throw new Error('Base URL is not set')
	}

	return (
		<LocaleProvider locale={resolvedLocale}>
			<RouterProvider basePath={basePath}>
				<Routes location={backgroundLocation ?? location}>
					<Route
						path="/"
						element={
							<AppLayout
								overlayLocation={backgroundLocation ? location : undefined}
								navigationType={navigationType}
							/>
						}
					>
						<Route path="" element={<HomeScene />} />
						<Route path="libraries/*" element={<LibraryRouter />} />
						<Route path="series/*" element={<SeriesRouter />} />
						<Route path="books/*" element={<BookRouter />} />
						<Route path="clubs/*" element={<BookClubRouter />} />
						<Route path="/smart-lists/*" element={<SmartListRouter />} />
						<Route path="downloads/*" element={<DownloadsRouter />} />
						<Route path="settings/*" element={<SettingsRouter />} />
					</Route>

					<Route path="/auth" element={<LoginOrClaimScene />} />
					<Route path="/server-connection-error" element={<ServerConnectionErrorScene />} />
					<Route path="*" element={<FourOhFour />} />
				</Routes>
			</RouterProvider>
		</LocaleProvider>
	)
}
