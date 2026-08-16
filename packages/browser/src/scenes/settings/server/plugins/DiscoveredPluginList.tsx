import { useGraphQLMutation, useSuspenseGraphQL } from '@longbox/client'
import { Button, Text } from '@longbox/components'
import { graphql } from '@longbox/graphql'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { DISCOVERED_PLUGINS_QUERY_KEY, PLUGINS_QUERY_KEY } from './constants'

export const discoveredQuery = graphql(`
	query DiscoveredLocalPlugins {
		discoveredLocalPlugins {
			dir
			id
			name
			version
			description
			command
			installed
		}
	}
`)

const installMutation = graphql(`
	mutation InstallLocalPlugin($dir: String!) {
		installLocalPlugin(dir: $dir) {
			plugin {
				id
				name
				slug
			}
		}
	}
`)

/**
 * Plugin directories sitting under the config volume, ready to install.
 *
 * This is the route that needs no container and no catalogue: drop a directory into
 * `plugins/` on the config share and it appears here.
 */
export default function DiscoveredPluginList() {
	const client = useQueryClient()
	const { data } = useSuspenseGraphQL(discoveredQuery, DISCOVERED_PLUGINS_QUERY_KEY)

	const { mutate, isPending, variables } = useGraphQLMutation(installMutation, {
		onSuccess: (result) => {
			toast.success(`Installed ${result.installLocalPlugin.plugin.name}`, {
				description: 'It stays off until you enable it.',
			})
			client.invalidateQueries({ queryKey: DISCOVERED_PLUGINS_QUERY_KEY })
			client.invalidateQueries({ queryKey: PLUGINS_QUERY_KEY })
		},
		onError: (error) => toast.error('Could not install plugin', { description: String(error) }),
	})

	const found = data.discoveredLocalPlugins

	if (!found.length) {
		return (
			<div className="gap-1 p-8 flex flex-col items-center rounded-lg border border-dashed border-border text-center">
				<Text className="font-medium">No plugin directories found</Text>
				<Text size="sm" variant="muted" className="max-w-md">
					Put a folder containing a <code className="text-xs">plugin.json</code> into{' '}
					<code className="text-xs">plugins/</code> on the config volume, and it will show up here.
				</Text>
			</div>
		)
	}

	return (
		<div className="gap-3 flex flex-col">
			{found.map((plugin) => (
				<div
					key={plugin.dir}
					className="gap-3 p-4 flex flex-wrap items-start justify-between rounded-lg border border-border bg-card"
				>
					<div className="gap-1.5 min-w-0 flex flex-1 flex-col">
						<div className="gap-2 flex flex-wrap items-baseline">
							<Text className="font-medium">{plugin.name}</Text>
							{plugin.version && (
								<Text size="xs" variant="muted">
									v{plugin.version}
								</Text>
							)}
							<Text size="xs" variant="muted" className="tabular-nums">
								{plugin.dir}
							</Text>
						</div>

						{plugin.description && (
							<Text size="sm" variant="muted">
								{plugin.description}
							</Text>
						)}

						{/*
						 * The command is shown, not hidden behind the install button. Installing
						 * this runs it inside the server with the server's privileges, and that
						 * is not something to agree to without seeing what it is.
						 */}
						<div className="gap-1 mt-1 flex flex-col">
							<Text size="xs" variant="muted" className="font-semibold tracking-wide uppercase">
								Runs
							</Text>
							<code className="px-2 py-1 text-xs rounded overflow-x-auto bg-muted">
								{plugin.command.join(' ')}
							</code>
						</div>
					</div>

					{plugin.installed ? (
						<Text size="sm" variant="muted" className="shrink-0">
							Installed
						</Text>
					) : (
						<Button
							size="sm"
							variant="default"
							disabled={isPending}
							onClick={() => mutate({ dir: plugin.dir })}
						>
							{isPending && variables?.dir === plugin.dir ? 'Installing…' : 'Install'}
						</Button>
					)}
				</div>
			))}
		</div>
	)
}
