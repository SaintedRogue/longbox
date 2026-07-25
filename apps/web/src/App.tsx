import { LongboxWebClient } from '@longbox/browser'
import { BrowserRouter } from 'react-router-dom'

import { baseUrl } from './baseUrl'
import PWAUpdatePrompt from './PWAUpdatePrompt'

export { baseUrl }

export default function App() {
	return (
		<BrowserRouter>
			<LongboxWebClient platform={'browser'} baseUrl={baseUrl} />
			{import.meta.env.PROD && <PWAUpdatePrompt />}
		</BrowserRouter>
	)
}
