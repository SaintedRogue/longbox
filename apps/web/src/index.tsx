import { migrateLegacyStorage } from '@longbox/client'
import React from 'react'
import { createRoot } from 'react-dom/client'

// Run the one-time pre-rebrand localStorage key migration BEFORE any persisted store hydrates.
// `./App` transitively imports `@longbox/browser`'s store modules (e.g.
// packages/browser/src/stores/user.ts), which eagerly call `createUserStore(localStorage)` (and
// friends) at module-eval time -- zustand's `persist` middleware hydrates synchronously from
// localStorage the moment that call happens. A static `import App from './App'` above this line
// would therefore hydrate every persisted store from the (not-yet-migrated) legacy `stump-*`
// keys before this shim ever ran. `@longbox/client` (imported above) is safe: its `persist(...)`
// calls all live inside factory functions (createUserStore/createAppStore/etc.) that only run
// when explicitly invoked, and it has no dependency on `@longbox/browser`. Keep `./App` reachable
// ONLY via the dynamic import below so nothing store-hydrating evaluates before this call.
migrateLegacyStorage()

const rootElement = document.getElementById('root')

if (!rootElement) {
	throw new Error('Root element not found')
}

void import('./App').then(({ default: App }) => {
	const root = createRoot(rootElement)
	root.render(
		<React.StrictMode>
			<App />
		</React.StrictMode>,
	)
})
