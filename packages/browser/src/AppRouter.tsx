import { LocaleProvider } from '@longbox/i18n'
import { type AllowedLocale } from '@longbox/i18n'
import { lazy } from 'react'
import { Route, Routes, useLocation, useNavigationType } from 'react-router-dom'

import { AppLayout } from './AppLayout.tsx'
import { RouterProvider } from './context/RouterContext.tsx'
import { useAppStore, useUserStore } from './stores'

// Every route tree below is lazy so Vite emits one chunk per section instead of a single monolithic
// App chunk that has to download and parse before anything renders. They resolve inside the
// `<Suspense fallback={<RouteLoadingIndicator />}>` that AppLayout wraps its `<Outlet />` in, so a
// route transition keeps the shell (top bar / sidebar) mounted and never flashes an empty screen.
//
// Note these import the router *modules* directly rather than their `./scenes/<x>` barrels: the
// barrels also re-export prefetch hooks and context that the always-loaded shell imports, and going
// through them would drag those (and their dependency graphs) back into the App chunk.
const HomeScene = lazy(() => import('./scenes/home'))
const BookRouter = lazy(() => import('./scenes/book/BookRouter'))
const BookClubRouter = lazy(() => import('./scenes/bookClub/BookClubRouter'))
const CharacterRouter = lazy(() => import('./scenes/character/CharacterRouter'))
const LibraryRouter = lazy(() => import('./scenes/library/LibraryRouter'))
const SeriesRouter = lazy(() => import('./scenes/series/SeriesRouter'))
const SettingsRouter = lazy(() => import('./scenes/settings/SettingsRouter'))
const SmartListRouter = lazy(() => import('./scenes/smartList/SmartListRouter'))
const DownloadsRouter = lazy(() => import('./scenes/downloads/DownloadsRouter'))
const CalendarScene = lazy(() => import('./scenes/calendar'))
const SearchScene = lazy(() => import('./scenes/search'))
const UpdatesScene = lazy(() => import('./scenes/updates'))
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

	const location = useLocation()
	// Read the true navigation type HERE, outside the `<Routes location={...}>`
	// override below -- inside it, React Router forces navigationType to POP.
	// Threaded to AppLayout for scroll restoration (POP restores, PUSH resets).
	const navigationType = useNavigationType()

	if (!baseUrl) {
		throw new Error('Base URL is not set')
	}

	return (
		<LocaleProvider locale={resolvedLocale}>
			<RouterProvider basePath={basePath}>
				<Routes location={location}>
					<Route path="/" element={<AppLayout navigationType={navigationType} />}>
						<Route path="" element={<HomeScene />} />
						<Route path="libraries/*" element={<LibraryRouter />} />
						<Route path="series/*" element={<SeriesRouter />} />
						<Route path="characters/*" element={<CharacterRouter />} />
						<Route path="books/*" element={<BookRouter />} />
						<Route path="clubs/*" element={<BookClubRouter />} />
						<Route path="/smart-lists/*" element={<SmartListRouter />} />
						<Route path="calendar" element={<CalendarScene />} />
						<Route path="search" element={<SearchScene />} />
						<Route path="updates" element={<UpdatesScene />} />
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
