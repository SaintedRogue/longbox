import { Button, Label, Text } from '@longbox/components'
import { useLocaleContext } from '@longbox/i18n'
import { useState } from 'react'

import { useLibraryManagement } from '../../context'
import OrganizeLooseFilesDialog from './OrganizeLooseFilesDialog'

export default function OrganizerActionsSection() {
	const { t } = useLocaleContext()
	const { library } = useLibraryManagement()
	const [open, setOpen] = useState(false)

	return (
		<div className="gap-y-3 flex flex-col">
			<div>
				<Label className="text-base">{t(getKey('organize.heading'))}</Label>
				<Text variant="muted">{t(getKey('organize.description'))}</Text>
			</div>
			<div>
				<Button size="sm" onClick={() => setOpen(true)}>
					{t(getKey('organize.heading'))}
				</Button>
			</div>
			<OrganizeLooseFilesDialog libraryId={library.id} open={open} onOpenChange={setOpen} />
		</div>
	)
}

const LOCALE_BASE = 'librarySettingsScene.options/organize.sections'
const getKey = (key: string) => `${LOCALE_BASE}.${key}`
