import { formatBytes, useSDK } from '@stump/client'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'

import type { DownloadRecord } from '@/offline/db'
import * as downloadManagerModule from '@/offline/downloadManager'
import { useDownloadStore } from '@/offline/downloadStore'

import DownloadsScene from '../DownloadsScene'

jest.mock('@stump/i18n', () => ({
	useLocaleContext: () => ({ t: (key: string) => key }),
}))

jest.mock('@stump/client', () => ({
	...jest.requireActual('@stump/client'),
	useSDK: jest.fn(),
}))

function makeRecord(overrides: Partial<DownloadRecord> = {}): DownloadRecord {
	return {
		bookId: 'b1',
		title: 'Book One',
		format: 'cbz',
		pageCount: 20,
		pageUrls: ['/page/1'],
		sizeBytes: 1_000_000,
		downloadedAt: 1000,
		...overrides,
	}
}

describe('DownloadsScene', () => {
	beforeEach(() => {
		useDownloadStore.getState().reset()
		jest.restoreAllMocks()
		jest.mocked(useSDK).mockReturnValue({
			sdk: { isTokenAuth: false },
		} as unknown as ReturnType<typeof useSDK>)
	})

	it('renders the empty state when there are no downloads', () => {
		render(
			<MemoryRouter>
				<DownloadsScene />
			</MemoryRouter>,
		)

		expect(screen.getByText('downloadsScene.emptyState.heading')).toBeInTheDocument()
		expect(screen.getByText('downloadsScene.emptyState.message')).toBeInTheDocument()
	})

	it('renders one row per download record, showing title and formatted size', () => {
		useDownloadStore.getState().setRecord(makeRecord({ bookId: 'b1', title: 'Book One' }))
		useDownloadStore
			.getState()
			.setRecord(
				makeRecord({ bookId: 'b2', title: 'Book Two', sizeBytes: 2_000_000, downloadedAt: 2000 }),
			)

		render(
			<MemoryRouter>
				<DownloadsScene />
			</MemoryRouter>,
		)

		expect(screen.getByText('Book One')).toBeInTheDocument()
		expect(screen.getByText('Book Two')).toBeInTheDocument()
		expect(screen.getByText(formatBytes(1_000_000)!)).toBeInTheDocument()
		expect(screen.getByText(formatBytes(2_000_000)!)).toBeInTheDocument()
		expect(screen.queryByText('downloadsScene.emptyState.heading')).not.toBeInTheDocument()
	})

	it('calls remove(bookId) when the Remove button is clicked', async () => {
		const removeSpy = jest.spyOn(downloadManagerModule, 'remove').mockResolvedValue(undefined)
		useDownloadStore.getState().setRecord(makeRecord({ bookId: 'b1', title: 'Book One' }))

		render(
			<MemoryRouter>
				<DownloadsScene />
			</MemoryRouter>,
		)

		const button = screen.getByRole('button', { name: /offlineDownload\.remove/ })
		await userEvent.click(button)

		expect(removeSpy).toHaveBeenCalledWith('b1')
	})
})
