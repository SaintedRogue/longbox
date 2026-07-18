import { Alert, AlertDescription, AlertTitle } from '@longbox/components'
import { useLocaleContext } from '@longbox/i18n'
import { AlertCircle } from 'lucide-react'

export function ExperimentalFeatureDisclaimer() {
	const { t } = useLocaleContext()

	// sorry folks, this one isn't dismissable
	return (
		<Alert variant="warning">
			<AlertCircle />
			<AlertTitle>{t('common.experimentalDisclaimer.title')}</AlertTitle>
			<AlertDescription>{t('common.experimentalDisclaimer.description')}</AlertDescription>
		</Alert>
	)
}
