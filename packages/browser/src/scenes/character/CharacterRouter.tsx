import { lazy } from 'react'
import { Navigate, Route, Routes } from 'react-router'

const CharactersScene = lazy(() => import('./CharactersScene'))
const CharacterDetailScene = lazy(() => import('./CharacterDetailScene'))

export default function CharacterRouter() {
	return (
		<Routes>
			<Route path="" element={<CharactersScene />} />
			<Route path=":name" element={<CharacterDetailScene />} />

			<Route path="*" element={<Navigate to="/404" />} />
		</Routes>
	)
}
