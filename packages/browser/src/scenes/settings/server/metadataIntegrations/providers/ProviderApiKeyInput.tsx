import { useGraphQLMutation } from '@longbox/client'
import { Alert, AlertDescription, AlertTitle, PasswordInput, Text } from '@longbox/components'
import { graphql, MetadataProvider, ProviderValidationStatus } from '@longbox/graphql'
import { useLocaleContext } from '@longbox/i18n'
import { useMutation } from '@tanstack/react-query'
import getProperty from 'lodash/get'
import { AlertTriangleIcon } from 'lucide-react'
import { useCallback, useEffect } from 'react'
import { useFormContext, useFormState, useWatch } from 'react-hook-form'
import { useDebouncedValue } from 'rooks'

import { CreateProviderConfigSchema } from './schema'

const validateCredentialsMutation = graphql(`
	mutation ProviderApiKeyInputValidateCredentials(
		$providerType: MetadataProvider!
		$apiToken: String!
	) {
		validateMetadataProviderCredentials(providerType: $providerType, apiToken: $apiToken) {
			status
			message
		}
	}
`)

export function ProviderApiKeyInput() {
	const form = useFormContext<CreateProviderConfigSchema>()
	const { t } = useLocaleContext()
	const { errors } = useFormState({ control: form.control })

	const [provider, value] = useWatch({
		control: form.control,
		name: ['providerType', 'apiToken'],
	})

	const [debouncedValue] = useDebouncedValue(value, 500)

	// Metron has no CORS, so it can't be validated from the browser. Instead we ask
	// our server to make the authenticated request (with a proper non-browser
	// User-Agent) and report a granular status back.
	const { mutateAsync: validateOnServer } = useGraphQLMutation(validateCredentialsMutation)

	const {
		mutate,
		isPending,
		error: fetchError,
	} = useMutation({
		mutationKey: ['validateApiKey', provider, debouncedValue],
		mutationFn: async ({ apiKey }: { apiKey: string }) => {
			if (provider === MetadataProvider.Metron) {
				const { validateMetadataProviderCredentials: result } = await validateOnServer({
					providerType: provider,
					apiToken: apiKey,
				})
				if (result.status === ProviderValidationStatus.Valid) {
					form.clearErrors('apiToken')
				} else {
					// The server owns the granular, human-readable message per status.
					form.setError('apiToken', { type: 'validate', message: result.message })
				}
				return
			}

			const validator = PROVIDER_VALIDATORS[provider]
			if (!validator) return

			const isValid = await validator(apiKey, t)
			if (!isValid) {
				form.setError('apiToken', {
					type: 'validate',
					message: t(getKey('apiToken.validationError')),
				})
			} else {
				form.clearErrors('apiToken')
			}
		},
	})

	const validateKey = useCallback(
		async (apiKey: string) => {
			if (isPending || !apiKey) return
			if (provider === MetadataProvider.Metron) {
				// Only validate once it looks like a full `username:password`, so idle
				// typing doesn't burn Metron's tight request budget (20/min).
				if (!apiKey.includes(':')) return
				mutate({ apiKey })
				return
			}
			const validator = PROVIDER_VALIDATORS[provider]
			if (!validator) return
			mutate({ apiKey })
		},
		[provider, mutate, isPending],
	)

	useEffect(
		() => {
			if (debouncedValue) {
				validateKey(debouncedValue)
			} else {
				form.clearErrors('apiToken')
			}
		},
		// eslint-disable-next-line react-compiler/react-compiler
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[debouncedValue],
	)

	const isMetron = provider === MetadataProvider.Metron

	return (
		<>
			<PasswordInput
				label={t(getKey('apiToken.label'))}
				// Note: Metron uses HTTP Basic auth (username + password), not a bearer token, so
				// it gets bespoke helper text here rather than the shared i18n copy. This is a
				// literal, not a new locale key (see Stream A's 'Libraries' precedent) — locale
				// files are Stream B's exclusive territory for this phase.
				description={
					isMetron
						? 'Metron username and password, entered as username:password'
						: t(getKey('apiToken.description'))
				}
				type="password"
				{...form.register('apiToken')}
				errorMessage={errors.apiToken?.message}
				fullWidth
			/>

			{isMetron && (
				<Text size="xs" variant="muted">
					Metadata provided by metron.cloud, CC BY-SA 4.0
				</Text>
			)}

			{fetchError && (
				<Alert variant="destructive">
					<AlertTriangleIcon />
					<AlertTitle>{t(getKey('apiToken.validationRequestError'))}</AlertTitle>
					<AlertDescription>
						{fetchError instanceof Error
							? fetchError.message
							: t(getKey('apiToken.validationRequestErrorUnknown'))}
					</AlertDescription>
				</Alert>
			)}
		</>
	)
}

const LOCALE_KEY = 'settingsScene.server/metadataIntegrations.providerForm'
const getKey = (key: string) => `${LOCALE_KEY}.${key}`

type Validator = (
	apiKey: string,
	t: (key: string, args?: Record<string, unknown>) => string,
) => Promise<boolean>

const validateHardcoverApiKey: Validator = async (apiKey, t) => {
	if (apiKey.startsWith('Bearer ')) {
		throw new Error(t(getKey('apiToken.noBearerPrefixRequired')))
	}

	const response = await fetch('https://api.hardcover.app/v1/graphql', {
		method: 'POST',
		body: JSON.stringify({
			query: `
          query {
            me {
              id
              username
            }
          }
        `,
		}),
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${apiKey}`,
		},
	})

	if (!response.ok) {
		throw new Error(t(getKey('apiToken.hardcoverStatusError'), { status: response.status }))
	}

	const data = await response.json()
	const firstError = getProperty(data, 'errors[0].message')
	if (firstError && typeof firstError === 'string') {
		throw new Error(t(getKey('apiToken.hardcoverValidationError'), { message: firstError }))
	}
	// hardcover `me` is an array for whatever reason
	return getProperty(data, 'data.me[0].id') != null
}

const PROVIDER_VALIDATORS: Record<MetadataProvider, Validator | null> = {
	HARDCOVER: validateHardcoverApiKey,
	// Metron has no client-side validator: metron.cloud provides no CORS, so a browser
	// request can't work. It's validated server-side instead (see `validateOnServer`
	// above, backed by the `validateMetadataProviderCredentials` mutation).
	METRON: null,
}
