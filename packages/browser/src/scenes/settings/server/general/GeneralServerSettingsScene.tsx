import { useUploadConfig } from '@longbox/client'
import { UserPermission } from '@longbox/graphql'
import { useLocaleContext } from '@longbox/i18n'
import { Suspense } from 'react'
import { Helmet } from 'react-helmet'

import { ContentContainer } from '@/components/container'
import { SceneContainer } from '@/components/container'
import { useAppContext } from '@/context'

import HelpfulLinks from './HelpfulLinks'
import ServerEmojisSection from './ServerEmojisSection'
import ServerInfoSection from './ServerInfoSection'
import ServerPublicURL from './ServerPublicURL'
import ServerStats from './ServerStats'

export default function GeneralServerSettingsScene() {
	const { t } = useLocaleContext()
	const { checkPermission } = useAppContext()

	const { uploadConfig } = useUploadConfig({ enabled: checkPermission(UserPermission.UploadFile) })

	return (
		<SceneContainer>
			<Helmet>
				<title>Longbox | {t('settingsScene.server/general.helmet')}</title>
			</Helmet>

			<ContentContainer>
				<div className="gap-12 flex flex-col">
					<Suspense>
						<ServerStats />
					</Suspense>

					<ServerInfoSection />
					<ServerPublicURL />
					{uploadConfig?.enabled && <ServerEmojisSection />}

					<HelpfulLinks />
				</div>
			</ContentContainer>
		</SceneContainer>
	)
}
