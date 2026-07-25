const getDebugUrl = () => {
	const { hostname } = window.location
	return `http://${hostname}:10801`
}

/**
 * The origin of the Longbox server this app talks to.
 *
 * Lives in its own module rather than in `App.tsx` so `PWAUpdatePrompt` (which `App.tsx` renders)
 * can import it without the two files importing each other.
 */
export const baseUrl = import.meta.env.PROD ? window.location.origin : getDebugUrl()
