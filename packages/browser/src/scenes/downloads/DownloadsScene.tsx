import { formatBytes } from '@longbox/client'
import { Badge, Button, Card, Heading, Text } from '@longbox/components'
import { useLocaleContext } from '@longbox/i18n'
import { Book, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Helmet } from 'react-helmet'
import { Link } from 'react-router-dom'

import Container from '@/components/container/Container'
import { EntityImage } from '@/components/entity/EntityImage'
import GenericEmptyState from '@/components/GenericEmptyState'
import type { DownloadRecord } from '@/offline/db'
import { useDownloadActions, useDownloadsList } from '@/offline/useDownloads'
import paths from '@/paths'

const LOCALE_BASE_KEY = 'downloadsScene'
const withLocaleKey = (key: string) => `${LOCALE_BASE_KEY}.${key}`

/**
 * Lists books that have been downloaded for offline reading (Task 4.4's `OfflineDownloadButton`
 * is how they get here), with their on-disk size and a way to remove them. Reads straight from
 * the local `useDownloadStore` records projection -- no server round-trip -- so this renders
 * correctly even with the server unreachable. Opening a book routes to the offline reader entry
 * (`paths.offlineReader`, see OfflineBookReaderScene.tsx), which synthesizes the book from the
 * local `DownloadRecord` instead of the normal book route's `mediaById` query -- it works whether
 * the server is reachable or not.
 */
export default function DownloadsScene() {
	const { t } = useLocaleContext()
	const records = useDownloadsList()
	const { remove } = useDownloadActions()

	return (
		<>
			<Helmet>
				<title>Longbox | {t(withLocaleKey('title'))}</title>
			</Helmet>

			<Container className="gap-4 flex flex-col">
				<div>
					<Heading size="lg" bold>
						{t(withLocaleKey('title'))}
					</Heading>
					<Text variant="muted" size="sm">
						{t(withLocaleKey('subtitle'))}
					</Text>
				</div>

				{!records.length && (
					<GenericEmptyState
						title={t(withLocaleKey('emptyState.heading'))}
						subtitle={t(withLocaleKey('emptyState.message'))}
					/>
				)}

				{!!records.length && (
					<div className="gap-2 md:w-2/3 lg:max-w-xl flex w-full flex-col">
						{records.map((record) => (
							<DownloadRow key={record.bookId} record={record} onRemove={remove} />
						))}
					</div>
				)}
			</Container>
		</>
	)
}

type DownloadRowProps = {
	record: DownloadRecord
	onRemove: (bookId: string) => Promise<void>
}

function DownloadRow({ record, onRemove }: DownloadRowProps) {
	const { t } = useLocaleContext()

	return (
		<Card className="gap-3 p-3 flex w-full items-center">
			<Link
				to={paths.offlineReader(record.bookId)}
				className="gap-3 min-w-0 flex flex-1 items-center"
			>
				<DownloadThumbnail record={record} />

				<div className="gap-1 min-w-0 flex flex-col">
					<Text className="font-medium line-clamp-1">{record.title}</Text>
					<div className="gap-2 flex items-center">
						<Badge variant="secondary" rounded="full">
							{record.format.toUpperCase()}
						</Badge>
						<Text variant="muted" size="sm">
							{formatBytes(record.sizeBytes)}
						</Text>
					</div>
				</div>
			</Link>

			<Button
				variant="outline"
				size="sm"
				onClick={() => onRemove(record.bookId)}
				title={t('offlineDownload.remove')}
			>
				<Trash2 className="mr-2 h-4 w-4" />
				{t('offlineDownload.remove')}
			</Button>
		</Card>
	)
}

function DownloadThumbnail({ record }: { record: DownloadRecord }) {
	const [showFallback, setShowFallback] = useState(!record.thumbnailUrl)

	if (showFallback) {
		return (
			<div className="h-16 shadow-sm flex aspect-[2/3] shrink-0 items-center justify-center rounded-sm border-[0.5px] border-border bg-sidebar">
				<Book className="h-6 w-6 text-muted-foreground" />
			</div>
		)
	}

	return (
		<EntityImage
			alt={record.title}
			className="h-16 aspect-[2/3] shrink-0 rounded-sm object-cover"
			src={record.thumbnailUrl}
			onError={() => setShowFallback(true)}
		/>
	)
}
