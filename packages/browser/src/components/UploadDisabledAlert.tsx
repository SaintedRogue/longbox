import { Alert, AlertDescription, AlertTitle } from '@stump/components'
import { useLocaleContext } from '@stump/i18n'

type Props = {
	id?: string
}

export function UploadDisabledAlert({ id }: Props) {
	const { t } = useLocaleContext()

	const props = id
		? ({
				dismissible: true,
				id,
			} as const)
		: {}

	return (
		<Alert {...props}>
			<AlertTitle>{t('uploadDisabledAlert.title')}</AlertTitle>
			<AlertDescription>{t('uploadDisabledAlert.description')}</AlertDescription>
		</Alert>
	)
}
