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

/**
 * Classify a validation result for display.
 *
 * `provider` only ever appears in the *hints* — the status→severity mapping is
 * identical for every provider, because "wrong password" and "we couldn't reach
 * the host" mean the same thing regardless of who is on the other end. Naming the
 * provider in the hint is what makes the recovery advice actionable.
 */
export function validationStatusToFeedback(
	status: ProviderValidationStatus,
	message: string,
	provider = 'the provider',
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
				hint: `Your ${provider} account may be filtered, banned, or inactive — check that the account is verified and in good standing. This is not a password problem.`,
			}
		case ProviderValidationStatus.NetworkError:
			return {
				severity: 'warning',
				asFieldError: false,
				title: "Couldn't reach Metron",
				description: message,
				hint: `This is a connectivity or IP issue, not your credentials. If this server's IP is blocked by ${provider}, validation fails here even with a correct password.`,
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
				title: `${provider} service issue`,
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

/**
 * @deprecated Metron-specific alias kept so existing callers and tests keep working.
 * Prefer {@link validationStatusToFeedback}, which names the provider in its hints.
 */
export const metronStatusToFeedback = (
	status: ProviderValidationStatus,
	message: string,
): Feedback => validationStatusToFeedback(status, message, 'Metron')
