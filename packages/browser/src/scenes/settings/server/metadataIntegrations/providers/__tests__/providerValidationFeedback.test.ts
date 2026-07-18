import { ProviderValidationStatus } from '@longbox/graphql'

import { composeMetronToken, metronStatusToFeedback } from '../providerValidationFeedback'

describe('metronStatusToFeedback', () => {
	it('maps Valid to a success, non-field feedback', () => {
		const fb = metronStatusToFeedback(ProviderValidationStatus.Valid, 'Credentials verified.')
		expect(fb.severity).toBe('success')
		expect(fb.asFieldError).toBe(false)
		expect(fb.description).toBe('Credentials verified.')
	})

	it('maps InvalidCredentials to the ONLY field-error case (error severity)', () => {
		const fb = metronStatusToFeedback(
			ProviderValidationStatus.InvalidCredentials,
			'Username or password rejected.',
		)
		expect(fb.severity).toBe('error')
		expect(fb.asFieldError).toBe(true)
		expect(fb.description).toBe('Username or password rejected.')
	})

	it('maps Forbidden to error severity but NOT a field error, with an account hint', () => {
		const fb = metronStatusToFeedback(ProviderValidationStatus.Forbidden, 'Access denied.')
		expect(fb.severity).toBe('error')
		expect(fb.asFieldError).toBe(false)
		expect(fb.hint).toBeTruthy()
	})

	it('maps NetworkError to a warning with the IP-ban hint', () => {
		const fb = metronStatusToFeedback(
			ProviderValidationStatus.NetworkError,
			"Couldn't reach metron.cloud.",
		)
		expect(fb.severity).toBe('warning')
		expect(fb.asFieldError).toBe(false)
		expect(fb.hint).toMatch(/IP/i)
	})

	it('maps RateLimited and ProviderError to warnings', () => {
		expect(metronStatusToFeedback(ProviderValidationStatus.RateLimited, 'x').severity).toBe(
			'warning',
		)
		expect(metronStatusToFeedback(ProviderValidationStatus.ProviderError, 'x').severity).toBe(
			'warning',
		)
	})

	it('never marks anything other than InvalidCredentials as a field error', () => {
		const statuses = [
			ProviderValidationStatus.Valid,
			ProviderValidationStatus.Forbidden,
			ProviderValidationStatus.NetworkError,
			ProviderValidationStatus.RateLimited,
			ProviderValidationStatus.ProviderError,
			ProviderValidationStatus.Unsupported,
		]
		for (const s of statuses) {
			expect(metronStatusToFeedback(s, 'm').asFieldError).toBe(false)
		}
	})
})

describe('composeMetronToken', () => {
	it('joins username and password with a colon', () => {
		expect(composeMetronToken('rogue', 'hunter2')).toBe('rogue:hunter2')
	})

	it('is lossless when the password itself contains a colon', () => {
		expect(composeMetronToken('rogue', 'a:b:c')).toBe('rogue:a:b:c')
	})

	it('returns an empty string when both parts are empty (keeps the form invalid)', () => {
		expect(composeMetronToken('', '')).toBe('')
	})
})
