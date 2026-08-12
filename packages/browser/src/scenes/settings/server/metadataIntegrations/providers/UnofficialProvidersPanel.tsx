import { useGraphQLMutation, useSuspenseGraphQL } from '@longbox/client'
import { Button, Card, Text } from '@longbox/components'
import { graphql } from '@longbox/graphql'
import { useQueryClient } from '@tanstack/react-query'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { useState } from 'react'

export const unofficialAcknowledgedQuery = graphql(`
	query UnofficialProvidersAcknowledged {
		serverConfig {
			id
			unofficialProvidersAcknowledgedAt
		}
	}
`)

const setAcknowledgedMutation = graphql(`
	mutation UnofficialProvidersSetAcknowledged($acknowledged: Boolean!) {
		setUnofficialProvidersAcknowledged(acknowledged: $acknowledged) {
			id
			unofficialProvidersAcknowledgedAt
		}
	}
`)

/**
 * Whether the server owner has accepted the terms of using unofficial providers.
 *
 * Suspense-based, so callers must render inside a `<Suspense>` boundary.
 */
export function useUnofficialProvidersAcknowledged(): boolean {
	const {
		data: { serverConfig },
	} = useSuspenseGraphQL(unofficialAcknowledgedQuery, ['serverConfig', 'unofficialProviders'])
	return !!serverConfig.unofficialProvidersAcknowledgedAt
}

/**
 * Collapsed disclosure + acknowledgement for metadata providers that have no official
 * API.
 *
 * Until this is acknowledged, those providers are **absent** from the add-provider
 * list rather than shown disabled — the point is that the operator opts in
 * deliberately, having read what they are opting into. Stored as a timestamp so the
 * acceptance is auditable and can be withdrawn.
 */
export function UnofficialProvidersPanel() {
	const [isExpanded, setIsExpanded] = useState(false)
	const client = useQueryClient()

	const {
		data: { serverConfig },
	} = useSuspenseGraphQL(unofficialAcknowledgedQuery, ['serverConfig', 'unofficialProviders'])
	const acknowledgedAt = serverConfig.unofficialProvidersAcknowledgedAt

	const { mutate, isPending } = useGraphQLMutation(setAcknowledgedMutation, {
		onSuccess: async () => {
			await client.invalidateQueries({
				predicate: (q) =>
					q.queryKey.some(
						(k) =>
							typeof k === 'string' && (k.includes('serverConfig') || k.includes('unofficial')),
					),
			})
		},
	})

	const Chevron = isExpanded ? ChevronDown : ChevronRight

	return (
		<Card className="p-4 flex flex-col">
			<button
				type="button"
				aria-expanded={isExpanded}
				onClick={() => setIsExpanded((prev) => !prev)}
				className="gap-2 flex items-center text-left"
			>
				<Chevron className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
				<div className="flex-1">
					<Text size="sm" className="font-medium">
						Unofficial integrations
					</Text>
					<Text size="xs" variant="muted">
						{acknowledgedAt
							? `Acknowledged ${new Date(acknowledgedAt).toLocaleDateString()} — League of Comic Geeks can be added below.`
							: 'One provider is hidden until you read and accept how it works.'}
					</Text>
				</div>
			</button>

			{isExpanded && (
				<div className="gap-3 mt-4 pt-4 flex flex-col border-t border-border">
					<Text size="sm" variant="muted">
						<strong className="text-foreground">League of Comic Geeks has no public API.</strong>{' '}
						Longbox reads it by signing in to the site with an account you provide and requesting
						the same pages your browser would.
					</Text>
					<Text size="sm" variant="muted">
						Their terms of use prohibit automated access. If you enable this, the requests are made
						with <strong className="text-foreground">your</strong> account and are attributable to
						you — you are acting as yourself, not as Longbox, and you accept the consequences of
						that, up to and including losing your account.
					</Text>
					<Text size="sm" variant="muted">
						Use your own personal account. Requests are paced conservatively, but there is no rate
						limit published for us to respect, so nothing here can guarantee you stay within what
						they consider acceptable.
					</Text>

					<div className="gap-2 mt-1 flex flex-wrap items-center">
						{acknowledgedAt ? (
							<>
								<Button
									variant="outline"
									size="sm"
									disabled={isPending}
									isLoading={isPending}
									onClick={() => mutate({ acknowledged: false })}
								>
									Withdraw acknowledgement
								</Button>
								<Text size="xs" variant="muted">
									Hides these providers again. Any you already configured are left alone.
								</Text>
							</>
						) : (
							<>
								<Button
									variant="default"
									size="sm"
									disabled={isPending}
									isLoading={isPending}
									onClick={() => mutate({ acknowledged: true })}
								>
									I understand — show unofficial providers
								</Button>
								<Text size="xs" variant="muted">
									Recorded with a timestamp on the server.
								</Text>
							</>
						)}
					</div>
				</div>
			)}
		</Card>
	)
}
