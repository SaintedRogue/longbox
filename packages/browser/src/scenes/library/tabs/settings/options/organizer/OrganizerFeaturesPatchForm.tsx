import { zodResolver } from '@hookform/resolvers/zod'
import { CheckBox, Form } from '@longbox/components'
import { useLocaleContext } from '@longbox/i18n'
import { useCallback, useMemo } from 'react'
import { useForm, useWatch } from 'react-hook-form'

import {
	buildSchema,
	CreateOrUpdateLibrarySchema,
	formDefaults,
} from '@/components/library/createOrUpdate'

import { useLibraryManagement } from '../../context'

export default function OrganizerFeaturesPatchForm() {
	const { t } = useLocaleContext()
	const { library, patch } = useLibraryManagement()

	const schema = useMemo(() => buildSchema([], library), [library])
	const form = useForm<CreateOrUpdateLibrarySchema>({
		defaultValues: formDefaults(library),
		reValidateMode: 'onChange',
		resolver: zodResolver(schema),
	})

	const autoOrganizeLooseFiles = useWatch({ control: form.control, name: 'autoOrganizeLooseFiles' })

	const handleToggle = useCallback(() => {
		const next = !autoOrganizeLooseFiles
		form.setValue('autoOrganizeLooseFiles', next)
		patch({ config: { autoOrganizeLooseFiles: next }, scanAfterPersist: false })
	}, [autoOrganizeLooseFiles, form, patch])

	const organizeCatchallSubfolders = useWatch({
		control: form.control,
		name: 'organizeCatchallSubfolders',
	})

	const handleCatchallToggle = useCallback(() => {
		const next = !organizeCatchallSubfolders
		form.setValue('organizeCatchallSubfolders', next)
		patch({ config: { organizeCatchallSubfolders: next }, scanAfterPersist: false })
	}, [organizeCatchallSubfolders, form, patch])

	return (
		<Form form={form} onSubmit={() => {}} fieldsetClassName="space-y-12">
			<CheckBox
				id="autoOrganizeLooseFiles"
				label={t(getKey('autoOrganizeLooseFiles.label'))}
				description={t(getKey('autoOrganizeLooseFiles.description'))}
				checked={autoOrganizeLooseFiles}
				onClick={handleToggle}
				{...form.register('autoOrganizeLooseFiles')}
			/>
			<CheckBox
				id="organizeCatchallSubfolders"
				label={t(getKey('organizeCatchallSubfolders.label'))}
				description={t(getKey('organizeCatchallSubfolders.description'))}
				checked={organizeCatchallSubfolders}
				onClick={handleCatchallToggle}
				{...form.register('organizeCatchallSubfolders')}
			/>
		</Form>
	)
}

const LOCALE_KEY = 'librarySettingsScene.options/organize.sections.features'
const getKey = (key: string) => `${LOCALE_KEY}.${key}`
