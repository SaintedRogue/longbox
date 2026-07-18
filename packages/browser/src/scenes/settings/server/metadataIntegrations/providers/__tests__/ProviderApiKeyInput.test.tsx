import { MergeStrategy, MetadataProvider } from '@longbox/graphql'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FormProvider, useForm } from 'react-hook-form'

import { ProviderApiKeyInput } from '../ProviderApiKeyInput'
import { CreateProviderConfigSchema } from '../schema'

// Avoid needing a real GraphQL client context; the component only pulls mutateAsync.
jest.mock('@longbox/client', () => ({
	useGraphQLMutation: () => ({
		mutateAsync: jest.fn().mockResolvedValue({
			validateMetadataProviderCredentials: { status: 'VALID', message: 'ok' },
		}),
	}),
}))

function Harness({ provider }: { provider: MetadataProvider }) {
	const form = useForm<CreateProviderConfigSchema>({
		defaultValues: {
			providerType: provider,
			enabled: true,
			apiToken: '',
			apiTokenExpiresAt: null,
			autoApplyConfig: {
				enabled: false,
				threshold: 0.95,
				strategy: MergeStrategy.FillGaps,
				excludeFields: [],
			},
		},
	})
	return (
		<QueryClientProvider client={new QueryClient()}>
			<FormProvider {...form}>
				<ProviderApiKeyInput />
				<output data-testid="apiToken">{form.watch('apiToken')}</output>
			</FormProvider>
		</QueryClientProvider>
	)
}

describe('ProviderApiKeyInput (Metron split)', () => {
	it('renders separate username and password fields for Metron', () => {
		render(<Harness provider={MetadataProvider.Metron} />)
		expect(screen.getByLabelText('Metron username')).toHaveAttribute('type', 'text')
		expect(screen.getByLabelText('Metron password')).toHaveAttribute('type', 'password')
	})

	it('composes username + password into apiToken as username:password', async () => {
		render(<Harness provider={MetadataProvider.Metron} />)
		await userEvent.type(screen.getByLabelText('Metron username'), 'rogue')
		await userEvent.type(screen.getByLabelText('Metron password'), 'pw')
		expect(screen.getByTestId('apiToken')).toHaveTextContent('rogue:pw')
	})

	it('renders a single token field for non-Metron providers', () => {
		render(<Harness provider={MetadataProvider.Hardcover} />)
		expect(screen.queryByLabelText('Metron username')).not.toBeInTheDocument()
	})
})
