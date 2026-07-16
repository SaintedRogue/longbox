import { Badge } from '@stump/components'
import { useLocaleContext } from '@stump/i18n'
import { Suspense } from 'react'
import { Link, Outlet, useLocation } from 'react-router-dom'

import GenericEmptyState from '@/components/GenericEmptyState'
import LongboxMark from '@/components/LongboxMark'
import RouteLoadingIndicator from '@/components/RouteLoadingIndicator'
import paths from '@/paths'

/**
 * Chrome-less shell AppLayout renders instead of the full app when the auth/user fetch fails with
 * `ERR_NETWORK` and there's no cached identity to fall back on (see AppLayout's `isOffline`
 * discriminator). Deliberately has NO `AppContext.Provider` and none of the normal chrome
 * (SideBar/TopBar/UserMenu/JobOverlay): the offline-capable routes it hosts
 * (`/downloads/*` -- DownloadsScene, OfflineBookReaderScene) don't consume `useAppContext()` or the
 * user, and SideBar in particular does a server-dependent GraphQL fetch that would break offline.
 *
 * Renders the matched child route for `/downloads/*` (via `Outlet`, since this component is the
 * element for the parent `<Route path="/">` in AppRouter), or a static offline notice for any other
 * path -- those routes need the server/user and can't render meaningfully without them.
 */
export function OfflineAppShell() {
	const { t } = useLocaleContext()
	const location = useLocation()
	const isDownloadsRoute = location.pathname.startsWith('/downloads')

	return (
		<div className="flex min-h-screen w-screen flex-col bg-background">
			<header className="gap-2 px-4 py-3 flex shrink-0 items-center border-b border-border">
				<LongboxMark className="h-5 w-5 text-muted-foreground" />
				<Badge variant="warning" rounded="full">
					{t('offline.badge')}
				</Badge>
				<div className="flex-1" />
				<Link
					to={paths.downloads()}
					className="text-sm font-medium text-foreground hover:underline"
				>
					{t('offline.viewDownloads')}
				</Link>
			</header>

			<main className="flex flex-1 flex-col">
				<Suspense fallback={<RouteLoadingIndicator />}>
					{isDownloadsRoute ? <Outlet /> : <OfflineNotice />}
				</Suspense>
			</main>
		</div>
	)
}

function OfflineNotice() {
	const { t } = useLocaleContext()

	return (
		<div className="gap-4 p-8 flex flex-1 flex-col items-center justify-center">
			<GenericEmptyState title={t('offline.title')} subtitle={t('offline.message')} />
			<Link
				to={paths.downloads()}
				className="px-4 py-2 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:opacity-90"
			>
				{t('offline.viewDownloads')}
			</Link>
		</div>
	)
}
