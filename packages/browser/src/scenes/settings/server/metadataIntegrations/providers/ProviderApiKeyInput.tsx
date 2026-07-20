import {
	Alert,
	AlertDescription,
	AlertTitle,
	Input,
	PasswordInput,
	Text,
} from '@longbox/components'
import { MetadataProvider } from '@longbox/graphql'
import { useLocaleContext } from '@longbox/i18n'
import { useMutation } from '@tanstack/react-query'
import getProperty from 'lodash/get'
import { AlertTriangleIcon } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useFormContext, useFormState, useWatch } from 'react-hook-form'
import { useDebouncedValue } from 'rooks'

import { ProviderValidationFeedback } from './ProviderValidationFeedback'
import { composeMetronToken, type Feedback } from './providerValidationFeedback'
import { CreateProviderConfigSchema } from './schema'

export function ProviderApiKeyInput() {
	const form = useFormContext<CreateProviderConfigSchema>()
	const { t } = useLocaleContext()
	const { errors } = useFormState({ control: form.control })

	const [provider, value] = useWatch({
		control: form.control,
		name: ['providerType', 'apiToken'],
	})
	const isMetron = provider === MetadataProvider.Metron

	// Metron-only local field state; `apiToken` is composed from these. Not pre-seeded —
	// the server never returns stored credentials, so both start empty.
	const [username, setUsername] = useState('')
	const [password, setPassword] = useState('')

	const [feedback, setFeedback] = useState<Feedback | null>(null)

	const [debouncedValue] = useDebouncedValue(value, 500)

	const {
		mutate,
		isPending,
		error: fetchError,
	} = useMutation({
		mutationKey: ['validateApiKey', provider, debouncedValue],
		mutationFn: async ({ apiKey }: { apiKey: string }) => {
			const validator = PROVIDER_VALIDATORS[provider]
			if (!validator) return

			const isValid = await validator(apiKey, t)
			if (!isValid) {
				setFeedback(null)
				form.setError('apiToken', {
					type: 'validate',
					message: t(getKey('apiToken.validationError')),
				})
			} else {
				form.clearErrors('apiToken')
				setFeedback({
					severity: 'success',
					asFieldError: false,
					title: 'Verified',
					description: '',
				})
			}
		},
	})

	const validateKey = useCallback(
		async (apiKey: string) => {
			if (isPending || !apiKey) return
			// Metron is intentionally never validated in-app (its gateway bans probes);
			// its validator is null, so this is a no-op for Metron.
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
				setFeedback(null)
			}
		},
		// eslint-disable-next-line react-compiler/react-compiler
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[debouncedValue],
	)

	const handleUsernameChange = (next: string) => {
		setUsername(next)
		setFeedback(null)
		form.setValue('apiToken', composeMetronToken(next, password), {
			shouldValidate: true,
			shouldDirty: true,
		})
	}

	const handlePasswordChange = (next: string) => {
		setPassword(next)
		setFeedback(null)
		form.setValue('apiToken', composeMetronToken(username, next), {
			shouldValidate: true,
			shouldDirty: true,
		})
	}

	return (
		<>
			{isMetron ? (
				<>
					<Input
						id="metron-username"
						label="Metron username"
						description="Your metron.cloud account username"
						type="text"
						autoComplete="off"
						value={username}
						onChange={(e) => handleUsernameChange(e.target.value)}
						fullWidth
					/>
					<PasswordInput
						id="metron-password"
						label="Metron password"
						value={password}
						onChange={(e) => handlePasswordChange(e.target.value)}
						errorMessage={errors.apiToken?.message}
						fullWidth
					/>
					<Text size="xs" variant="muted">
						Enter your metron.cloud username and password. Metadata provided by metron.cloud, CC
						BY-SA 4.0
					</Text>
					<Text size="xs" variant="muted">
						Credentials aren&apos;t validated in-app — save them, then verify manually.
					</Text>
				</>
			) : (
				<PasswordInput
					label={t(getKey('apiToken.label'))}
					description={t(getKey('apiToken.description'))}
					type="password"
					{...form.register('apiToken')}
					errorMessage={errors.apiToken?.message}
					fullWidth
				/>
			)}

			<ProviderValidationFeedback feedback={feedback} isChecking={isPending} />

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
	// Metron is intentionally NOT validated in-app: its gateway hands out 24h bans to
	// clients that probe it, so we never contact it for credential checks. Verify Metron
	// credentials manually. (The server also refuses to validate Metron — belt and braces.)
	METRON: null,
	// ComicVine also validates server-side (no browser-friendly CORS endpoint for the
	// api_key check); see the provider's `validate_credentials`.
	COMIC_VINE: null,
}
