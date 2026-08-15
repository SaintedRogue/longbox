import { useSuspenseGraphQL } from '@longbox/client'
import { Text } from '@longbox/components'
import { graphql } from '@longbox/graphql'

import { PLUGINS_QUERY_KEY } from './constants'
import PluginCard from './PluginCard'

export const pluginsQuery = graphql(`
	query PluginListPlugins {
		pluginProtocolVersion
		plugins {
			id
			slug
			name
			baseUrl
			enabled
			protocolVersion
			lastHandshakeAt
			lastError
			version
			description
			capabilities
			settings
			configuredSecretKeys
			isAddressable
			configFields {
				key
				label
				type
				required
				default
				options
				help
			}
		}
	}
`)

export default function PluginList() {
	const { data } = useSuspenseGraphQL(pluginsQuery, PLUGINS_QUERY_KEY)
	const plugins = data.plugins

	if (!plugins.length) {
		return (
			<div className="gap-1 p-10 flex flex-col items-center rounded-lg border border-dashed border-border text-center">
				<Text className="font-medium">No plugins registered</Text>
				<Text size="sm" variant="muted" className="max-w-md">
					Register one by URL to get started. This build speaks plugin protocol v
					{data.pluginProtocolVersion}.
				</Text>
			</div>
		)
	}

	return (
		<div className="gap-4 flex flex-col">
			{plugins.map((plugin) => (
				<PluginCard key={plugin.id} plugin={plugin} />
			))}
		</div>
	)
}
