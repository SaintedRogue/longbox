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
			<div className="gap-1.5 flex items-center text-success">
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
