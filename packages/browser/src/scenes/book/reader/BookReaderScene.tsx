import {
	ARCHIVE_EXTENSION,
	EBOOK_EXTENSION,
	PDF_EXTENSION,
	useGraphQLMutation,
	useSDK,
	useSuspenseGraphQL,
} from '@longbox/client'
import { BookReaderSceneQuery, graphql } from '@longbox/graphql'
import { useLocaleContext } from '@longbox/i18n'
import { useQueryClient } from '@tanstack/react-query'
import { Suspense, useCallback, useEffect, useMemo, useRef } from 'react'
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'

import { ImageBasedReader } from '@/components/readers/imageBased'
import { UPDATE_READ_PROGRESS } from '@/offline/progressMutation'
import { enqueueProgress } from '@/offline/progressOutbox'
import paths from '@/paths'

import { resolveInitialPage } from './resolveInitialPage'

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

type Props = {
	book: NonNullable<BookReaderSceneQuery['mediaById']>
}

export function BookReaderScene({ book }: Props) {
	const navigate = useNavigate()
	const [search] = useSearchParams()
	const location = useLocation()
	const startPage = (location.state as { startPage?: number } | null)?.startPage

	const { sdk } = useSDK()
	const { t } = useLocaleContext()

	const isIncognito = search.get('incognito') === 'true'
	const isStreaming = !search.get('stream') || search.get('stream') === 'true'
	const lastSyncedElapsedRef = useRef(book?.readProgress?.elapsedSeconds ?? 0)
	// Sequence number of the most recently *fired* progress mutation. A mutation still
	// retrying after backoff checks this before each retry: if a newer page's mutation has
	// since fired, the stale one gives up instead of risking landing after — and
	// regressing — the newer page on the server, which does an absolute overwrite of
	// end_page with no ordering guard.
	const latestProgressSeqRef = useRef(0)

	const { mutate } = useGraphQLMutation(UPDATE_READ_PROGRESS)

	const fireProgressMutation = useCallback(
		// Named function expression so the retry below can recurse on its own name rather than the
		// outer const, which would be a forward reference react-compiler rejects.
		function fireProgressMutation(
			variables: Parameters<typeof mutate>[0],
			outboxRecord: Parameters<typeof enqueueProgress>[0],
			seq: number,
			retryCount: number,
		) {
			mutate(variables, {
				onError: (err) => {
					const supersededByNewerUpdate = seq !== latestProgressSeqRef.current
					if (!supersededByNewerUpdate && retryCount < 3) {
						const delay = Math.min(1000 * 2 ** retryCount, 15_000)
						setTimeout(
							() => fireProgressMutation(variables, outboxRecord, seq, retryCount + 1),
							delay,
						)
						return
					}

					console.error(err)
					// Only the newest in-flight mutation's terminal failure is worth surfacing;
					// an older, superseded one silently gives up in favor of the newer attempt.
					if (!supersededByNewerUpdate) {
						// Retries are exhausted -- durably queue the update so it isn't lost; the
						// outbox flush hook (useProgressOutbox, mounted in AppLayout) replays it
						// once the app is back online.
						enqueueProgress(outboxRecord).catch((enqueueError) =>
							console.error('Failed to enqueue offline reading progress', enqueueError),
						)
						toast.error(t('readerToasts.progressSavedOffline'))
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
			// double-counted by a concurrent in-flight mutation for a different page. The
			// offline outbox (see fireProgressMutation's onError below) only durably queues a
			// *terminal* failure's own delta -- a superseded, still-retrying mutation's delta
			// is not folded in and remains undercounted by this tradeoff.
			lastSyncedElapsedRef.current = elapsedSeconds

			const elapsedSecondsDelta = delta > 0 ? delta : undefined
			const seq = ++latestProgressSeqRef.current
			fireProgressMutation(
				{
					id: book.id,
					input: {
						paged: {
							page,
							elapsedSecondsDelta,
						},
					},
				},
				{
					bookId: book.id,
					kind: 'paged',
					page,
					elapsedSecondsDelta: elapsedSecondsDelta ?? 0,
				},
				seq,
				0,
			)
		},
		[book, isIncognito, fireProgressMutation],
	)

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

	const initialPage = useMemo(
		() => resolveInitialPage(startPage, book.readProgress?.page, book.pages),
		[startPage, book.readProgress?.page, book.pages],
	)

	// `startPage` is a one-shot restart signal (e.g. "Read from beginning") carried in router
	// state. BrowserRouter persists history state across a full reload, and — now that page turns
	// no longer rewrite the URL — nothing else overwrites this entry's state. So once it has seeded
	// the initial page, clear it; otherwise refreshing (or navigating Forward back into this same
	// entry) would keep forcing the start page instead of resuming saved progress.
	const startPageCleared = useRef(false)
	useEffect(() => {
		if (startPage == null || startPageCleared.current) return
		// Books that redirect away (epub / non-streaming pdf) never consume startPage here; let the
		// redirect own the navigation instead of racing it with a state-clearing replace.
		const willRedirect =
			!!book.extension.match(EBOOK_EXTENSION) ||
			(!!book.extension.match(PDF_EXTENSION) && !isStreaming)
		if (willRedirect) return
		startPageCleared.current = true
		navigate(`${location.pathname}${location.search}`, {
			replace: true,
			state: { ...(location.state as Record<string, unknown> | null), startPage: undefined },
		})
	}, [
		startPage,
		book.extension,
		isStreaming,
		navigate,
		location.pathname,
		location.search,
		location.state,
	])

	useEffect(() => {
		if (book.extension.match(EBOOK_EXTENSION)) {
			navigate(
				paths.bookReader(book.id, {
					epubcfi: book.readProgress?.epubcfi || null,
					isEpub: true,
				}),
				{ replace: true },
			)
		} else if (book.extension.match(PDF_EXTENSION) && !isStreaming) {
			navigate(paths.bookReader(book.id, { isPdf: true, isStreaming: false }), { replace: true })
		}
	}, [book, navigate, isStreaming])

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
