import { ProviderValidationStatus } from '@longbox/graphql'

export type FeedbackSeverity = 'success' | 'warning' | 'error'

/**
 * A classified validation result for display. `asFieldError` is true ONLY for
 * InvalidCredentials — the sole status that means "your password is wrong" and the only
 * one allowed to redden the password field. Everything else renders as a standalone
 * callout (or a success line), so a connectivity/IP or service failure is never mistaken
 * for a bad password.
 */
export type Feedback = {
	severity: FeedbackSeverity
	asFieldError: boolean
	title: string
	description: string
	hint?: string
}

export function metronStatusToFeedback(
	status: ProviderValidationStatus,
	message: string,
): Feedback {
	switch (status) {
		case ProviderValidationStatus.Valid:
			return { severity: 'success', asFieldError: false, title: 'Verified', description: message }
		case ProviderValidationStatus.InvalidCredentials:
			return {
				severity: 'error',
				asFieldError: true,
				title: 'Invalid credentials',
				description: message,
			}
		case ProviderValidationStatus.Forbidden:
			return {
				severity: 'error',
				asFieldError: false,
				title: 'Access denied',
				description: message,
				hint: 'Your Metron account may be filtered, banned, or inactive — check that your account email is verified. This is not a password problem.',
			}
		case ProviderValidationStatus.NetworkError:
			return {
				severity: 'warning',
				asFieldError: false,
				title: "Couldn't reach Metron",
				description: message,
				hint: "This is a connectivity/IP issue, not your credentials. If this server's IP is blocked by Metron, validation fails here even with a correct password.",
			}
		case ProviderValidationStatus.RateLimited:
			return {
				severity: 'warning',
				asFieldError: false,
				title: 'Rate limited',
				description: message,
			}
		case ProviderValidationStatus.ProviderError:
			return {
				severity: 'warning',
				asFieldError: false,
				title: 'Metron service issue',
				description: message,
			}
		case ProviderValidationStatus.Unsupported:
		default:
			return {
				severity: 'warning',
				asFieldError: false,
				title: 'Validation unavailable',
				description: message,
			}
	}
}

/**
 * Compose a Metron `username:password` token. Returns '' when both parts are empty so an
 * untouched form stays invalid (schema requires min length 1) rather than submitting a
 * bare ":". Lossless for colons in the password because the backend splits on the first
 * colon only.
 */
export function composeMetronToken(username: string, password: string): string {
	if (!username && !password) return ''
	return `${username}:${password}`
}
