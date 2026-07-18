# Metron Provider Validation UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the metadata-provider credential UI distinguish credential failures from connectivity/service failures, affirm success, and split Metron's `user:pass` field into a visible Username + a revealable Password.

**Architecture:** A single pure mapping (`metronStatusToFeedback`) classifies each `ProviderValidationStatus` into `{severity, asFieldError, title, description, hint?}`. One presentational component (`ProviderValidationFeedback`) renders that. Both the create/edit dialog input (`ProviderApiKeyInput`) and the saved-provider card (`ExistingProviderCard`) consume them, so the two conflating surfaces are fixed with shared code. The Metron input becomes two fields composed back to a single `apiToken` (`username:password`) — storage/wire shape unchanged.

**Tech Stack:** React 19 (+ babel-plugin-react-compiler), react-hook-form, @tanstack/react-query, gql.tada, jest 30 + @testing-library/react (jsdom), Tailwind 4, `@longbox/components`.

## Global Constraints

- Frontend-only. No Rust, no GraphQL schema, no `cargo dump-schema`, no codegen. CI gates that apply: `yarn lint` and `yarn test`.
- react-compiler is enforced (eslint-plugin-react-compiler): no mutating props/state, no conditional hooks; use `useState` (not `useRef`) for reactive state.
- Metron copy is added as **inline literals** (matching the existing pattern in `ProviderApiKeyInput.tsx`), not new i18n locale keys.
- Credential wire/DB shape is unchanged: Metron creds are composed to `username:password` and stored in the single `encrypted_api_token`. Backend parses with `split_once(':')` (first colon only) — usernames must be colon-free; passwords may contain colons.
- The field-error (red field) channel is reserved for `InvalidCredentials` alone. `Forbidden` is red **but as a callout, not a field error**.
- Exact base path for all new/edited web files: `packages/browser/src/scenes/settings/server/metadataIntegrations/providers/`.

---

### Task 1: Pure feedback mapping + token composer

**Files:**

- Create: `packages/browser/src/scenes/settings/server/metadataIntegrations/providers/providerValidationFeedback.ts`
- Test: `packages/browser/src/scenes/settings/server/metadataIntegrations/providers/__tests__/providerValidationFeedback.test.ts`

**Interfaces:**

- Consumes: `ProviderValidationStatus` from `@longbox/graphql`.
- Produces:
  - `type FeedbackSeverity = 'success' | 'warning' | 'error'`
  - `type Feedback = { severity: FeedbackSeverity; asFieldError: boolean; title: string; description: string; hint?: string }`
  - `function metronStatusToFeedback(status: ProviderValidationStatus, message: string): Feedback`
  - `function composeMetronToken(username: string, password: string): string`

- [ ] **Step 1: Write the failing test**

Create `packages/browser/src/scenes/settings/server/metadataIntegrations/providers/__tests__/providerValidationFeedback.test.ts`:

```ts
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
		const fb = metronStatusToFeedback(ProviderValidationStatus.NetworkError, "Couldn't reach metron.cloud.")
		expect(fb.severity).toBe('warning')
		expect(fb.asFieldError).toBe(false)
		expect(fb.hint).toMatch(/IP/i)
	})

	it('maps RateLimited and ProviderError to warnings', () => {
		expect(metronStatusToFeedback(ProviderValidationStatus.RateLimited, 'x').severity).toBe('warning')
		expect(metronStatusToFeedback(ProviderValidationStatus.ProviderError, 'x').severity).toBe('warning')
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn workspace @longbox/browser test providerValidationFeedback`
Expected: FAIL — `Cannot find module '../providerValidationFeedback'`.

- [ ] **Step 3: Write minimal implementation**

Create `packages/browser/src/scenes/settings/server/metadataIntegrations/providers/providerValidationFeedback.ts`:

```ts
import { ProviderValidationStatus } from '@longbox/graphql'

export type FeedbackSeverity = 'success' | 'warning' | 'error'

/**
 * A classified validation result for display. `asFieldError` is true ONLY for
 * InvalidCredentials — the sole status that means "your password is wrong" and the
 * only one allowed to redden the password field. Everything else renders as a
 * standalone callout (or a success line), so a connectivity/IP or service failure is
 * never mistaken for a bad password.
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn workspace @longbox/browser test providerValidationFeedback`
Expected: PASS (all cases green).

- [ ] **Step 5: Commit**

```bash
git add packages/browser/src/scenes/settings/server/metadataIntegrations/providers/providerValidationFeedback.ts \
        packages/browser/src/scenes/settings/server/metadataIntegrations/providers/__tests__/providerValidationFeedback.test.ts
git commit -m "feat(metadata-ui): status→feedback mapping + Metron token composer"
```

---

### Task 2: `ProviderValidationFeedback` presentational component

**Files:**

- Create: `packages/browser/src/scenes/settings/server/metadataIntegrations/providers/ProviderValidationFeedback.tsx`
- Test: `packages/browser/src/scenes/settings/server/metadataIntegrations/providers/__tests__/ProviderValidationFeedback.test.tsx`

**Interfaces:**

- Consumes: `Feedback` from `./providerValidationFeedback` (Task 1); `Alert`/`AlertDescription`/`AlertTitle`/`Text` from `@longbox/components`.
- Produces: `function ProviderValidationFeedback(props: { feedback: Feedback | null; isChecking?: boolean }): JSX.Element | null`.

- [ ] **Step 1: Write the failing test**

Create `packages/browser/src/scenes/settings/server/metadataIntegrations/providers/__tests__/ProviderValidationFeedback.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'

import { ProviderValidationFeedback } from '../ProviderValidationFeedback'

describe('ProviderValidationFeedback', () => {
	it('renders nothing when there is no feedback and not checking', () => {
		const { container } = render(<ProviderValidationFeedback feedback={null} />)
		expect(container).toBeEmptyDOMElement()
	})

	it('shows a checking indicator while validating', () => {
		render(<ProviderValidationFeedback feedback={null} isChecking />)
		expect(screen.getByText('Checking…')).toBeInTheDocument()
	})

	it('renders a success line with the title', () => {
		render(
			<ProviderValidationFeedback
				feedback={{ severity: 'success', asFieldError: false, title: 'Verified', description: 'ok' }}
			/>,
		)
		expect(screen.getByText('Verified')).toBeInTheDocument()
		expect(screen.queryByRole('alert')).not.toBeInTheDocument()
	})

	it('renders warnings as an alert with description and hint', () => {
		render(
			<ProviderValidationFeedback
				feedback={{
					severity: 'warning',
					asFieldError: false,
					title: "Couldn't reach Metron",
					description: 'msg',
					hint: 'connectivity hint',
				}}
			/>,
		)
		expect(screen.getByRole('alert')).toBeInTheDocument()
		expect(screen.getByText("Couldn't reach Metron")).toBeInTheDocument()
		expect(screen.getByText('connectivity hint')).toBeInTheDocument()
	})

	it('renders error severity as an alert', () => {
		render(
			<ProviderValidationFeedback
				feedback={{ severity: 'error', asFieldError: false, title: 'Access denied', description: 'm' }}
			/>,
		)
		expect(screen.getByRole('alert')).toBeInTheDocument()
		expect(screen.getByText('Access denied')).toBeInTheDocument()
	})
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn workspace @longbox/browser test ProviderValidationFeedback`
Expected: FAIL — `Cannot find module '../ProviderValidationFeedback'`.

- [ ] **Step 3: Write minimal implementation**

Create `packages/browser/src/scenes/settings/server/metadataIntegrations/providers/ProviderValidationFeedback.tsx`:

```tsx
import { Alert, AlertDescription, AlertTitle, Text } from '@longbox/components'
import { AlertTriangle, Check, ShieldAlert } from 'lucide-react'

import type { Feedback } from './providerValidationFeedback'

type Props = {
	feedback: Feedback | null
	isChecking?: boolean
}

/**
 * Renders a classified validation result. Success is a compact green line; warning and
 * error render as an Alert (amber / destructive). The caller decides whether an
 * InvalidCredentials result should instead redden the field (via `feedback.asFieldError`)
 * — this component only draws what it is given.
 */
export function ProviderValidationFeedback({ feedback, isChecking }: Props) {
	if (isChecking) {
		return (
			<Text size="xs" variant="muted">
				Checking…
			</Text>
		)
	}

	if (!feedback) return null

	if (feedback.severity === 'success') {
		return (
			<div className="flex items-center gap-1.5 text-success">
				<Check className="h-4 w-4" />
				<Text size="sm" className="text-success">
					{feedback.title}
				</Text>
			</div>
		)
	}

	const isError = feedback.severity === 'error'

	return (
		<Alert variant={isError ? 'destructive' : 'warning'}>
			{isError ? <ShieldAlert /> : <AlertTriangle />}
			<AlertTitle>{feedback.title}</AlertTitle>
			<AlertDescription>
				<span>{feedback.description}</span>
				{feedback.hint && <span className="text-muted-foreground">{feedback.hint}</span>}
			</AlertDescription>
		</Alert>
	)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn workspace @longbox/browser test ProviderValidationFeedback`
Expected: PASS.

(If `toBeInTheDocument` is undefined, confirm `packages/browser/jest.setup.ts` imports `@testing-library/jest-dom`; it is listed in `packages/browser/package.json` devDeps. Do not add a second setup.)

- [ ] **Step 5: Commit**

```bash
git add packages/browser/src/scenes/settings/server/metadataIntegrations/providers/ProviderValidationFeedback.tsx \
        packages/browser/src/scenes/settings/server/metadataIntegrations/providers/__tests__/ProviderValidationFeedback.test.tsx
git commit -m "feat(metadata-ui): ProviderValidationFeedback component"
```

---

### Task 3: Wire the dialog input — split fields + status-aware feedback

**Files:**

- Modify (full rewrite): `packages/browser/src/scenes/settings/server/metadataIntegrations/providers/ProviderApiKeyInput.tsx`
- Test: `packages/browser/src/scenes/settings/server/metadataIntegrations/providers/__tests__/ProviderApiKeyInput.test.tsx`

**Interfaces:**

- Consumes: `metronStatusToFeedback`, `composeMetronToken`, `Feedback` (Task 1); `ProviderValidationFeedback` (Task 2); existing `CreateProviderConfigSchema` from `./schema`.
- Produces: default-exported nothing new; component behavior — for Metron renders a `Metron username` (visible `Input`) + `Metron password` (`PasswordInput`, has built-in reveal) that compose `apiToken`; routes validation results by `asFieldError`.

- [ ] **Step 1: Write the failing test**

Create `packages/browser/src/scenes/settings/server/metadataIntegrations/providers/__tests__/ProviderApiKeyInput.test.tsx`. This renders the component inside a real `react-hook-form` provider and a react-query provider, and asserts the Metron split renders two labelled fields (username visible, password masked) and composes `apiToken`. The validation mutation is not triggered here (no `:`-complete value typed synchronously); the status→feedback logic is already covered in Task 1.

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MetadataProvider } from '@longbox/graphql'
import { FormProvider, useForm } from 'react-hook-form'

import { ProviderApiKeyInput } from '../ProviderApiKeyInput'

function Harness({ provider }: { provider: MetadataProvider }) {
	const form = useForm({
		defaultValues: {
			providerType: provider,
			enabled: true,
			apiToken: '',
			apiTokenExpiresAt: null,
			autoApplyConfig: { enabled: false, threshold: 0.95, strategy: 'FILL_GAPS', excludeFields: [] },
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn workspace @longbox/browser test ProviderApiKeyInput`
Expected: FAIL — current component renders one field and no `Metron username` label (getByLabelText throws).

- [ ] **Step 3: Write the implementation (full file replacement)**

Replace the entire contents of `packages/browser/src/scenes/settings/server/metadataIntegrations/providers/ProviderApiKeyInput.tsx` with:

```tsx
import { useGraphQLMutation } from '@longbox/client'
import { Alert, AlertDescription, AlertTitle, Input, PasswordInput, Text } from '@longbox/components'
import { graphql, MetadataProvider, ProviderValidationStatus } from '@longbox/graphql'
import { useLocaleContext } from '@longbox/i18n'
import { useMutation } from '@tanstack/react-query'
import getProperty from 'lodash/get'
import { AlertTriangleIcon } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useFormContext, useFormState, useWatch } from 'react-hook-form'
import { useDebouncedValue } from 'rooks'

import {
	composeMetronToken,
	type Feedback,
	metronStatusToFeedback,
} from './providerValidationFeedback'
import { ProviderValidationFeedback } from './ProviderValidationFeedback'
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
	const isMetron = provider === MetadataProvider.Metron

	// Metron-only local field state; `apiToken` is composed from these. Not pre-seeded —
	// the server never returns stored credentials, so both start empty.
	const [username, setUsername] = useState('')
	const [password, setPassword] = useState('')

	const [feedback, setFeedback] = useState<Feedback | null>(null)

	const [debouncedValue] = useDebouncedValue(value, 500)

	// Metron has no CORS, so it can't be validated from the browser. Instead we ask our
	// server to make the authenticated request (with a proper non-browser User-Agent) and
	// report a granular status back.
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
				const fb = metronStatusToFeedback(result.status, result.message)
				if (fb.asFieldError) {
					// Only a real 401 reddens the field.
					setFeedback(null)
					form.setError('apiToken', { type: 'validate', message: fb.description })
				} else {
					// Success / connectivity / rate-limit / service → callout, field stays clean.
					form.clearErrors('apiToken')
					setFeedback(fb)
				}
				return
			}

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
				setFeedback({ severity: 'success', asFieldError: false, title: 'Verified', description: '' })
			}
		},
	})

	const validateKey = useCallback(
		async (apiKey: string) => {
			if (isPending || !apiKey) return
			if (provider === MetadataProvider.Metron) {
				// Only validate once BOTH username and password are present, so idle typing
				// doesn't burn Metron's tight request budget (20/min).
				const colon = apiKey.indexOf(':')
				const u = colon === -1 ? apiKey : apiKey.slice(0, colon)
				const p = colon === -1 ? '' : apiKey.slice(colon + 1)
				if (!u.trim() || !p.trim()) return
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
						label="Metron username"
						description="Your metron.cloud account username"
						type="text"
						autoComplete="off"
						value={username}
						onChange={(e) => handleUsernameChange(e.target.value)}
						fullWidth
					/>
					<PasswordInput
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
	// Metron has no client-side validator: metron.cloud provides no CORS, so a browser
	// request can't work. It's validated server-side instead (see `validateOnServer`
	// above, backed by the `validateMetadataProviderCredentials` mutation).
	METRON: null,
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn workspace @longbox/browser test ProviderApiKeyInput`
Expected: PASS (two Metron fields; apiToken composes to `rogue:pw`; single field for Hardcover).

- [ ] **Step 5: Commit**

```bash
git add packages/browser/src/scenes/settings/server/metadataIntegrations/providers/ProviderApiKeyInput.tsx \
        packages/browser/src/scenes/settings/server/metadataIntegrations/providers/__tests__/ProviderApiKeyInput.test.tsx
git commit -m "feat(metadata-ui): split Metron user/password + status-aware validation feedback"
```

---

### Task 4: Fix the saved-provider card's Test result

**Files:**

- Modify: `packages/browser/src/scenes/settings/server/metadataIntegrations/providers/ExistingProviderCard.tsx:128-139` (the `testResult` block) and its imports.

**Interfaces:**

- Consumes: `metronStatusToFeedback` (Task 1), `ProviderValidationFeedback` (Task 2). No new produced interface.

- [ ] **Step 1: Replace the binary red/green result with the shared feedback**

In `ExistingProviderCard.tsx`, replace the import line 7-10 block's use of `ProviderValidationStatus` — remove `ProviderValidationStatus` from the `@longbox/graphql` import (it becomes unused) — and add the two new imports. Concretely:

Change the `@longbox/graphql` import from:

```tsx
import {
	FragmentType,
	graphql,
	MetadataProvider,
	ProviderValidationStatus,
	useFragment,
	UserPermission,
} from '@longbox/graphql'
```

to:

```tsx
import { FragmentType, graphql, MetadataProvider, useFragment, UserPermission } from '@longbox/graphql'
```

Add these imports (alongside the existing local imports near `./constants`):

```tsx
import { metronStatusToFeedback } from './providerValidationFeedback'
import { ProviderValidationFeedback } from './ProviderValidationFeedback'
```

Replace the `testResult` render block (currently lines 128-139):

```tsx
{testResult && (
	<Text
		size="xs"
		className={
			testResult.status === ProviderValidationStatus.Valid
				? 'text-success'
				: 'text-destructive'
		}
	>
		{testResult.message}
	</Text>
)}
```

with:

```tsx
{testResult && (
	<ProviderValidationFeedback
		feedback={metronStatusToFeedback(testResult.status, testResult.message)}
	/>
)}
```

- [ ] **Step 2: Type-check and lint the change**

Run: `yarn workspace @longbox/browser run check-types`
Expected: PASS (no unused `ProviderValidationStatus`, `Text` still used elsewhere in the file so its import stays).

Run: `yarn lint`
Expected: PASS (no unused imports, no react-compiler violations).

- [ ] **Step 3: Commit**

```bash
git add packages/browser/src/scenes/settings/server/metadataIntegrations/providers/ExistingProviderCard.tsx
git commit -m "fix(metadata-ui): saved-provider Test no longer shows connectivity errors as red"
```

---

### Task 5: Full frontend gate + in-app verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full frontend CI gates locally**

Run: `yarn lint`
Expected: PASS (eslint + prettier + check-types across the workspace).

Run: `yarn test`
Expected: PASS — including the three new test files.

- [ ] **Step 2: Verify in the running app (see the `longbox-live-verify-setup` memory)**

Build the web dist, start the server, log in, and open Settings → Metadata Integrations:

- Add-provider dialog for Metron shows **two** fields; the password field's eye toggle reveals the text.
- With a deliberately wrong password on a reachable network, the **password field** goes red ("Invalid credentials").
- On a box whose IP can't reach Metron (or with network blocked), the result is an **amber** "Couldn't reach Metron" callout — the field is **not** red.
- The saved-provider card's **Test** button shows the same amber/red/green treatment, not a blanket red.

- [ ] **Step 3: Commit (if any verification-driven fixes were needed)**

```bash
git add -A
git commit -m "test(metadata-ui): verified provider validation feedback end-to-end"
```

---

## Self-Review

**Spec coverage:**

- Validation feedback mapping (§ Status → treatment mapping) → Task 1.
- `Forbidden` red-but-not-field-error → Task 1 (`severity: 'error'`, `asFieldError: false`) + test.
- Presentational component / severity→variant → Task 2.
- Field-error reserved for InvalidCredentials → Task 1 invariant test + Task 3 routing.
- Username/password split + reveal + compose (lossless colons) → Task 3 + Task 1 `composeMetronToken`.
- Both surfaces (dialog + saved card) → Task 3 + Task 4.
- Shared success state (Metron + Hardcover) → Task 3 (Hardcover success branch) + Task 1 Valid mapping.
- Frontend-only, lint/test gates → Task 5.

**Placeholder scan:** none — every step has full code or an exact command with expected output.

**Type consistency:** `Feedback` / `FeedbackSeverity` / `metronStatusToFeedback` / `composeMetronToken` names and signatures are identical across Tasks 1–4. `ProviderValidationFeedback` prop shape `{ feedback, isChecking? }` matches every call site. `ProviderValidationStatus` enum members used (`Valid`, `InvalidCredentials`, `Forbidden`, `NetworkError`, `RateLimited`, `ProviderError`, `Unsupported`) match the generated enum already imported by existing code.
