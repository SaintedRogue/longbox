import { migrateLegacyStorage } from '@longbox/client'
import React from 'react'
import { createRoot } from 'react-dom/client'

import App from './App'

// One-time pre-rebrand localStorage key migration (see @longbox/client's migrateLegacyStorage).
// This must run before any store (zustand `persist`, etc.) hydrates, so it's the very first
// thing this entrypoint does.
migrateLegacyStorage()

const rootElement = document.getElementById('root')

if (!rootElement) {
	throw new Error('Root element not found')
}

const root = createRoot(rootElement)
root.render(
	<React.StrictMode>
		<App />
	</React.StrictMode>,
)
