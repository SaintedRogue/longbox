import { Heading, Text } from '@longbox/components'
import { Suspense } from 'react'
import { Helmet } from 'react-helmet'

import { ContentContainer, SceneContainer } from '@/components/container'

import PluginList from './PluginList'
import RegisterPluginDialog from './RegisterPluginDialog'

export default function PluginSettingsScene() {
	return (
		<SceneContainer>
			<Helmet>
				<title>Longbox | Plugins</title>
			</Helmet>

			<ContentContainer>
				<div className="gap-6 flex flex-col">
					{/*
					 * No page heading here: the settings layout already renders one from the
					 * locale. This is the *section* heading, which is why it names what is in
					 * the list rather than repeating the page's own title.
					 */}
					<div className="gap-3 flex flex-wrap items-start justify-between">
						<div className="gap-1 max-w-2xl flex flex-col">
							<Heading size="sm">Registered plugins</Heading>
							<Text size="sm" variant="muted">
								Plugins live in their own repositories, in any language, and are never part of a
								Longbox release. Longbox calls them; they never call back in.
							</Text>
						</div>

						<RegisterPluginDialog />
					</div>

					<Suspense fallback={null}>
						<PluginList />
					</Suspense>
				</div>
			</ContentContainer>
		</SceneContainer>
	)
}
