import {
	ARCHIVE_EXTENSION,
	EBOOK_EXTENSION,
	PDF_EXTENSION,
	useGraphQLMutation,
	useSDK,
	useSuspenseGraphQL,
} from '@stump/client'
import { BookReaderSceneQuery, graphql, ReadingMode } from '@stump/graphql'
import { useLocaleContext } from '@stump/i18n'
import { useQueryClient } from '@tanstack/react-query'
import { Suspense, useCallback, useEffect, useMemo, useRef } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'

import { ImageBasedReader } from '@/components/readers/imageBased'
import paths from '@/paths'

import { useBookPreferences } from './useBookPreferences'

export const BOOK_READER_SCENE_QUERY = graphql(`
	query BookReaderScene($id: ID!) {
		mediaById(id: $id) {
			id
			resolvedName
			pages
			extension
			readProgress {
				percentageCompleted
				epubcfi
				page
				elapsedSeconds
			}
			libraryConfig {
				defaultReadingImageScaleFit
				defaultReadingMode
				defaultReadingDir
			}
			analysisData {
				dimensions {
					height
					width
				}
			}
			nextInSeries(pagination: { cursor: { limit: 1 } }) {
				nodes {
					id
					name: resolvedName
					thumbnail {
						url
					}
				}
			}
		}
	}
`)

export default function BookReaderSceneContainer() {
	const navigate = useNavigate()

	const { id } = useParams()
	const { sdk } = useSDK()
	const {
		data: { mediaById: media },
	} = useSuspenseGraphQL(BOOK_READER_SCENE_QUERY, sdk.cacheKey('bookReader', [id]), {
		id: id || '',
	})

	useEffect(() => {
		if (!media) {
			navigate(paths.notFound(), { replace: true })
		}
	}, [media, navigate])

	if (!media) {
		return null
	}

	return (
		<Suspense>
			<BookReaderScene book={media} />
		</Suspense>
	)
}

const mutation = graphql(`
	mutation UpdateReadProgress($id: ID!, $input: MediaProgressInput!) {
		updateMediaProgress(id: $id, input: $input) {
			__typename
		}
	}
`)

type Props = {
	book: NonNullable<BookReaderSceneQuery['mediaById']>
}

function BookReaderScene({ book }: Props) {
	const navigate = useNavigate()
	const [search] = useSearchParams()

	const { sdk } = useSDK()
	const { t } = useLocaleContext()

	const page = search.get('page')
	const isIncognito = search.get('incognito') === 'true'
	const isStreaming = !search.get('stream') || search.get('stream') === 'true'
	const lastSyncedElapsedRef = useRef(book?.readProgress?.elapsedSeconds ?? 0)
	// Sequence number of the most recently *fired* progress mutation. A mutation still
	// retrying after backoff checks this before each retry: if a newer page's mutation has
	// since fired, the stale one gives up instead of risking landing after — and
	// regressing — the newer page on the server, which does an absolute overwrite of
	// end_page with no ordering guard.
	const latestProgressSeqRef = useRef(0)

	const { mutate } = useGraphQLMutation(mutation)

	const fireProgressMutation = useCallback(
		(variables: Parameters<typeof mutate>[0], seq: number, retryCount: number) => {
			mutate(variables, {
				onError: (err) => {
					const supersededByNewerUpdate = seq !== latestProgressSeqRef.current
					if (!supersededByNewerUpdate && retryCount < 3) {
						const delay = Math.min(1000 * 2 ** retryCount, 15_000)
						setTimeout(() => fireProgressMutation(variables, seq, retryCount + 1), delay)
						return
					}

					console.error(err)
					// Only the newest in-flight mutation's terminal failure is worth surfacing;
					// an older, superseded one silently gives up in favor of the newer attempt.
					if (!supersededByNewerUpdate) {
						toast.error(t('readerToasts.progressSyncFailed'))
					}
				},
			})
		},
		[mutate, t],
	)

	const updateProgress = useCallback(
		(page: number, elapsedSeconds: number) => {
			if (!book) return
			if (isIncognito) return
			if (book.readProgress?.page === page) return

			const delta = Math.max(0, elapsedSeconds - lastSyncedElapsedRef.current)
			// Advance the baseline optimistically at fire time rather than in onSuccess: if
			// this mutation ultimately fails, its delta is undercounted instead of being
			// double-counted by a concurrent in-flight mutation for a different page. A
			// durable offline outbox (Wave 3) will remove the need for this tradeoff.
			lastSyncedElapsedRef.current = elapsedSeconds

			const seq = ++latestProgressSeqRef.current
			fireProgressMutation(
				{
					id: book.id,
					input: {
						paged: {
							page,
							elapsedSecondsDelta: delta > 0 ? delta : undefined,
						},
					},
				},
				seq,
				0,
			)
		},
		[book, isIncognito, fireProgressMutation],
	)

	const {
		bookPreferences: { readingMode, animatedReader },
	} = useBookPreferences({ book })

	const client = useQueryClient()
	/**
	 * An effect to invalidate the in progress media query when the component unmounts
	 * so that the in progress media list is updated when the user returns to that section
	 */
	useEffect(() => {
		return () => {
			client.invalidateQueries({ exact: false, queryKey: [sdk.cacheKeys.inProgress] })
		}
	}, [sdk, client])

	const initialPage = useMemo(() => (page ? parseInt(page, 10) : undefined), [page])

	useEffect(() => {
		if (book.extension.match(EBOOK_EXTENSION)) {
			navigate(
				paths.bookReader(book.id, {
					epubcfi: book.readProgress?.epubcfi || null,
					isEpub: true,
				}),
			)
		} else if (book.extension.match(PDF_EXTENSION) && !isStreaming) {
			navigate(paths.bookReader(book.id, { isPdf: true, isStreaming: false }))
		} else if (book.extension.match(ARCHIVE_EXTENSION) || book.extension.match(PDF_EXTENSION)) {
			if (!initialPage && readingMode === ReadingMode.Paged && !animatedReader) {
				navigate(paths.bookReader(book.id, { page: 1 }))
			} else if (!!initialPage && initialPage > book.pages) {
				navigate(paths.bookReader(book.id, { page: book.pages }))
			}
		}
	}, [book, initialPage, readingMode, navigate, isStreaming, animatedReader])

	if (book.extension.match(ARCHIVE_EXTENSION) || book.extension.match(PDF_EXTENSION)) {
		return (
			<ImageBasedReader
				media={book}
				isIncognito={isIncognito}
				initialPage={initialPage}
				onProgress={updateProgress}
			/>
		)
	}

	return null
}
