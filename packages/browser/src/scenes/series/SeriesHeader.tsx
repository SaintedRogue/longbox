import { useGraphQLMutation, usePrefetchFiles } from '@longbox/client'
import { formatBytesSeparate } from '@longbox/client'
import { Breadcrumbs } from '@longbox/components'
import { DropdownItemGroup } from '@longbox/components/dropdown/DropdownMenu'
import { extractErrorMessage, graphql, UserPermission } from '@longbox/graphql'
import { formatHumanDurationSeparate, useLocaleContext } from '@longbox/i18n'
import { useQueryClient } from '@tanstack/react-query'
import {
	ArrowUpRight,
	BookCheck,
	BookOpen,
	BookOpenCheck,
	Clock,
	HardDrive,
	Wand2,
} from 'lucide-react'
import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { toast } from 'sonner'

import { ProviderMatchDialog } from '@/components/metadata/providerMatch'
import { EntityHeader } from '@/components/sharedLayout'
import { useAppContext } from '@/context'
import { useBrowseReturnPath } from '@/hooks/useBrowseHistory'
import { usePaths } from '@/paths'
import { browseSceneKey } from '@/stores/browseHistory'

import CompleteSeriesConfirmation from './CompleteSeriesConfirmation'
import { useSeriesContext } from './context'
import { SeriesOverviewSheet } from './SeriesOverviewSheet'
import { usePrefetchSeriesBooks } from './tabs/books/SeriesBooksScene'

const completeSeriesMutation = graphql(`
	mutation SeriesActionComplete($id: ID!) {
		finishSeriesProgress(id: $id)
	}
`)

export default function SeriesHeader() {
	const { checkPermission } = useAppContext()
	const {
		series: {
			id,
			resolvedName,
			path,
			stats,
			library: { id: libraryId, name: libraryName },
		},
	} = useSeriesContext()
	const { t } = useLocaleContext()

	const location = useLocation()
	const navigate = useNavigate()
	const paths = usePaths()
	// Both ways back up to the library -- the breadcrumb and the "Go to library" action --
	// return to the list as it was left, not to its first page.
	const libraryReturnPath = useBrowseReturnPath(
		browseSceneKey.library(libraryId),
		paths.librarySeries(libraryId),
	)
	const formattedTime = stats.totalReadingTimeSeconds
		? formatHumanDurationSeparate(stats.totalReadingTimeSeconds)
		: null
	const formattedSize = stats.totalBytes ? formatBytesSeparate(stats.totalBytes) : null

	const [showCompleteSeriesConfirmation, setShowCompleteSeriesConfirmation] = useState(false)
	const [isOverviewSheetOpen, setIsOverviewSheetOpen] = useState(false)
	const [showMatchDialog, setShowMatchDialog] = useState(false)

	const canMatchMetadata =
		checkPermission(UserPermission.MetadataFetchRecordManage) &&
		checkPermission(UserPermission.MetadataFetchRecordRead)

	const client = useQueryClient()

	const onSuccess = () => {
		client.invalidateQueries({ queryKey: ['seriesBooks', id], exact: false })
	}

	const { mutate: completeSeries } = useGraphQLMutation(completeSeriesMutation, {
		onSuccess,
		onError: (error) => {
			console.error(error)
			toast.error(t('seriesHeader.errors.failedToUpdateCompletion'), {
				description: extractErrorMessage(error),
			})
		},
	})

	const actions = [
		{
			items: [
				{
					label: t('seriesHeader.actions.markAsRead'),
					leftIcon: <BookOpenCheck className="mr-2 h-4 w-4" />,
					onClick: () => {
						setShowCompleteSeriesConfirmation(true)
					},
				},
			],
		},
		...(canMatchMetadata
			? [
					{
						items: [
							{
								label: 'Find metadata match',
								leftIcon: <Wand2 className="mr-2 h-4 w-4" />,
								onClick: () => {
									setShowMatchDialog(true)
								},
							},
						],
					},
				]
			: []),
		{
			items: [
				{
					label: t('seriesHeader.actions.goToLibrary'),
					leftIcon: <ArrowUpRight className="mr-2 h-4 w-4" />,
					onClick: () => {
						navigate(libraryReturnPath)
					},
				},
			],
		},
	] satisfies DropdownItemGroup[]

	const prefetchSeriesBooks = usePrefetchSeriesBooks()
	const prefetchFiles = usePrefetchFiles()

	const canAccessFiles = checkPermission(UserPermission.FileExplorer)

	const tabs = [
		{
			isActive: !!location.pathname.match(/\/series\/[^/]+\/books(\/.*)?$/),
			label: t('seriesHeader.tabs.books'),
			onHover: () => prefetchSeriesBooks(id),
			to: 'books',
		},
		...(canAccessFiles
			? [
					{
						isActive: !!location.pathname.match(/\/series\/[^/]+\/files(\/.*)?$/),
						label: t('seriesHeader.tabs.files'),
						onHover: () =>
							prefetchFiles({
								path,
								fetchConfig: checkPermission(UserPermission.UploadFile),
							}),
						to: 'files',
					},
				]
			: []),
	]

	const resolvedStats = stats
		? [
				{
					key: 'inProgressBooks',
					icon: BookOpen,
					label: t('libraryHeader.stats.inProgress'),
					priority: 3 as const,
					value: stats.inProgressBooks,
				},
				{
					key: 'completedBooks',
					icon: BookCheck,
					label: t('libraryHeader.stats.completed'),
					priority: 1 as const,
					value: stats.completedBooks,
					suffix: `/ ${stats.bookCount}`,
				},
				...(formattedTime
					? [
							{
								key: 'totalReadingTimeSeconds',
								icon: Clock,
								label: t('libraryHeader.stats.readingTime'),
								priority: 4 as const,
								value: formattedTime.value,
								suffix: formattedTime.unit,
							},
						]
					: []),
				...(formattedSize
					? [
							{
								key: 'totalBytes',
								icon: HardDrive,
								label: t('libraryHeader.stats.diskSize'),
								priority: 4 as const,
								value: formattedSize.value,
								suffix: formattedSize.unit,
							},
						]
					: []),
			]
		: undefined

	return (
		<>
			<CompleteSeriesConfirmation
				isOpen={showCompleteSeriesConfirmation}
				onCancel={() => setShowCompleteSeriesConfirmation(false)}
				onConfirm={() => {
					completeSeries({ id: id })
					setShowCompleteSeriesConfirmation(false)
				}}
			/>

			<div className="px-4 pt-2">
				<Breadcrumbs
					segments={[
						{ label: 'Libraries', to: paths.libraries(), noShrink: true },
						{ label: libraryName, to: libraryReturnPath, noShrink: true },
						{ label: resolvedName },
					]}
				/>
			</div>

			<EntityHeader
				name={resolvedName}
				tabs={tabs}
				actions={actions}
				stats={resolvedStats}
				settingsLink="settings"
				onInfoClick={() => setIsOverviewSheetOpen(true)}
			/>

			<SeriesOverviewSheet
				isOpen={isOverviewSheetOpen}
				onClose={() => setIsOverviewSheetOpen(false)}
			/>

			{canMatchMetadata && (
				<ProviderMatchDialog
					kind="series"
					id={id}
					open={showMatchDialog}
					onOpenChange={setShowMatchDialog}
				/>
			)}
		</>
	)
}
