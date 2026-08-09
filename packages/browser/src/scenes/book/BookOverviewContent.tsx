import { Heading } from '@longbox/components'
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
import BookMetadataMatch from './BookMetadataMatch'
import BookOverviewSceneHeader from './BookOverviewSceneHeader'
import BookReaderLink from './BookReaderLink'
import BooksAfterCursor from './BooksAfterCursor'

type Props = {
	id: string
}

export default function BookOverviewContent({ id }: Props) {
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

	return (
		<>
			<Suspense>
				<div className="gap-4 flex h-full w-full flex-col">
					<div className="gap-3 tablet:mb-2 flex flex-col items-center tablet:flex-row tablet:items-start">
						<div className="max-w-sm gap-3 sm:max-w-50 flex w-full shrink-0 flex-col items-center">
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

					{/* `nextInSeries` walks the book's series_id. For a standalone book that is
					    the library-root bucket, so the rail would list every unrelated loose
					    book in the library. */}
					{!media.isStandalone && <BooksAfterCursor cursor={media.id} />}

					<div className="gap-y-2 flex flex-col">
						<div className="gap-2 flex flex-wrap items-center justify-between">
							<Heading size="sm">Metadata</Heading>
							<BookMetadataMatch mediaId={media.id} />
						</div>
						<MediaMetadataEditor mediaId={media.id} data={media.metadata} />
					</div>
				</div>
			</Suspense>

			{/*Note: There is no permission specific to file info but I am just taking a loose assumption here*/}
			{checkPermission(UserPermission.ManageLibrary) && <BookFileInformation fragment={media} />}
		</>
	)
}
