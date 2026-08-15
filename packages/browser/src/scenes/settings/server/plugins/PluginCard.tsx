import { useGraphQLMutation } from '@longbox/client'
import { Badge, Button, ConfirmationModal, RawSwitch, Text } from '@longbox/components'
import { graphql, PluginListPluginsQuery } from '@longbox/graphql'
import { useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { CAPABILITY_LABELS, PLUGINS_QUERY_KEY } from './constants'
import PluginConfigForm from './PluginConfigForm'

export type PluginRow = PluginListPluginsQuery['plugins'][number]

const updateMutation = graphql(`
	mutation PluginCardUpdate($id: Int!, $input: PatchPluginInput!) {
		updatePlugin(id: $id, input: $input) {
			plugin {
				id
				enabled
			}
		}
	}
`)

const deleteMutation = graphql(`
	mutation PluginCardDelete($id: Int!) {
		deletePlugin(id: $id)
	}
`)

const refreshMutation = graphql(`
	mutation PluginCardRefresh($id: Int!) {
		refreshPluginManifest(id: $id) {
			id
			name
		}
	}
`)

const testMutation = graphql(`
	mutation PluginCardTest($id: Int!) {
		testPlugin(id: $id) {
			ok
			detail
		}
	}
`)

export default function PluginCard({ plugin }: { plugin: PluginRow }) {
	const client = useQueryClient()
	const [confirmingDelete, setConfirmingDelete] = useState(false)

	const invalidate = () => client.invalidateQueries({ queryKey: PLUGINS_QUERY_KEY })

	const { mutate: update, isPending: isUpdating } = useGraphQLMutation(updateMutation, {
		onSuccess: invalidate,
		onError: (error) => toast.error('Could not update plugin', { description: String(error) }),
	})

	const { mutate: remove } = useGraphQLMutation(deleteMutation, {
		onSuccess: () => {
			setConfirmingDelete(false)
			toast.success(`Removed ${plugin.name}`)
			invalidate()
		},
	})

	const { mutate: refresh, isPending: isRefreshing } = useGraphQLMutation(refreshMutation, {
		onSuccess: () => {
			toast.success('Manifest refreshed')
			invalidate()
		},
		onError: (error) => toast.error('Handshake failed', { description: String(error) }),
	})

	const { mutate: test, isPending: isTesting } = useGraphQLMutation(testMutation, {
		onSuccess: (data) => {
			const { ok, detail } = data.testPlugin
			if (ok) {
				toast.success(`${plugin.name} is healthy`, { description: detail ?? undefined })
			} else {
				toast.error(`${plugin.name} is not healthy`, { description: detail ?? undefined })
			}
			invalidate()
		},
		onError: invalidate,
	})

	// A plugin with no usable manifest cannot be configured or called, so enabling it
	// would be a promise Longbox cannot keep. Refreshing the handshake is the way out.
	const canEnable = plugin.isAddressable && plugin.capabilities.length > 0

	return (
		<div className="gap-4 p-4 flex flex-col rounded-lg border border-border bg-card">
			<div className="gap-4 flex flex-wrap items-start justify-between">
				<div className="gap-1 min-w-0 flex flex-col">
					<div className="gap-2 flex flex-wrap items-center">
						<Text className="font-medium">{plugin.name}</Text>
						{plugin.version && (
							<Text size="xs" variant="muted">
								v{plugin.version}
							</Text>
						)}
						<Badge size="xs" variant="default">
							{plugin.slug}
						</Badge>
					</div>

					{plugin.description && (
						<Text size="sm" variant="muted" className="max-w-xl">
							{plugin.description}
						</Text>
					)}

					<Text size="xs" variant="muted" className="break-all">
						{plugin.baseUrl}
					</Text>
				</div>

				<div className="gap-2 flex shrink-0 items-center">
					<Text size="sm" variant="muted">
						{plugin.enabled ? 'Enabled' : 'Disabled'}
					</Text>
					<RawSwitch
						checked={plugin.enabled}
						disabled={isUpdating || (!plugin.enabled && !canEnable)}
						onCheckedChange={(enabled) => update({ id: plugin.id, input: { enabled } })}
						aria-label={`Enable ${plugin.name}`}
					/>
				</div>
			</div>

			{!!plugin.capabilities.length && (
				<div className="gap-1.5 flex flex-wrap items-center">
					{plugin.capabilities.map((capability) => (
						<Badge key={capability} size="xs" variant="primary">
							{CAPABILITY_LABELS[capability] ?? capability}
						</Badge>
					))}
				</div>
			)}

			<PluginStatus plugin={plugin} />

			{!!plugin.configFields.length && <PluginConfigForm plugin={plugin} />}

			<div className="gap-2 flex flex-wrap items-center">
				<Button
					size="sm"
					variant="outline"
					onClick={() => test({ id: plugin.id })}
					isLoading={isTesting}
				>
					Test connection
				</Button>
				<Button
					size="sm"
					variant="outline"
					onClick={() => refresh({ id: plugin.id })}
					isLoading={isRefreshing}
				>
					<RefreshCw className="mr-1.5 h-3.5 w-3.5" />
					Refresh manifest
				</Button>
				<Button size="sm" variant="ghost" onClick={() => setConfirmingDelete(true)}>
					Remove
				</Button>
			</div>

			<ConfirmationModal
				isOpen={confirmingDelete}
				onClose={() => setConfirmingDelete(false)}
				onConfirm={() => remove({ id: plugin.id })}
				title={`Remove ${plugin.name}?`}
				description="Longbox stops calling this plugin. The releases it already contributed to the calendar are removed with it. The plugin itself keeps running until you stop it."
				confirmText="Remove"
				confirmVariant="destructive"
			/>
		</div>
	)
}

/**
 * The one line that answers "is this working?".
 *
 * A stored `lastError` is shown verbatim: it is the plugin's own explanation of why it
 * would not talk, and paraphrasing it into "something went wrong" would leave the
 * operator guessing between a typo'd URL, a wrong token, and a plugin that isn't running.
 */
function PluginStatus({ plugin }: { plugin: PluginRow }) {
	if (plugin.lastError) {
		return (
			<div className="gap-2 p-2.5 flex items-start rounded-md border border-destructive/40 bg-destructive/10">
				<AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
				<Text size="sm" className="break-words">
					{plugin.lastError}
				</Text>
			</div>
		)
	}

	if (!plugin.lastHandshakeAt) {
		return (
			<Text size="sm" variant="muted">
				Not contacted yet.
			</Text>
		)
	}

	return (
		<div className="gap-1.5 flex items-center">
			<CheckCircle2 className="h-4 w-4 text-success" />
			<Text size="sm" variant="muted">
				Last reached {new Date(plugin.lastHandshakeAt).toLocaleString()}
			</Text>
		</div>
	)
}
