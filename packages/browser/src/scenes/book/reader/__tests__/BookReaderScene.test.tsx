import { act, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

import { enqueueProgress } from '@/offline/progressOutbox'

import { BookReaderScene } from '../BookReaderScene'

const mockNavigate = jest.fn()
const mockMutateAsync = jest.fn().mockResolvedValue({})
const mockInvalidateQueries = jest.fn()
const mockSetQueryData = jest.fn()
/** Set by the mocked reader so a test can drive a page turn */
let reportProgress: (page: number, elapsedSeconds: number) => void = () => {}

jest.mock('react-router-dom', () => ({
	...jest.requireActual('react-router-dom'),
	useNavigate: () => mockNavigate,
}))
jest.mock('@longbox/client', () => ({
	ARCHIVE_EXTENSION: /cbz|cbr|zip|rar/,
	EBOOK_EXTENSION: /epub/,
	PDF_EXTENSION: /pdf/,
	useSDK: () => ({
		sdk: {
			cacheKeys: { inProgress: 'inProgress' },
			cacheKey: (key: string, args: unknown[]) => [key, ...args],
		},
	}),
	useGraphQLMutation: () => ({ mutateAsync: mockMutateAsync }),
	useSuspenseGraphQL: jest.fn(),
}))
jest.mock('@longbox/graphql', () => ({
	...jest.requireActual('@longbox/graphql'),
	graphql: () => ({}),
}))
jest.mock('@longbox/i18n', () => ({ useLocaleContext: () => ({ t: (k: string) => k }) }))
jest.mock('@tanstack/react-query', () => ({
	useQueryClient: () => ({
		invalidateQueries: mockInvalidateQueries,
		setQueryData: mockSetQueryData,
	}),
}))
jest.mock('@/components/readers/imageBased', () => ({
	ImageBasedReader: ({
		initialPage,
		onProgress,
	}: {
		initialPage?: number
		onProgress?: (page: number, elapsedSeconds: number) => void
	}) => {
		reportProgress = (page, elapsedSeconds) => onProgress?.(page, elapsedSeconds)
		return <div data-testid="reader" data-initial-page={String(initialPage)} />
	},
}))
jest.mock('@/offline/progressMutation', () => ({ UPDATE_READ_PROGRESS: 'M' }))
jest.mock('@/offline/progressOutbox', () => ({
	enqueueProgress: jest.fn().mockResolvedValue(undefined),
}))

const makeBook = (over: Record<string, unknown> = {}) =>
	({
		id: '1',
		resolvedName: 'Comic',
		pages: 10,
		extension: 'cbz',
		readProgress: { page: 5, epubcfi: null, percentageCompleted: 50, elapsedSeconds: 0 },
		...over,
	}) as unknown as Parameters<typeof BookReaderScene>[0]['book']

const renderScene = (state?: { startPage?: number }, book = makeBook()) =>
	render(
		<MemoryRouter initialEntries={[{ pathname: '/books/1/reader', search: '', state }]}>
			<BookReaderScene book={book} />
		</MemoryRouter>,
	)

describe('BookReaderScene', () => {
	beforeEach(() => {
		jest.clearAllMocks()
		mockMutateAsync.mockResolvedValue({})
	})

	it('resumes from saved progress when there is no startPage', () => {
		renderScene()
		expect(screen.getByTestId('reader')).toHaveAttribute('data-initial-page', '5')
		expect(mockNavigate).not.toHaveBeenCalled() // no page-push navigate for a normal comic
	})

	it('prefers a one-shot startPage over saved progress (Read from beginning)', () => {
		renderScene({ startPage: 1 })
		expect(screen.getByTestId('reader')).toHaveAttribute('data-initial-page', '1')
	})

	it('clamps a stale progress page to the last page', () => {
		renderScene(
			undefined,
			makeBook({
				readProgress: { page: 99, epubcfi: null, percentageCompleted: 100, elapsedSeconds: 0 },
			}),
		)
		expect(screen.getByTestId('reader')).toHaveAttribute('data-initial-page', '10')
	})

	it('clears startPage from history state after consuming it, so a reload resumes from progress', () => {
		renderScene({ startPage: 1 })
		expect(mockNavigate).toHaveBeenCalledWith(
			'/books/1/reader',
			expect.objectContaining({
				replace: true,
				state: expect.objectContaining({ startPage: undefined }),
			}),
		)
	})

	/**
	 * The reader seeds its page from this query once, at mount. Progress is saved by a mutation
	 * that returns nothing the cache can be updated from, so leaving the entry untouched meant
	 * re-opening a book inside `gcTime` resumed from the page it was *opened* at.
	 */
	describe('leaving the reader', () => {
		it('rewrites its own cached query with the page the book was left on', async () => {
			const { unmount } = renderScene()

			act(() => reportProgress(8, 120))
			unmount()

			expect(mockSetQueryData).toHaveBeenCalledWith(['bookReader', '1'], expect.any(Function))
			const patch = mockSetQueryData.mock.calls[0]?.[1]
			expect(patch({ mediaById: { id: '1', readProgress: null } })).toEqual(
				expect.objectContaining({
					mediaById: expect.objectContaining({
						readProgress: expect.objectContaining({ page: 8 }),
					}),
				}),
			)
		})

		/**
		 * Progress used to be deduped against `book.readProgress.page`, which is fixed at mount --
		 * so paging back to the page the book was opened at looked like "no change" and was skipped
		 * entirely, leaving the resume point on a page the user had already moved off.
		 */
		it('records a page the book was opened at after reading past it and back', async () => {
			const { unmount } = renderScene() // opens on page 5

			act(() => reportProgress(8, 60))
			act(() => reportProgress(5, 90))
			unmount()

			const patch = mockSetQueryData.mock.calls.at(-1)?.[1]
			expect(patch({ mediaById: { id: '1', pages: 10, readProgress: null } })).toEqual(
				expect.objectContaining({
					mediaById: expect.objectContaining({
						readProgress: expect.objectContaining({ page: 5 }),
					}),
				}),
			)
		})

		it('does not re-send a page it just reported', () => {
			renderScene()

			act(() => reportProgress(8, 60))
			act(() => reportProgress(8, 90))

			expect(mockMutateAsync).toHaveBeenCalledTimes(1)
		})

		it('invalidates that query so the next open reconciles with the server', () => {
			const { unmount } = renderScene()

			act(() => reportProgress(8, 120))
			unmount()

			expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['bookReader', '1'] })
		})

		it('leaves the cache alone when no page was ever reported', () => {
			renderScene().unmount()
			expect(mockSetQueryData).not.toHaveBeenCalled()
		})

		/**
		 * react-query only runs a `mutate()` call's own callbacks while the caller is still
		 * mounted, which silently dropped the retry *and* the offline outbox for the last page
		 * turn of a session -- the one that matters most.
		 */
		it('still queues a failed write to the offline outbox after unmounting', async () => {
			mockMutateAsync.mockRejectedValue(new Error('offline'))
			jest.useFakeTimers()

			try {
				const { unmount } = renderScene()
				act(() => reportProgress(8, 120))
				unmount()

				// Three backoff retries (1s, 2s, 4s), each awaiting the rejected promise
				for (let attempt = 0; attempt < 4; attempt++) {
					await act(async () => {
						await Promise.resolve()
						jest.advanceTimersByTime(15_000)
					})
				}

				expect(enqueueProgress).toHaveBeenCalledWith(
					expect.objectContaining({ bookId: '1', page: 8 }),
				)
			} finally {
				jest.useRealTimers()
			}
		})
	})
})
