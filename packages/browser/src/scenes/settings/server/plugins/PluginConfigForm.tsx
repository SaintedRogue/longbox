import { useGraphQLMutation } from '@longbox/client'
import { Button, CheckBox, Input, NativeSelect, PasswordInput, Text } from '@longbox/components'
import { graphql, PluginConfigFieldType } from '@longbox/graphql'
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'

import { PLUGINS_QUERY_KEY } from './constants'
import type { PluginRow } from './PluginCard'

const saveSettingsMutation = graphql(`
	mutation PluginConfigFormSave($id: Int!, $input: PatchPluginInput!) {
		updatePlugin(id: $id, input: $input) {
			plugin {
				id
			}
		}
	}
`)

type Draft = Record<string, string | number | boolean>

/**
 * A settings form Longbox did not write.
 *
 * Every field here comes from the plugin's own manifest, which is the mechanism that lets
 * a plugin be configurable without Longbox knowing anything about it. The field types are
 * a deliberately small closed set — a plugin describes *what* it needs and Longbox decides
 * how to render it, rather than shipping plugin-authored code to the browser.
 */
export default function PluginConfigForm({ plugin }: { plugin: PluginRow }) {
	const client = useQueryClient()
	const [draft, setDraft] = useState<Draft>({})

	const { mutate, isPending } = useGraphQLMutation(saveSettingsMutation, {
		onSuccess: () => {
			setDraft({})
			toast.success('Settings saved')
			client.invalidateQueries({ queryKey: PLUGINS_QUERY_KEY })
		},
		onError: (error) => toast.error('Could not save settings', { description: String(error) }),
	})

	const stored = (plugin.settings ?? {}) as Record<string, unknown>
	const isDirty = Object.keys(draft).length > 0

	const valueFor = (key: string, fallback: unknown) => (key in draft ? draft[key] : fallback)

	const set = (key: string, value: string | number | boolean) =>
		setDraft((current) => ({ ...current, [key]: value }))

	const handleSave = () => mutate({ id: plugin.id, input: { settings: draft } })

	return (
		<div className="gap-3 pt-3 flex flex-col border-t border-border">
			{plugin.configFields.map((field) => {
				const isSecret = field.type === PluginConfigFieldType.Secret
				const secretIsSet = plugin.configuredSecretKeys.includes(field.key)

				return (
					<div key={field.key} className="gap-1 flex flex-col">
						{field.type === PluginConfigFieldType.Boolean ? (
							<CheckBox
								id={`${plugin.id}-${field.key}`}
								label={field.label}
								checked={Boolean(valueFor(field.key, stored[field.key] ?? false))}
								onClick={() => set(field.key, !valueFor(field.key, stored[field.key] ?? false))}
							/>
						) : (
							<>
								<Text size="sm" className="font-medium">
									{field.label}
									{field.required && <span className="ml-0.5 text-destructive">*</span>}
								</Text>

								{field.type === PluginConfigFieldType.Select ? (
									<NativeSelect
										options={(field.options ?? []).map((option) => ({
											label: option,
											value: option,
										}))}
										value={String(valueFor(field.key, stored[field.key] ?? ''))}
										onChange={(event) => set(field.key, event.target.value)}
									/>
								) : isSecret ? (
									<PasswordInput
										value={String(valueFor(field.key, ''))}
										placeholder={secretIsSet ? '•••••••• (set)' : 'Not set'}
										onChange={(event) => set(field.key, event.target.value)}
									/>
								) : (
									<Input
										type={field.type === PluginConfigFieldType.Number ? 'number' : 'text'}
										value={String(valueFor(field.key, stored[field.key] ?? ''))}
										placeholder={field.default ?? undefined}
										onChange={(event) =>
											set(
												field.key,
												field.type === PluginConfigFieldType.Number
													? Number(event.target.value)
													: event.target.value,
											)
										}
									/>
								)}
							</>
						)}

						{field.help && (
							<Text size="xs" variant="muted">
								{field.help}
							</Text>
						)}
					</div>
				)
			})}

			<div>
				<Button size="sm" onClick={handleSave} disabled={!isDirty} isLoading={isPending}>
					Save settings
				</Button>
			</div>
		</div>
	)
}
