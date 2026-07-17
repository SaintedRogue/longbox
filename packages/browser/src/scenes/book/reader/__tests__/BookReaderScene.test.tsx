import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

import { BookReaderScene } from '../BookReaderScene'

const mockNavigate = jest.fn()
jest.mock('react-router-dom', () => ({
	...jest.requireActual('react-router-dom'),
	useNavigate: () => mockNavigate,
}))
jest.mock('@stump/client', () => ({
	ARCHIVE_EXTENSION: /cbz|cbr|zip|rar/,
	EBOOK_EXTENSION: /epub/,
	PDF_EXTENSION: /pdf/,
	useSDK: () => ({ sdk: { cacheKeys: { inProgress: 'inProgress' }, cacheKey: () => 'k' } }),
	useGraphQLMutation: () => ({ mutate: jest.fn() }),
	useSuspenseGraphQL: jest.fn(),
}))
jest.mock('@stump/graphql', () => ({
	...jest.requireActual('@stump/graphql'),
	graphql: () => ({}),
}))
jest.mock('@stump/i18n', () => ({ useLocaleContext: () => ({ t: (k: string) => k }) }))
jest.mock('@tanstack/react-query', () => ({
	useQueryClient: () => ({ invalidateQueries: jest.fn() }),
}))
jest.mock('@/components/readers/imageBased', () => ({
	ImageBasedReader: ({ initialPage }: { initialPage?: number }) => (
		<div data-testid="reader" data-initial-page={String(initialPage)} />
	),
}))
jest.mock('@/offline/progressMutation', () => ({ UPDATE_READ_PROGRESS: 'M' }))
jest.mock('@/offline/progressOutbox', () => ({ enqueueProgress: jest.fn() }))

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
	beforeEach(() => mockNavigate.mockClear())

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
})
