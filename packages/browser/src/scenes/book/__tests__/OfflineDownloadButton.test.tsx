import type { BookCardFragment } from '@longbox/graphql'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import type { DownloadRecord } from '@/offline/db'
import * as downloadManagerModule from '@/offline/downloadManager'
import { useDownloadStore } from '@/offline/downloadStore'

import OfflineDownloadButton, { selectDownloadButtonState } from '../OfflineDownloadButton'

jest.mock('@longbox/i18n', () => ({
	useLocaleContext: () => ({ t: (key: string) => key }),
}))

function makeBook(overrides: Partial<BookCardFragment> = {}): BookCardFragment {
	return {
		id: 'b1',
		resolvedName: 'Book One',
		extension: 'cbz',
		pages: 20,
		...overrides,
	} as unknown as BookCardFragment
}

function makeRecord(overrides: Partial<DownloadRecord> = {}): DownloadRecord {
	return {
		bookId: 'b1',
		title: 'Book One',
		format: 'cbz',
		pageCount: 20,
		pageUrls: ['/page/1'],
		sizeBytes: 1024,
		downloadedAt: 1000,
		...overrides,
	}
}

describe('selectDownloadButtonState', () => {
	it('is idle with no record and no live entry', () => {
		expect(selectDownloadButtonState(false, undefined)).toBe('idle')
	})

	it('is downloading when live status is pending', () => {
		expect(
			selectDownloadButtonState(false, { bookId: 'b1', status: 'pending', receivedBytes: 0 }),
		).toBe('downloading')
	})

	it('is downloading when live status is downloading', () => {
		expect(
			selectDownloadButtonState(false, {
				bookId: 'b1',
				status: 'downloading',
				receivedBytes: 10,
			}),
		).toBe('downloading')
	})

	it('is failed when live status is failed, even if a stale record exists', () => {
		expect(
			selectDownloadButtonState(true, {
				bookId: 'b1',
				status: 'failed',
				receivedBytes: 0,
				failureReason: 'boom',
			}),
		).toBe('failed')
	})

	it('is downloaded when isDownloaded is true and there is no active live entry', () => {
		expect(selectDownloadButtonState(true, undefined)).toBe('downloaded')
	})

	it('is downloaded when the live entry reflects a completed job', () => {
		expect(
			selectDownloadButtonState(true, { bookId: 'b1', status: 'completed', receivedBytes: 100 }),
		).toBe('downloaded')
	})
})

describe('OfflineDownloadButton', () => {
	beforeEach(() => {
		useDownloadStore.getState().reset()
		jest.restoreAllMocks()
	})

	it('renders nothing when the book has no downloadable format', () => {
		const { container } = render(<OfflineDownloadButton book={makeBook({ extension: 'txt' })} />)
		expect(container).toBeEmptyDOMElement()
	})

	it('idle: renders the download label and enqueues on click', async () => {
		const enqueueSpy = jest
			.spyOn(downloadManagerModule, 'enqueue')
			.mockResolvedValue({ status: 'enqueued', item: {} as never })

		render(<OfflineDownloadButton book={makeBook()} />)

		const button = screen.getByRole('button', { name: /offlineDownload\.download/ })
		await userEvent.click(button)

		expect(enqueueSpy).toHaveBeenCalledWith({
			bookId: 'b1',
			title: 'Book One',
			format: 'cbz',
			pageCount: 20,
		})
	})

	it('downloading: renders progress and cancels on click', async () => {
		const cancelSpy = jest.spyOn(downloadManagerModule, 'cancel').mockResolvedValue(undefined)
		useDownloadStore
			.getState()
			.upsert('b1', { status: 'downloading', receivedBytes: 50, totalBytes: 100 })

		render(<OfflineDownloadButton book={makeBook()} />)

		const button = screen.getByRole('button', { name: /offlineDownload\.downloading/ })
		expect(button).toHaveTextContent('50%')

		await userEvent.click(button)
		expect(cancelSpy).toHaveBeenCalledWith('b1')
	})

	it('downloaded: renders the remove label and removes on click', async () => {
		const removeSpy = jest.spyOn(downloadManagerModule, 'remove').mockResolvedValue(undefined)
		useDownloadStore.getState().setRecord(makeRecord())

		render(<OfflineDownloadButton book={makeBook()} />)

		const button = screen.getByRole('button', { name: /offlineDownload\.remove/ })
		await userEvent.click(button)

		expect(removeSpy).toHaveBeenCalledWith('b1')
	})

	it('failed: renders the retry label and retries on click', async () => {
		const retrySpy = jest.spyOn(downloadManagerModule, 'retry').mockResolvedValue(undefined)
		useDownloadStore
			.getState()
			.upsert('b1', { status: 'failed', receivedBytes: 0, failureReason: 'network error' })

		render(<OfflineDownloadButton book={makeBook()} />)

		const button = screen.getByRole('button', { name: /offlineDownload\.retry/ })
		await userEvent.click(button)

		expect(retrySpy).toHaveBeenCalledWith('b1')
	})
})
