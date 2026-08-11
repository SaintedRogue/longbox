import { useGraphQLMutation } from '@longbox/client'
import { RawSwitch, ToolTip } from '@longbox/components'
import { graphql, MetadataProvider } from '@longbox/graphql'
import { useLocaleContext } from '@longbox/i18n'
import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useState } from 'react'
import { toast } from 'sonner'

import { PROVIDER_LABELS } from './constants'

/*
 * `PatchMetadataProviderConfigInput` is all-optional, so flipping `enabled` on its own is a
 * real patch rather than a round-trip through the whole form -- nothing else on the config
 * is read or rewritten.
 */
const mutation = graphql(`
	mutation ToggleProviderEnabled($id: Int!, $enabled: Boolean!) {
		updateMetadataProvider(id: $id, input: { enabled: $enabled }) {
			id
			enabled
		}
	}
`)

type Props = {
	id: number
	provider: MetadataProvider
	enabled: boolean
}

/**
 * Turns a saved provider on or off from its card.
 *
 * Enabling and disabling is the one provider setting worth changing on a whim -- a provider
 * is rate-limited, or down, or returning bad matches, and you want it out of the rotation
 * for now without touching its credentials. That previously meant opening the edit dialog,
 * finding the toggle among the API-token fields, and saving a form.
 */
export function ProviderEnabledSwitch({ id, provider, enabled }: Props) {
	const { t } = useLocaleContext()
	const client = useQueryClient()

	/*
	 * Held locally so the switch moves on click rather than after the round trip. Cleared
	 * only once the refetch has landed, otherwise the switch would snap back to the stale
	 * cached value for the gap between the mutation resolving and the list catching up.
	 */
	const [optimistic, setOptimistic] = useState<boolean | null>(null)
	const checked = optimistic ?? enabled

	const { mutate, isPending } = useGraphQLMutation(mutation, {
		onSuccess: async () => {
			await client.invalidateQueries({
				predicate: (q) =>
					q.queryKey.some((k) => typeof k === 'string' && k.includes('metadataProvider')),
			})
			setOptimistic(null)
		},
		onError: (error) => {
			setOptimistic(null)
			toast.error(`Failed to update ${PROVIDER_LABELS[provider] ?? provider}`, {
				description: error instanceof Error ? error.message : undefined,
			})
		},
	})

	const onCheckedChange = useCallback(
		(next: boolean) => {
			setOptimistic(next)
			mutate({ id, enabled: next })
		},
		[id, mutate],
	)

	const label = t(checked ? getKey('providerEnabled') : getKey('providerDisabled'))

	return (
		<ToolTip content={label} align="end" size="xs">
			<RawSwitch
				checked={checked}
				onCheckedChange={onCheckedChange}
				disabled={isPending}
				aria-label={label}
			/>
		</ToolTip>
	)
}

const LOCALE_KEY = 'settingsScene.server/metadataIntegrations'
const getKey = (key: string) => `${LOCALE_KEY}.${key}`
