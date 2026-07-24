import { useGraphQLMutation, useSuspenseGraphQL } from '@longbox/client'
import {
	Alert,
	AlertDescription,
	AlertTitle,
	Button,
	CheckBox,
	Heading,
	Text,
} from '@longbox/components'
import { extractErrorMessage, graphql } from '@longbox/graphql'
import { useLocaleContext } from '@longbox/i18n'
import { Info } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { useLibraryContext } from '@/scenes/library/context'

const query = graphql(`
	query InitFetchJobCheckProviders {
		metadataProviderConfigs {
			id
		}
	}
`)

const mutation = graphql(`
	mutation InitFetchJob($id: ID!, $forceRefetch: Boolean!) {
		fetchLibraryMetadata(id: $id, forceRefetch: $forceRefetch)
	}
`)

export default function InitFetchJob() {
	const { library } = useLibraryContext()
	const { t } = useLocaleContext()

	const [forceRefetch, setForceRefetch] = useState(false)

	const {
		data: { metadataProviderConfigs },
	} = useSuspenseGraphQL(query, ['metadataProviderConfigs', 'initFetchJob', library.id])

	const { mutate } = useGraphQLMutation(mutation, {
		onError: (error) => {
			const message = extractErrorMessage(error)
			toast.error(t(getKey('fetchError')), {
				description: message,
			})
		},
	})

	const handleFetch = () => mutate({ id: library.id, forceRefetch })

	return (
		<div className="gap-6 flex flex-col">
			<div>
				<Heading size="sm">{t(getKey('heading'))}</Heading>
				<Text size="sm" variant="muted">
					{t(getKey('description'))}
				</Text>
			</div>

			{metadataProviderConfigs.length === 0 && (
				<Alert variant="info">
					<Info />
					<AlertTitle>{t(getKey('noProviders.title'))}</AlertTitle>
					<AlertDescription>{t(getKey('noProviders.description'))}</AlertDescription>
				</Alert>
			)}

			<CheckBox
				id="forceRefetch"
				label={t(getKey('forceRefetch.label'))}
				description={t(getKey('forceRefetch.description'))}
				checked={forceRefetch}
				onClick={() => setForceRefetch((prev) => !prev)}
			/>

			<div>
				<Button onClick={handleFetch} disabled={metadataProviderConfigs.length === 0}>
					{t(getKey('fetchButton'))}
				</Button>
			</div>
		</div>
	)
}

const LOCALE_KEY = 'librarySettingsScene.integrations/metadata.sections.fetchMetadata'
const getKey = (key: string) => `${LOCALE_KEY}.${key}`
