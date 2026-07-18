import { cn, Heading } from '@longbox/components'
import { useFragment, UserPermission } from '@longbox/graphql'
import sortBy from 'lodash/sortBy'
import { Suspense, useMemo } from 'react'

import { useBookOverview } from '@/components/book'
import { BookCardFragment } from '@/components/book/BookCard'
import { MediaMetadataEditor } from '@/components/book/metadata'
import { ProminentThumbnailImage } from '@/components/thumbnail'
import { useAppContext } from '@/context'

import BookActionMenu from './BookActionMenu'
import BookFileInformation from './BookFileInformation'
import BookOverviewSceneHeader from './BookOverviewSceneHeader'
import BookReaderLink from './BookReaderLink'
import BooksAfterCursor from './BooksAfterCursor'

type Props = {
	id: string
	variant: 'page' | 'sheet'
}

export default function BookOverviewContent({ id, variant }: Props) {
	const {
		data: { mediaById: media },
	} = useBookOverview(id)
	const { checkPermission } = useAppContext()

	if (!media) {
		throw new Error('Book not found')
	}

	const fragmentData = useFragment(BookCardFragment, media)

	const completedAt = useMemo(
		() =>
			sortBy(media.readHistory, ({ completedAt }) => new Date(completedAt).getTime()).at(-1)
				?.completedAt,
		[media.readHistory],
	)

	const isSheet = variant === 'sheet'

	return (
		<>
			<Suspense>
				<div className={cn('gap-4 flex h-full w-full flex-col', isSheet && 'px-1 pt-1')}>
					<div
						className={cn(
							'gap-3 tablet:mb-2 flex flex-col items-center tablet:flex-row tablet:items-start',
							isSheet && 'tablet:flex-col tablet:items-center',
						)}
					>
						<div
							className={cn(
								'max-w-sm gap-3 sm:max-w-50 flex w-full shrink-0 flex-col items-center',
								isSheet && 'max-w-56 gap-4 sm:max-w-56',
							)}
						>
							<ProminentThumbnailImage
								src={fragmentData.thumbnail.url}
								alt={media.resolvedName}
								placeholderData={fragmentData.thumbnail.metadata}
							/>
							<div className="gap-2 flex w-full flex-col">
								<BookReaderLink book={fragmentData} />
								<BookActionMenu book={fragmentData} />
							</div>
						</div>

						<BookOverviewSceneHeader media={media} book={fragmentData} completedAt={completedAt} />
					</div>

					{variant === 'page' && <BooksAfterCursor cursor={media.id} />}

					<div className={cn('gap-y-2 flex flex-col', isSheet && 'pt-4 border-t border-border')}>
						<Heading size="sm">Metadata</Heading>
						<MediaMetadataEditor mediaId={media.id} data={media.metadata} />
					</div>
				</div>
			</Suspense>

			{/*Note: There is no permission specific to file info but I am just taking a loose assumption here*/}
			{variant === 'page' && checkPermission(UserPermission.ManageLibrary) && (
				<BookFileInformation fragment={media} />
			)}
		</>
	)
}
