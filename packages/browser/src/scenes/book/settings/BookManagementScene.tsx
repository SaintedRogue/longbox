import { useGraphQLMutation, useSDK, useSuspenseGraphQL } from '@longbox/client'
import { Alert, AlertDescription, Breadcrumbs, Button, Heading, Text } from '@longbox/components'
import { graphql, UserPermission } from '@longbox/graphql'
import { Construction } from 'lucide-react'
import { Suspense, useCallback, useEffect, useMemo } from 'react'
import { useNavigate, useParams } from 'react-router'

import { SceneContainer } from '@/components/container'
import { useAppContext } from '@/context'
import { useBrowseReturnPath } from '@/hooks/useBrowseHistory'
import paths from '@/paths'
import { browseSceneKey } from '@/stores/browseHistory'

import BookTagEditor from './BookTagEditor'
import BookThumbnailSelector from './BookThumbnailSelector'
import DeleteBook from './DeleteBook'

const query = graphql(`
	query BookManagementScene($id: ID!) {
		mediaById(id: $id) {
			id
			resolvedName
			library {
				id
				name
			}
			series {
				id
				resolvedName
				isLooseRoot
			}
			tags {
				id
				name
			}
			...BookThumbnailSelector
		}
	}
`)

const analyzeMutation = graphql(`
	mutation BookManagementSceneAnalyze($id: ID!) {
		analyzeMedia(id: $id)
	}
`)

export default function BookManagementScene() {
	const navigate = useNavigate()

	const { checkPermission } = useAppContext()

	const { sdk } = useSDK()
	const { id } = useParams()

	const {
		data: { mediaById: book },
	} = useSuspenseGraphQL(query, sdk.cacheKey('mediaById', [id]), {
		id: id ?? '',
	})

	const { data, mutate: analyze, isPending } = useGraphQLMutation(analyzeMutation)

	// Hoisted out of the breadcrumb memo below, where they would be conditional hook calls.
	// Both send you back to the list as you left it rather than to its first page.
	const libraryReturnPath = useBrowseReturnPath(
		browseSceneKey.library(book?.library.id ?? ''),
		paths.librarySeries(book?.library.id ?? ''),
	)
	const seriesReturnPath = useBrowseReturnPath(
		browseSceneKey.series(book?.series.id ?? ''),
		paths.seriesOverview(book?.series.id ?? ''),
	)

	const breadcrumbs = useMemo(() => {
		if (!book) return []

		const { series, library } = book

		return [
			{ label: library.name, to: libraryReturnPath },
			// The library-root bucket is a scan artifact, not a real series -- skip its
			// segment so standalone books read as "Library / Book".
			...(series.isLooseRoot
				? []
				: [
						{
							label: series.resolvedName,
							to: seriesReturnPath,
						},
					]),
			{
				label: book.resolvedName,
				to: paths.bookOverview(book.id),
			},
		]
	}, [book, libraryReturnPath, seriesReturnPath])

	const handleAnalyze = useCallback(() => {
		if (id != null) {
			analyze({ id })
		}
	}, [analyze, id])

	useEffect(() => {
		if (!book) {
			navigate(paths.notFound())
		}
	}, [book, navigate])

	if (!book) {
		return null
	}

	return (
		<SceneContainer>
			<div className="gap-y-6 flex flex-col items-start text-left">
				<div className="gap-y-1.5 flex flex-col">
					<Breadcrumbs segments={breadcrumbs} trailingSlash />
					<Heading size="lg" className="font-bold">
						Manage
					</Heading>

					<Text size="sm" variant="muted">
						Make changes to this book
					</Text>
				</div>

				<Alert variant="warning">
					<Construction />
					<AlertDescription>
						Book management is currently under development and has very limited functionality
					</AlertDescription>
				</Alert>

				{checkPermission(UserPermission.ManageLibrary) && (
					<div className="gap-y-2 flex flex-col">
						<div>
							<Heading size="sm">Analysis</Heading>
							<Text size="sm" variant="muted">
								Re-analyze this book to update metadata from its file
							</Text>
						</div>

						<div>
							<Button
								title={data ? 'Analysis already in progress' : 'Analyze this book'}
								size="default"
								onClick={handleAnalyze}
								disabled={!!data || isPending}
							>
								Analyze Media
							</Button>
						</div>
					</div>
				)}

				{checkPermission(UserPermission.EditMetadata) && (
					<Suspense>
						<BookTagEditor mediaId={book.id} tags={book.tags} />
					</Suspense>
				)}

				{checkPermission(UserPermission.EditThumbnails) && (
					<div className="gap-y-2 flex flex-col">
						<div>
							<Heading size="sm">Thumbnail</Heading>
							<Text size="sm" variant="muted">
								Change the cover image for this book
							</Text>
						</div>

						<BookThumbnailSelector fragment={book} />
					</div>
				)}

				{checkPermission(UserPermission.DeleteLibrary) && (
					<DeleteBook bookId={book.id} bookName={book.resolvedName} seriesId={book.series.id} />
				)}
			</div>
		</SceneContainer>
	)
}
