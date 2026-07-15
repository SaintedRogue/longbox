import { StumpWebClient } from '@stump/browser'
import { BrowserRouter } from 'react-router-dom'

import PWAUpdatePrompt from './PWAUpdatePrompt'

const getDebugUrl = () => {
	const { hostname } = window.location
	return `http://${hostname}:10801`
}

export const baseUrl = import.meta.env.PROD ? window.location.origin : getDebugUrl()

export default function App() {
	return (
		<BrowserRouter>
			<StumpWebClient platform={'browser'} baseUrl={baseUrl} />
			{import.meta.env.PROD && <PWAUpdatePrompt />}
		</BrowserRouter>
	)
}
