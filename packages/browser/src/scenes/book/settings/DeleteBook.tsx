import { Alert, AlertDescription, AlertTitle, Button, Heading, Text } from '@longbox/components'
import { useLocaleContext } from '@longbox/i18n'
import { TriangleAlert } from 'lucide-react'
import { useCallback, useState } from 'react'
import { useNavigate } from 'react-router'

import DeleteBookConfirmation from '@/components/book/DeleteBookConfirmation'
import paths from '@/paths'

const LOCALE_KEY = 'bookManagementScene.deleteBook'
const getKey = (key: string) => `${LOCALE_KEY}.${key}`

type Props = {
	bookId: string
	bookName: string
	seriesId: string
}

/**
 * The danger zone for a single book: removing it from the library, and — separately and much
 * more loudly — erasing the file it came from.
 */
export default function DeleteBook({ bookId, bookName, seriesId }: Props) {
	const { t } = useLocaleContext()
	const navigate = useNavigate()

	// `null` means no confirmation is open. Otherwise it carries whether the pending action
	// erases the file, so the confirmation can be worded for exactly what is about to happen.
	const [pendingDeleteFile, setPendingDeleteFile] = useState<boolean | null>(null)

	const handleDeleted = useCallback(() => {
		navigate(paths.seriesOverview(seriesId))
	}, [navigate, seriesId])

	return (
		<div className="space-y-4 flex flex-col">
			<div>
				<Heading size="sm">{t(getKey('heading'))}</Heading>
				<Text size="sm" variant="muted" className="mt-1">
					{t(getKey('description'))}
				</Text>
			</div>

			<Alert variant="destructive">
				<TriangleAlert />
				<AlertTitle>{t(getKey('disclaimerTitle'))}</AlertTitle>
				<AlertDescription>{t(getKey('disclaimer'))}</AlertDescription>
			</Alert>

			<div className="gap-2 flex flex-wrap">
				<Button type="button" variant="outline" onClick={() => setPendingDeleteFile(false)}>
					{t(getKey('removeRecord.action'))}
				</Button>

				<Button type="button" variant="destructive" onClick={() => setPendingDeleteFile(true)}>
					{t(getKey('deleteFile.action'))}
				</Button>
			</div>

			{pendingDeleteFile !== null && (
				<DeleteBookConfirmation
					bookId={bookId}
					bookName={bookName}
					deleteFile={pendingDeleteFile}
					isOpen
					onClose={() => setPendingDeleteFile(null)}
					onDeleted={handleDeleted}
				/>
			)}
		</div>
	)
}
