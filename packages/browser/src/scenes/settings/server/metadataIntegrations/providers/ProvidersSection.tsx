import { useGraphQLMutation, useSuspenseGraphQL } from '@longbox/client'
import { Heading, Text } from '@longbox/components'
import { graphql } from '@longbox/graphql'
import { useLocaleContext } from '@longbox/i18n'
import { useQueryClient } from '@tanstack/react-query'
import { Suspense } from 'react'

import { PROVIDER_LABELS } from './constants'
import { CreateProviderDialog } from './CreateProviderDialog'
import { ExistingProviderCard } from './ExistingProviderCard'

const query = graphql(`
	query ProvidersSectionGetProviders {
		metadataProviderConfigs {
			id
			providerType
			position
			...ExistingProviderCard
		}
	}
`)

const setPreferredMutation = graphql(`
	mutation ProvidersSectionSetPreferred($id: Int!, $input: PatchMetadataProviderConfigInput!) {
		updateMetadataProvider(id: $id, input: $input) {
			id
			position
		}
	}
`)

function ProviderCards() {
	const {
		data: { metadataProviderConfigs: providers },
	} = useSuspenseGraphQL(query, ['metadataProviderConfigs'])
	const { t } = useLocaleContext()
	const client = useQueryClient()

	const { mutate: setPreferred, isPending } = useGraphQLMutation(setPreferredMutation, {
		onSuccess: async () => {
			await client.invalidateQueries({
				predicate: (q) =>
					q.queryKey.some((k) => typeof k === 'string' && k.includes('metadataProvider')),
			})
		},
	})

	if (providers.length === 0) {
		return (
			<div className="p-8 flex flex-col items-center justify-center rounded-lg border border-dashed border-border">
				<Text size="sm" variant="muted">
					{t('settingsScene.server/metadataIntegrations.noProviders')}
				</Text>
			</div>
		)
	}

	// Lowest `position` is the preferred provider (matches the backend tie-break).
	const preferredId = providers.reduce((best, p) => (p.position < best.position ? p : best)).id

	const onSelectPreferred = (id: number) => {
		if (id === preferredId) return
		// Patch the chosen provider strictly below all others so it becomes preferred,
		// without having to renumber the rest.
		const minPosition = Math.min(...providers.map((p) => p.position))
		setPreferred({ id, input: { position: minPosition - 1 } })
	}

	return (
		<div className="gap-4 flex flex-col">
			{providers.length > 1 && (
				<div className="gap-3 p-3 flex flex-wrap items-center justify-between rounded-lg border border-border bg-muted/50">
					<div>
						<Text size="sm" className="font-medium">
							Preferred provider
						</Text>
						<Text size="xs" variant="muted">
							Wins when more than one provider returns a confident match.
						</Text>
					</div>
					<select
						aria-label="Preferred metadata provider"
						className="px-2 py-1 text-sm rounded-md border border-border bg-muted text-foreground disabled:opacity-50"
						value={preferredId}
						disabled={isPending}
						onChange={(e) => onSelectPreferred(Number(e.target.value))}
					>
						{providers.map((p) => (
							<option key={p.id} value={p.id}>
								{PROVIDER_LABELS[p.providerType] ?? p.providerType}
							</option>
						))}
					</select>
				</div>
			)}

			<div className="gap-4 md:grid-cols-1 lg:grid-cols-2 grid grid-cols-1">
				{providers.map((provider) => (
					<ExistingProviderCard key={provider.id} data={provider} />
				))}
			</div>
		</div>
	)
}

export default function ProvidersSection() {
	const { t } = useLocaleContext()

	return (
		<div className="gap-4 flex flex-col">
			<div className="flex items-end justify-between">
				<div>
					<Heading size="sm">
						{t('settingsScene.server/metadataIntegrations.providers.title')}
					</Heading>
					<Text size="sm" variant="muted" className="mt-1">
						{t('settingsScene.server/metadataIntegrations.providers.description')}
					</Text>
				</div>

				<CreateProviderDialog />
			</div>

			<Suspense fallback={null}>
				<ProviderCards />
			</Suspense>
		</div>
	)
}
