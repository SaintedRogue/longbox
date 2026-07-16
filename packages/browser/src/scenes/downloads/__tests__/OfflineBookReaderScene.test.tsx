import { ReadingDirection, ReadingImageScaleFit, ReadingMode } from '@stump/graphql'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

import type { DownloadRecord } from '@/offline/db'
import { useDownloadStore } from '@/offline/downloadStore'
import { useReaderStore } from '@/stores'

import OfflineBookReaderScene from '../OfflineBookReaderScene'

jest.mock('@stump/i18n', () => ({
	useLocaleContext: () => ({ t: (key: string) => key }),
}))

jest.mock('@/components/readers/imageBased', () => ({
	ImageBasedReader: ({
		media,
		syncPageToUrl,
	}: {
		media: { id: string; libraryConfig?: { defaultReadingMode?: string } }
		syncPageToUrl?: boolean
	}) => (
		<div
			data-testid="image-based-reader"
			data-sync-page-to-url={String(syncPageToUrl)}
			data-reading-mode={media.libraryConfig?.defaultReadingMode}
		>
			{media.id}
		</div>
	),
}))

jest.mock('@/components/readers/pdf/NativePDFViewer', () => ({
	__esModule: true,
	default: ({ id }: { id: string }) => <div data-testid="native-pdf-viewer">{id}</div>,
}))

function makeRecord(overrides: Partial<DownloadRecord> = {}): DownloadRecord {
	return {
		bookId: 'book-1',
		title: 'Saga Vol. 1',
		format: 'cbz',
		pageCount: 24,
		pageUrls: Array.from({ length: 24 }, (_, i) => `/page/${i}`),
		sizeBytes: 12_345,
		downloadedAt: 1_700_000_000_000,
		...overrides,
	}
}

function renderAt(id: string) {
	return render(
		<MemoryRouter initialEntries={[`/downloads/${id}/read`]}>
			<Routes>
				<Route path="/downloads/:id/read" element={<OfflineBookReaderScene />} />
			</Routes>
		</MemoryRouter>,
	)
}

describe('OfflineBookReaderScene', () => {
	const initialReaderSettings = useReaderStore.getState().settings

	beforeEach(() => {
		useDownloadStore.getState().reset()
		useReaderStore.setState({ settings: initialReaderSettings })
	})

	it('renders ImageBasedReader for a comic (cbz) record', () => {
		useDownloadStore.getState().setRecord(makeRecord({ bookId: 'book-1', format: 'cbz' }))

		renderAt('book-1')

		expect(screen.getByTestId('image-based-reader')).toHaveTextContent('book-1')
		expect(screen.queryByTestId('native-pdf-viewer')).not.toBeInTheDocument()
	})

	it("passes syncPageToUrl={false} and the user's persisted reading prefs to ImageBasedReader", () => {
		useDownloadStore.getState().setRecord(makeRecord({ bookId: 'book-1', format: 'cbz' }))
		useReaderStore.getState().setSettings({
			readingMode: ReadingMode.Paged,
			readingDirection: ReadingDirection.Rtl,
			imageScaling: { scaleToFit: ReadingImageScaleFit.Width },
		})

		renderAt('book-1')

		const reader = screen.getByTestId('image-based-reader')
		expect(reader).toHaveAttribute('data-sync-page-to-url', 'false')
		expect(reader).toHaveAttribute('data-reading-mode', ReadingMode.Paged)
	})

	it('renders ImageBasedReader for a comic (cbr) record', () => {
		useDownloadStore.getState().setRecord(makeRecord({ bookId: 'book-1', format: 'cbr' }))

		renderAt('book-1')

		expect(screen.getByTestId('image-based-reader')).toHaveTextContent('book-1')
	})

	it('renders NativePDFViewer for a pdf record', () => {
		useDownloadStore.getState().setRecord(
			makeRecord({
				bookId: 'book-2',
				format: 'pdf',
				pageCount: undefined,
				pageUrls: undefined,
				fileUrl: '/file/book-2',
			}),
		)

		renderAt('book-2')

		expect(screen.getByTestId('native-pdf-viewer')).toHaveTextContent('book-2')
		expect(screen.queryByTestId('image-based-reader')).not.toBeInTheDocument()
	})

	it('renders the EPUB-unavailable message for an epub record', () => {
		useDownloadStore.getState().setRecord(
			makeRecord({
				bookId: 'book-3',
				format: 'epub',
				pageCount: undefined,
				pageUrls: undefined,
				fileUrl: '/file/book-3',
			}),
		)

		renderAt('book-3')

		expect(screen.getByText('downloadsScene.epubUnavailableOffline')).toBeInTheDocument()
		expect(screen.queryByTestId('image-based-reader')).not.toBeInTheDocument()
		expect(screen.queryByTestId('native-pdf-viewer')).not.toBeInTheDocument()
	})

	it('renders the not-downloaded message when there is no record for the id', () => {
		renderAt('missing-book')

		expect(screen.getByText('downloadsScene.notDownloaded')).toBeInTheDocument()
		expect(screen.queryByTestId('image-based-reader')).not.toBeInTheDocument()
		expect(screen.queryByTestId('native-pdf-viewer')).not.toBeInTheDocument()
	})
})
