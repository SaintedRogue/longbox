import { Alert, AlertDescription, CheckBox, Heading, Text } from '@longbox/components'
import { useLocaleContext } from '@longbox/i18n'
import { useCallback, useMemo } from 'react'
import { useFormContext, useWatch } from 'react-hook-form'

import { CreateOrUpdateLibrarySchema } from '@/components/library/createOrUpdate'
import { useLibraryManagementSafe } from '@/scenes/library/tabs/settings/context'

type Props = {
	/**
	 * A callback that is triggered when the form values change, debounced by 1 second.
	 */
	onDidChange?: (
		values: Pick<
			CreateOrUpdateLibrarySchema,
			| 'processMetadata'
			| 'writeComicinfo'
			| 'watch'
			| 'generateFileHashes'
			| 'generateKoreaderHashes'
		>,
	) => void
}

export default function ScannerOptInFeatures({ onDidChange }: Props) {
	const form = useFormContext<CreateOrUpdateLibrarySchema>()
	const ctx = useLibraryManagementSafe()
	const isCreating = !ctx?.library

	const [processMetadata, writeComicinfo, watch, generateFileHashes, koreaderHashes] = useWatch({
		control: form.control,
		name: [
			'processMetadata',
			'writeComicinfo',
			'watch',
			'generateFileHashes',
			'generateKoreaderHashes',
		],
	})

	const params = useMemo(
		() => ({
			processMetadata,
			writeComicinfo,
			watch,
			generateFileHashes,
			generateKoreaderHashes: koreaderHashes,
		}),
		[processMetadata, writeComicinfo, watch, generateFileHashes, koreaderHashes],
	)

	const handleProcessMetadataChange = useCallback(() => {
		form.setValue('processMetadata', !processMetadata)
		if (onDidChange) {
			onDidChange({
				...params,
				processMetadata: !processMetadata,
			})
		}
	}, [form, processMetadata, params, onDidChange])

	const handleWriteComicinfoChange = useCallback(() => {
		form.setValue('writeComicinfo', !writeComicinfo)
		if (onDidChange) {
			onDidChange({
				...params,
				writeComicinfo: !writeComicinfo,
			})
		}
	}, [form, writeComicinfo, params, onDidChange])

	const handleWatchChange = useCallback(() => {
		form.setValue('watch', !watch)
		if (onDidChange) {
			onDidChange({
				...params,
				watch: !watch,
			})
		}
	}, [form, watch, params, onDidChange])

	const handleGenerateFileHashesChange = useCallback(() => {
		form.setValue('generateFileHashes', !generateFileHashes)
		if (onDidChange) {
			onDidChange({
				...params,
				generateFileHashes: !generateFileHashes,
			})
		}
	}, [form, generateFileHashes, params, onDidChange])

	const handleGenerateKoreaderHashesChange = useCallback(() => {
		form.setValue('generateKoreaderHashes', !koreaderHashes)
		if (onDidChange) {
			onDidChange({
				...params,
				generateKoreaderHashes: !koreaderHashes,
			})
		}
	}, [form, koreaderHashes, params, onDidChange])

	const { t } = useLocaleContext()

	return (
		<div className="gap-y-6 flex flex-col">
			<div className="gap-y-1.5 flex flex-col">
				<Heading size="sm">{t(getKey('section.heading'))}</Heading>
				<Text size="sm" variant="muted">
					{t(getKey('section.description'))}
				</Text>
			</div>

			{isCreating && (
				<Alert variant="info">
					<AlertDescription>{t(getKey('section.disclaimer'))}</AlertDescription>
				</Alert>
			)}

			<CheckBox
				id="processMetadata"
				label={t(getKey('processMetadata.label'))}
				description={t(getKey('processMetadata.description'))}
				checked={processMetadata}
				onClick={handleProcessMetadataChange}
				{...form.register('processMetadata')}
			/>

			<CheckBox
				id="writeComicinfo"
				label="Write metadata edits back to ComicInfo.xml (CBZ only)"
				description="When enabled, saving metadata edits rewrites the ComicInfo.xml inside the archive. The file on disk is modified."
				checked={writeComicinfo}
				onClick={handleWriteComicinfoChange}
				{...form.register('writeComicinfo')}
			/>

			<CheckBox
				id="watch"
				label={t(getKey('watch.label'))}
				description={t(getKey('watch.description'))}
				checked={watch}
				onClick={handleWatchChange}
				{...form.register('watch')}
			/>

			<CheckBox
				id="generateFileHashes"
				label={t(getKey('generateFileHashes.label'))}
				description={t(getKey('generateFileHashes.description'))}
				checked={generateFileHashes}
				onClick={handleGenerateFileHashesChange}
				{...form.register('generateFileHashes')}
			/>

			<CheckBox
				id="generateKoreaderHashes"
				label={t(getKey('koreaderHashes.label'))}
				description={t(getKey('koreaderHashes.description'))}
				checked={koreaderHashes}
				onClick={handleGenerateKoreaderHashesChange}
				{...form.register('generateKoreaderHashes')}
			/>
		</div>
	)
}

const LOCALE_KEY = 'createOrUpdateLibraryForm.fields.scannerFeatures'
const getKey = (key: string) => `${LOCALE_KEY}.${key}`
