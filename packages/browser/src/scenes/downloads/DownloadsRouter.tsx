import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router'

const DownloadsScene = lazy(() => import('./DownloadsScene'))
const OfflineBookReaderScene = lazy(() => import('./OfflineBookReaderScene'))

/**
 * Router for `/downloads/*`, mirroring `scenes/book/BookRouter.tsx`'s convention. Split out of a
 * single `<Route path="downloads" .../>` in AppRouter so the offline reader entry
 * (`/downloads/:id/read`, see OfflineBookReaderScene.tsx) has its own route.
 */
export default function DownloadsRouter() {
	return (
		<Suspense>
			<Routes>
				<Route index element={<DownloadsScene />} />
				<Route path=":id/read" element={<OfflineBookReaderScene />} />
				<Route path="*" element={<Navigate to="/404" />} />
			</Routes>
		</Suspense>
	)
}
