import { useDirectoryListing, UseDirectoryListingFile, useSDK } from '@longbox/client'
import { UserPermission } from '@longbox/graphql'
import { useCallback, useState } from 'react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'

import { useAppContext } from '@/context'
import paths from '@/paths'
import ScopedOrganizeDialog from '@/scenes/library/tabs/settings/options/organizer/ScopedOrganizeDialog'

import { ExplorerContext, ExplorerLayout, IExplorerContext, OrganizeTarget } from './context'
import FileExplorer from './FileExplorer'
import FileExplorerFooter, { FOOTER_HEIGHT } from './FileExplorerFooter'
import FileExplorerHeader from './FileExplorerHeader'
import { getBook } from './FileThumbnail'

type Props = Pick<IExplorerContext, 'libraryID' | 'rootPath' | 'uploadConfig'>

// TODO: refactor to match other explore scenes, e.g. sticky header + fixed footer + window scrolling

export default function FileExplorerProvider({ rootPath, ...ctx }: Props) {
	const navigate = useNavigate()
	const { sdk } = useSDK()
	const { checkPermission } = useAppContext()

	const [layout, setLayout] = useState<ExplorerLayout>(() => getDefaultLayout())
	const [organizeTarget, setOrganizeTarget] = useState<OrganizeTarget | null>(null)

	const canOrganize = checkPermission(UserPermission.ScanLibrary)

	// TODO: I need to store location.state somewhere so that when the user uses native navigation,
	// their history, or at the very least where they left off, is persisted.
	const {
		entries,
		setPath,
		path,
		goForward,
		goBack,
		canGoBack,
		canGoForward,
		refetch,
		canLoadMore,
		loadMore,
	} = useDirectoryListing({
		enforcedRoot: rootPath,
		initialPath: rootPath,
	})

	const handleSelect = async (entry: UseDirectoryListingFile) => {
		if (entry.isDirectory) {
			setPath(entry.path)
		} else {
			try {
				const entity = await getBook(entry.path, sdk)
				if (entity) {
					navigate(paths.bookOverview(entity.id), {
						state: {
							forward_path: path,
						},
					})
				} else {
					toast.error('No associated DB entry found for this file')
				}
			} catch (err) {
				console.error(err)
				toast.error('An unknown error occurred')
			}
		}
	}

	const changeLayout = (newLayout: 'grid' | 'table') => {
		setDefaultLayout(newLayout)
		setLayout(newLayout)
	}

	const onLoadMore = useCallback(() => {
		if (canLoadMore) {
			loadMore()
		}
	}, [canLoadMore, loadMore])

	return (
		<ExplorerContext.Provider
			value={{
				canGoBack: canGoBack && path !== rootPath,
				canGoForward,
				currentPath: path,
				files: entries,
				goBack,
				goForward,
				layout,
				navigateToPath: setPath,
				onSelect: handleSelect,
				onOrganize: setOrganizeTarget,
				canOrganize,
				refetch,
				rootPath,
				setLayout: changeLayout,
				canLoadMore,
				loadMore: onLoadMore,
				...ctx,
			}}
		>
			<div className="min-h-0 flex flex-1 flex-col">
				<FileExplorerHeader />
				<div
					className="flex-1"
					style={{
						marginBottom: FOOTER_HEIGHT,
					}}
				>
					<FileExplorer />
				</div>
				<FileExplorerFooter />
			</div>
			{organizeTarget && (
				<ScopedOrganizeDialog
					libraryId={ctx.libraryID}
					targetPath={organizeTarget.path}
					targetName={organizeTarget.name}
					open={!!organizeTarget}
					onOpenChange={(nextOpen) => {
						if (!nextOpen) setOrganizeTarget(null)
					}}
				/>
			)}
		</ExplorerContext.Provider>
	)
}

const LOCAL_STORAGE_LAYOUT_KEY = 'longbox-explorer-layout'
const getDefaultLayout = () => {
	const storedLayout = localStorage.getItem(LOCAL_STORAGE_LAYOUT_KEY)
	if (storedLayout === 'grid' || storedLayout === 'table') {
		return storedLayout
	}
	return 'grid'
}
const setDefaultLayout = (layout: ExplorerLayout) => {
	localStorage.setItem(LOCAL_STORAGE_LAYOUT_KEY, layout)
}
