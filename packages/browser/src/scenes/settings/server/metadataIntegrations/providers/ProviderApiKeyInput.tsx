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

type Props = {
	/**
	 * Whether a credential is already stored for this provider, i.e. we are editing rather
	 * than creating. The server never sends the token back, so an empty field means
	 * "unchanged" and has to say so -- otherwise it reads as "no credential set".
	 */
	hasStoredCredential?: boolean
}

export function ProviderApiKeyInput({ hasStoredCredential = false }: Props) {
	const form = useFormContext<CreateProviderConfigSchema>()
	const { t } = useLocaleContext()
	const { errors } = useFormState({ control: form.control })

	const [provider, value] = useWatch({
		control: form.control,
		name: ['providerType', 'apiToken'],
	})
	const isMetron = provider === MetadataProvider.Metron
	const isLocg = provider === MetadataProvider.Locg
	// Both Metron and LOCG pack `username:password` into the single apiToken field, so
	// both get the credential-pair UI rather than a token box.
	const usesCredentialPair = isMetron || isLocg
	const copy = usesCredentialPair ? CREDENTIAL_PAIR_COPY[isLocg ? 'LOCG' : 'METRON'] : null

	// Local field state for the credential pair; `apiToken` is composed from these. Not
	// pre-seeded — the server never returns stored credentials, so both start empty.
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
			{usesCredentialPair && copy ? (
				<>
					<Input
						id={`${copy.idPrefix}-username`}
						label={copy.usernameLabel}
						description={copy.usernameDescription}
						type="text"
						autoComplete="off"
						value={username}
						onChange={(e) => handleUsernameChange(e.target.value)}
						fullWidth
					/>
					<PasswordInput
						id={`${copy.idPrefix}-password`}
						label={copy.passwordLabel}
						value={password}
						onChange={(e) => handlePasswordChange(e.target.value)}
						errorMessage={errors.apiToken?.message}
						fullWidth
					/>
					<Text size="xs" variant="muted">
						{copy.attribution}
					</Text>
					<Text size="xs" variant="muted">
						{copy.validationHint}
					</Text>
					{hasStoredCredential && (
						<Text size="xs" variant="muted">
							Credentials are already saved. Leave both fields blank to keep them.
						</Text>
					)}
				</>
			) : (
				<PasswordInput
					label={t(getKey('apiToken.label'))}
					description={
						hasStoredCredential
							? 'A key is already saved. Leave this blank to keep it, or enter a new one to replace it.'
							: t(getKey('apiToken.description'))
					}
					placeholder={hasStoredCredential ? '••••••••••••' : undefined}
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

/**
 * Per-provider copy for the two providers that authenticate with a credential pair
 * packed into the single `apiToken` column.
 */
const CREDENTIAL_PAIR_COPY = {
	METRON: {
		idPrefix: 'metron',
		usernameLabel: 'Metron username',
		usernameDescription: 'Your metron.cloud account username',
		passwordLabel: 'Metron password',
		attribution:
			'Enter your metron.cloud username and password. Metadata provided by metron.cloud, CC BY-SA 4.0',
		validationHint: "Credentials aren't validated in-app — save them, then verify manually.",
	},
	LOCG: {
		idPrefix: 'locg',
		usernameLabel: 'League of Comic Geeks username',
		usernameDescription: 'Your own leagueofcomicgeeks.com account',
		passwordLabel: 'League of Comic Geeks password',
		attribution:
			'Longbox signs in as you to read League of Comic Geeks, which has no public API. Requests are made with your account and are subject to their terms of use.',
		validationHint:
			'Use the Test button after saving — the check runs on the server, never from your browser.',
	},
} as const

const PROVIDER_VALIDATORS: Record<MetadataProvider, Validator | null> = {
	HARDCOVER: validateHardcoverApiKey,
	// Metron is intentionally NOT validated in-app: its gateway hands out 24h bans to
	// clients that probe it, so we never contact it for credential checks. Verify Metron
	// credentials manually. (The server also refuses to validate Metron — belt and braces.)
	METRON: null,
	// ComicVine also validates server-side (no browser-friendly CORS endpoint for the
	// api_key check); see the provider's `validate_credentials`.
	COMIC_VINE: null,
	// League of Comic Geeks sends no CORS headers at all, and its credential check is a
	// login POST — the browser must never make it. Validated server-side via the Test
	// button (see the provider's `validate_credentials`).
	LOCG: null,
}
