import 'fake-indexeddb/auto'

import { useSDK } from '@stump/client'
import { act, renderHook, waitFor } from '@testing-library/react'
import { deleteDB } from 'idb'

import { _resetDBForTests, type DownloadRecord } from '../db'
// Namespace import (alongside the named import below) so `jest.spyOn` intercepts the call
// `useRegisterDownloadFetcher` makes via its own named import -- same trick used in
// downloadManager.test.ts for downloadRecords.
import * as downloadManagerModule from '../downloadManager'
import { putDownloadRecord } from '../downloadRecords'
import { useDownloadStore } from '../downloadStore'
import {
	useDownloadActions,
	useDownloadsList,
	useDownloadState,
	useHydrateDownloads,
	useIsDownloaded,
	useRegisterDownloadFetcher,
} from '../useDownloads'

jest.mock('@stump/client', () => ({
	useSDK: jest.fn(),
}))

function makeRecord(overrides: Partial<DownloadRecord> = {}): DownloadRecord {
	return {
		bookId: 'b1',
		title: 'Book One',
		format: 'cbz',
		pageCount: 20,
		pageUrls: ['/page/1', '/page/2'],
		sizeBytes: 1024,
		downloadedAt: 1000,
		...overrides,
	}
}

describe('useDownloads selector hooks', () => {
	beforeEach(() => {
		useDownloadStore.getState().reset()
	})

	it('useDownloadState reflects a live downloads entry', () => {
		const { result, rerender } = renderHook(() => useDownloadState('b1'))
		expect(result.current).toBeUndefined()

		act(() => {
			useDownloadStore.getState().upsert('b1', { status: 'downloading', receivedBytes: 10 })
		})
		rerender()

		expect(result.current).toMatchObject({ status: 'downloading', receivedBytes: 10 })
	})

	it('useIsDownloaded flips true after setRecord and false after removeRecord', () => {
		const { result, rerender } = renderHook(() => useIsDownloaded('b1'))
		expect(result.current).toBe(false)

		act(() => {
			useDownloadStore.getState().setRecord(makeRecord({ bookId: 'b1' }))
		})
		rerender()
		expect(result.current).toBe(true)

		act(() => {
			useDownloadStore.getState().removeRecord('b1')
		})
		rerender()
		expect(result.current).toBe(false)
	})

	it('useDownloadsList returns records sorted by downloadedAt desc', () => {
		const { result, rerender } = renderHook(() => useDownloadsList())
		expect(result.current).toEqual([])

		act(() => {
			useDownloadStore.getState().setRecord(makeRecord({ bookId: 'older', downloadedAt: 100 }))
			useDownloadStore.getState().setRecord(makeRecord({ bookId: 'newest', downloadedAt: 300 }))
			useDownloadStore.getState().setRecord(makeRecord({ bookId: 'middle', downloadedAt: 200 }))
		})
		rerender()

		expect(result.current.map((r) => r.bookId)).toEqual(['newest', 'middle', 'older'])
	})

	it('useDownloadActions returns the manager functions directly (stable across re-renders)', () => {
		const { result, rerender } = renderHook(() => useDownloadActions())
		const first = result.current
		expect(first.enqueue).toBe(downloadManagerModule.enqueue)
		expect(first.cancel).toBe(downloadManagerModule.cancel)
		expect(first.retry).toBe(downloadManagerModule.retry)
		expect(first.remove).toBe(downloadManagerModule.remove)

		rerender()
		expect(result.current).toBe(first)
	})
})

describe('useRegisterDownloadFetcher', () => {
	beforeEach(() => {
		jest.clearAllMocks()
	})

	it('registers a fetcher backed by the current SDK on mount', () => {
		const sdk = { axios: {}, media: {} } as unknown as ReturnType<typeof useSDK>['sdk']
		jest.mocked(useSDK).mockReturnValue({ sdk } as ReturnType<typeof useSDK>)
		const setSpy = jest.spyOn(downloadManagerModule, 'setDownloadFetcher')

		renderHook(() => useRegisterDownloadFetcher())

		expect(setSpy).toHaveBeenCalledTimes(1)
		expect(setSpy.mock.calls[0]?.[0]).toEqual(expect.any(Function))
	})

	it('re-registers when the SDK instance changes', () => {
		const sdkA = { axios: {}, media: {} } as unknown as ReturnType<typeof useSDK>['sdk']
		const sdkB = { axios: {}, media: {} } as unknown as ReturnType<typeof useSDK>['sdk']
		const mockedUseSDK = jest.mocked(useSDK)
		mockedUseSDK.mockReturnValue({ sdk: sdkA } as ReturnType<typeof useSDK>)
		const setSpy = jest.spyOn(downloadManagerModule, 'setDownloadFetcher')

		const { rerender } = renderHook(() => useRegisterDownloadFetcher())
		expect(setSpy).toHaveBeenCalledTimes(1)

		mockedUseSDK.mockReturnValue({ sdk: sdkB } as ReturnType<typeof useSDK>)
		rerender()

		expect(setSpy).toHaveBeenCalledTimes(2)
	})
})

describe('useHydrateDownloads', () => {
	beforeEach(async () => {
		await _resetDBForTests()
		await deleteDB('longbox-offline')
		useDownloadStore.getState().reset()
	})

	it('hydrates the records store from IndexedDB on mount', async () => {
		await putDownloadRecord(makeRecord({ bookId: 'b1' }))
		await putDownloadRecord(makeRecord({ bookId: 'b2' }))

		renderHook(() => useHydrateDownloads())

		await waitFor(() => {
			expect(Object.keys(useDownloadStore.getState().records).sort()).toEqual(['b1', 'b2'])
		})
	})
})
