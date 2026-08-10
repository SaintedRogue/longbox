import { useGraphQLMutation } from '@longbox/client'
import { Button } from '@longbox/components'
import { graphql, MetadataProvider } from '@longbox/graphql'
import { PlugZap } from 'lucide-react'
import { useCallback, useState } from 'react'

import { PROVIDER_LABELS } from './constants'
import { ProviderValidationFeedback } from './ProviderValidationFeedback'
import { type Feedback, validationStatusToFeedback } from './providerValidationFeedback'

const testProviderMutation = graphql(`
	mutation TestMetadataProvider($id: Int!) {
		testMetadataProvider(id: $id) {
			status
			message
		}
	}
`)

type Props = {
	id: number
	provider: MetadataProvider
}

/**
 * Runs a live credential check against a saved provider config.
 *
 * Deliberately click-only. An earlier version of this feature validated on every
 * debounced keystroke in the create/edit form, which turned typing a password into
 * a burst of authenticated requests and got the whole capability removed for Metron
 * (see `run_validation` in the graphql crate). One click is one request, against
 * allowances measured in thousands per day — the problem was never the button.
 *
 * The result is rendered through `ProviderValidationFeedback` rather than a toast,
 * because these seven statuses are not interchangeable: "your password is wrong"
 * and "this server's IP is blocked" demand completely different fixes, and
 * collapsing them into pass/fail is exactly what made a blocked IP look like a bad
 * password in production.
 */
export function TestProviderButton({ id, provider }: Props) {
	const [feedback, setFeedback] = useState<Feedback | null>(null)
	const providerLabel = PROVIDER_LABELS[provider] ?? provider

	const { mutate, isPending } = useGraphQLMutation(testProviderMutation, {
		onError: (error) =>
			setFeedback({
				severity: 'error',
				asFieldError: false,
				title: 'Test failed',
				description: String(error),
			}),
		onSuccess: ({ testMetadataProvider: result }) =>
			setFeedback(validationStatusToFeedback(result.status, result.message, providerLabel)),
	})

	const onTest = useCallback(() => {
		// Clear the previous verdict first: leaving a stale "Verified" on screen while a
		// re-test runs would be actively misleading.
		setFeedback(null)
		mutate({ id })
	}, [mutate, id])

	return (
		<div className="gap-2 flex flex-col">
			<Button
				variant="secondary"
				size="sm"
				onClick={onTest}
				disabled={isPending}
				isLoading={isPending}
				className="self-start"
				aria-label={`Test connection to ${providerLabel}`}
			>
				{!isPending && <PlugZap className="mr-2 h-4 w-4" />}
				Test connection
			</Button>

			{/* aria-live so the verdict is announced rather than silently appearing. */}
			<div aria-live="polite">
				<ProviderValidationFeedback feedback={feedback} isChecking={isPending} />
			</div>
		</div>
	)
}
