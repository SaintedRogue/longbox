import { MetadataProvider, ProviderValidationStatus } from '@longbox/graphql'
import { act, fireEvent, render, screen } from '@testing-library/react'

import { TestProviderButton } from '../TestProviderButton'

const mockMutate = jest.fn()
let mockMutationOptions: {
	onSuccess?: (data: unknown) => void
	onError?: (error: unknown) => void
} = {}
let mockIsPending = false

jest.mock('@longbox/client', () => ({
	useGraphQLMutation: (_doc: unknown, options: typeof mockMutationOptions) => {
		mockMutationOptions = options
		return { isPending: mockIsPending, mutate: mockMutate }
	},
}))

/** The callbacks are invoked by hand, outside React's cycle, so flush explicitly. */
const succeedWith = (status: ProviderValidationStatus, message: string) =>
	act(() => {
		mockMutationOptions.onSuccess?.({ testMetadataProvider: { message, status } })
	})

describe('TestProviderButton', () => {
	beforeEach(() => {
		mockMutate.mockClear()
		mockMutationOptions = {}
		mockIsPending = false
	})

	const renderAndClick = (provider = MetadataProvider.Metron) => {
		render(<TestProviderButton id={7} provider={provider} />)
		fireEvent.click(screen.getByRole('button', { name: /test connection/i }))
	}

	it('only runs a check when explicitly clicked', () => {
		render(<TestProviderButton id={7} provider={MetadataProvider.Metron} />)

		// The whole reason this capability was removed once: it used to fire without
		// anyone asking. Rendering must never issue a request.
		expect(mockMutate).not.toHaveBeenCalled()

		fireEvent.click(screen.getByRole('button', { name: /test connection to metron/i }))
		expect(mockMutate).toHaveBeenCalledWith({ id: 7 })
	})

	it('reports a successful check', () => {
		renderAndClick()
		succeedWith(ProviderValidationStatus.Valid, 'Credentials verified.')

		expect(screen.getByText('Verified')).toBeInTheDocument()
	})

	it('distinguishes a blocked host from a wrong password', () => {
		renderAndClick()
		succeedWith(ProviderValidationStatus.NetworkError, "Couldn't reach metron.cloud.")

		// The distinction that matters: a connectivity failure must not read as a
		// credential failure, which is what made a blocked IP look like a bad password.
		expect(screen.getByText("Couldn't reach Metron")).toBeInTheDocument()
		expect(screen.queryByText('Invalid credentials')).not.toBeInTheDocument()
	})

	it('names the provider under test in its hints', () => {
		renderAndClick(MetadataProvider.ComicVine)
		succeedWith(ProviderValidationStatus.Forbidden, 'Access denied.')

		expect(screen.getByText(/Your Comic Vine account may be/)).toBeInTheDocument()
	})

	it('surfaces a transport failure instead of failing silently', () => {
		renderAndClick()
		act(() => {
			mockMutationOptions.onError?.(new Error('network down'))
		})

		expect(screen.getByText('Test failed')).toBeInTheDocument()
	})
})
