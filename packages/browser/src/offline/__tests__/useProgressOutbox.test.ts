import 'fake-indexeddb/auto'

import { useSDK } from '@stump/client'
import { renderHook, waitFor } from '@testing-library/react'
import { deleteDB } from 'idb'

import { _resetDBForTests } from '../db'
import { enqueueProgress, listPending, markErrorIfUnchanged, markSyncing } from '../progressOutbox'
import { useProgressOutbox } from '../useProgressOutbox'

jest.mock('@stump/client', () => ({
	useSDK: jest.fn(),
}))

describe('useProgressOutbox', () => {
	beforeEach(async () => {
		await _resetDBForTests()
		await deleteDB('longbox-offline')
		jest.clearAllMocks()
	})

	it('flushes a pending UNSYNCED row on mount and removes it once synced', async () => {
		await enqueueProgress({ bookId: 'b1', kind: 'paged', page: 5, elapsedSecondsDelta: 30 })

		const execute = jest
			.fn()
			.mockResolvedValue({ updateMediaProgress: { __typename: 'ReadingSession' } })
		jest
			.mocked(useSDK)
			.mockReturnValue({ sdk: { execute } } as unknown as ReturnType<typeof useSDK>)

		renderHook(() => useProgressOutbox())

		await waitFor(async () => {
			expect(await listPending()).toHaveLength(0)
		})
		expect(execute).toHaveBeenCalledTimes(1)
		expect(execute).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ id: 'b1', input: { paged: { page: 5, elapsedSecondsDelta: 30 } } }),
		)
	})

	it('retries a previously-ERROR row (not permanently excluded)', async () => {
		await enqueueProgress({ bookId: 'b1', kind: 'paged', page: 5, elapsedSecondsDelta: 30 })
		// Simulate a prior failed flush pass having recorded ERROR.
		const syncing = await markSyncing('b1')
		await markErrorIfUnchanged('b1', syncing!.updatedAt, 'previous failure')
		expect((await listPending())[0]?.status).toBe('ERROR')

		const execute = jest
			.fn()
			.mockResolvedValue({ updateMediaProgress: { __typename: 'ReadingSession' } })
		jest
			.mocked(useSDK)
			.mockReturnValue({ sdk: { execute } } as unknown as ReturnType<typeof useSDK>)

		renderHook(() => useProgressOutbox())

		await waitFor(async () => {
			expect(await listPending()).toHaveLength(0)
		})
		expect(execute).toHaveBeenCalledTimes(1)
	})

	it('recovers an orphaned SYNCING row (from a crashed prior flush) and retries it', async () => {
		await enqueueProgress({ bookId: 'b1', kind: 'paged', page: 5, elapsedSecondsDelta: 30 })
		await markSyncing('b1') // orphan: nothing ever recorded an outcome for this SYNCING row
		expect(await listPending()).toHaveLength(0) // excluded until recovered

		const execute = jest
			.fn()
			.mockResolvedValue({ updateMediaProgress: { __typename: 'ReadingSession' } })
		jest
			.mocked(useSDK)
			.mockReturnValue({ sdk: { execute } } as unknown as ReturnType<typeof useSDK>)

		renderHook(() => useProgressOutbox())

		await waitFor(async () => {
			expect(await listPending()).toHaveLength(0)
		})
		expect(execute).toHaveBeenCalledTimes(1)
	})

	it('leaves the row retriable (visible via listPending, not stuck) when the flush fails', async () => {
		await enqueueProgress({ bookId: 'b1', kind: 'paged', page: 5, elapsedSecondsDelta: 30 })

		const execute = jest.fn().mockRejectedValue(new Error('network down'))
		jest
			.mocked(useSDK)
			.mockReturnValue({ sdk: { execute } } as unknown as ReturnType<typeof useSDK>)

		renderHook(() => useProgressOutbox())

		await waitFor(async () => {
			const rows = await listPending()
			expect(rows).toHaveLength(1)
			expect(rows[0]?.status).toBe('ERROR')
			expect(rows[0]?.failureReason).toBe('network down')
		})
	})

	it('does not delete the row if a fresher enqueue supersedes it while the mutation is in flight', async () => {
		await enqueueProgress({ bookId: 'b1', kind: 'paged', page: 20, elapsedSecondsDelta: 5 })

		let resolveExecute: (value: unknown) => void = () => {}
		const execute = jest.fn().mockImplementation(
			() =>
				new Promise((resolve) => {
					resolveExecute = resolve
				}),
		)
		jest
			.mocked(useSDK)
			.mockReturnValue({ sdk: { execute } } as unknown as ReturnType<typeof useSDK>)

		renderHook(() => useProgressOutbox())

		// Wait until the flush has picked up the row and is "in flight" (execute called).
		await waitFor(() => {
			expect(execute).toHaveBeenCalledTimes(1)
		})

		// A fresher update supersedes it while the (still-pending) mutation is in flight.
		await enqueueProgress({ bookId: 'b1', kind: 'paged', page: 25, elapsedSecondsDelta: 3 })

		// The in-flight mutation now resolves successfully -- but for the *stale* page 20 send.
		resolveExecute({ updateMediaProgress: { __typename: 'ReadingSession' } })

		await waitFor(async () => {
			const rows = await listPending()
			expect(rows).toHaveLength(1)
			expect(rows[0]).toMatchObject({ bookId: 'b1', page: 25, status: 'UNSYNCED' })
		})
	})
})
