import { MetadataProvider } from '@longbox/graphql'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import { ProviderEnabledSwitch } from '../ProviderEnabledSwitch'

/**
 * Enabling and disabling is the one provider setting worth changing on a whim -- a provider
 * is rate-limited, or down, or returning bad matches, and you want it out of the rotation
 * without touching its credentials. It used to mean opening the edit dialog and saving a form.
 */

const mockMutate = jest.fn()
const mockInvalidate = jest.fn(() => Promise.resolve())
let mockIsPending = false
let mockHandlers: { onSuccess?: () => unknown; onError?: (e: unknown) => unknown } = {}

jest.mock('@longbox/client', () => ({
	useGraphQLMutation: (_doc: unknown, options: Record<string, never>) => {
		mockHandlers = options
		return { mutate: (...args: unknown[]) => mockMutate(...args), isPending: mockIsPending }
	},
}))
jest.mock('@longbox/i18n', () => ({ useLocaleContext: () => ({ t: (key: string) => key }) }))
jest.mock('@tanstack/react-query', () => ({
	useQueryClient: () => ({ invalidateQueries: mockInvalidate }),
}))
jest.mock('sonner', () => ({ toast: { error: jest.fn() } }))

const renderSwitch = (enabled: boolean) =>
	render(<ProviderEnabledSwitch id={7} provider={MetadataProvider.ComicVine} enabled={enabled} />)

const theSwitch = () => screen.getByRole('switch')

beforeEach(() => {
	mockMutate.mockReset()
	mockInvalidate.mockClear()
	mockIsPending = false
	mockHandlers = {}
})

describe('ProviderEnabledSwitch', () => {
	it('reflects the provider’s current state', () => {
		renderSwitch(true)
		expect(theSwitch()).toBeChecked()
	})

	it('patches only `enabled` when switched off', () => {
		renderSwitch(true)
		fireEvent.click(theSwitch())

		expect(mockMutate).toHaveBeenCalledWith({ id: 7, enabled: false })
	})

	it('patches only `enabled` when switched on', () => {
		renderSwitch(false)
		fireEvent.click(theSwitch())

		expect(mockMutate).toHaveBeenCalledWith({ id: 7, enabled: true })
	})

	/** The switch should move on click, not after the round trip. */
	it('shows the new state immediately, before the server answers', () => {
		renderSwitch(true)
		fireEvent.click(theSwitch())

		expect(theSwitch()).not.toBeChecked()
	})

	it('refreshes the provider list once the change lands', async () => {
		renderSwitch(false)
		fireEvent.click(theSwitch())
		await mockHandlers.onSuccess?.()

		expect(mockInvalidate).toHaveBeenCalled()
	})

	/**
	 * Without this the switch would sit in a state the server rejected, which reads as though
	 * the provider had been turned off when it is still in the rotation.
	 */
	it('falls back to the real state when the change fails', async () => {
		renderSwitch(true)
		fireEvent.click(theSwitch())
		expect(theSwitch()).not.toBeChecked()

		await mockHandlers.onError?.(new Error('nope'))

		await waitFor(() => expect(theSwitch()).toBeChecked())
	})

	it('cannot be clicked again while a change is in flight', () => {
		mockIsPending = true
		renderSwitch(true)

		expect(theSwitch()).toBeDisabled()
	})
})
