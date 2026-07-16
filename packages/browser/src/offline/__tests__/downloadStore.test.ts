import type { DownloadRecord } from '../db'
import { useDownloadStore } from '../downloadStore'

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

describe('downloadStore', () => {
	beforeEach(() => {
		useDownloadStore.getState().reset()
	})

	it('starts empty', () => {
		expect(useDownloadStore.getState().downloads).toEqual({})
	})

	it('upsert creates a new entry, defaulting receivedBytes to 0 when not provided', () => {
		useDownloadStore.getState().upsert('b1', { status: 'pending' })

		expect(useDownloadStore.getState().downloads['b1']).toEqual({
			bookId: 'b1',
			status: 'pending',
			receivedBytes: 0,
		})
	})

	it('upsert merges a patch into an existing entry rather than replacing it', () => {
		useDownloadStore
			.getState()
			.upsert('b1', { status: 'downloading', receivedBytes: 10, totalBytes: 100 })
		useDownloadStore.getState().upsert('b1', { status: 'downloading', receivedBytes: 50 })

		expect(useDownloadStore.getState().downloads['b1']).toEqual({
			bookId: 'b1',
			status: 'downloading',
			receivedBytes: 50,
			totalBytes: 100,
		})
	})

	it('upsert on distinct bookIds keeps separate entries', () => {
		useDownloadStore.getState().upsert('b1', { status: 'pending' })
		useDownloadStore.getState().upsert('b2', { status: 'downloading', receivedBytes: 5 })

		expect(Object.keys(useDownloadStore.getState().downloads).sort()).toEqual(['b1', 'b2'])
	})

	it('remove deletes an entry; removing an unknown bookId is a no-op', () => {
		useDownloadStore.getState().upsert('b1', { status: 'pending' })
		useDownloadStore.getState().remove('b1')

		expect(useDownloadStore.getState().downloads['b1']).toBeUndefined()
		expect(() => useDownloadStore.getState().remove('unknown')).not.toThrow()
	})

	it('reset clears all entries', () => {
		useDownloadStore.getState().upsert('b1', { status: 'pending' })
		useDownloadStore.getState().upsert('b2', { status: 'failed', failureReason: 'x' })

		useDownloadStore.getState().reset()

		expect(useDownloadStore.getState().downloads).toEqual({})
	})

	describe('records projection', () => {
		it('starts empty', () => {
			expect(useDownloadStore.getState().records).toEqual({})
		})

		it('hydrateRecords replaces the map wholesale', () => {
			useDownloadStore.getState().setRecord(makeRecord({ bookId: 'stale' }))

			const fresh = [makeRecord({ bookId: 'b1' }), makeRecord({ bookId: 'b2' })]
			useDownloadStore.getState().hydrateRecords(fresh)

			expect(Object.keys(useDownloadStore.getState().records).sort()).toEqual(['b1', 'b2'])
			expect(useDownloadStore.getState().records['stale']).toBeUndefined()
		})

		it('setRecord upserts a single record', () => {
			const record = makeRecord({ bookId: 'b1' })
			useDownloadStore.getState().setRecord(record)

			expect(useDownloadStore.getState().records['b1']).toEqual(record)

			const updated = makeRecord({ bookId: 'b1', sizeBytes: 2048 })
			useDownloadStore.getState().setRecord(updated)

			expect(useDownloadStore.getState().records['b1']).toEqual(updated)
		})

		it('removeRecord deletes an entry; removing an unknown bookId is a no-op', () => {
			useDownloadStore.getState().setRecord(makeRecord({ bookId: 'b1' }))
			useDownloadStore.getState().removeRecord('b1')

			expect(useDownloadStore.getState().records['b1']).toBeUndefined()
			expect(() => useDownloadStore.getState().removeRecord('unknown')).not.toThrow()
		})

		it('reset clears records too', () => {
			useDownloadStore.getState().setRecord(makeRecord({ bookId: 'b1' }))
			useDownloadStore.getState().upsert('b2', { status: 'pending' })

			useDownloadStore.getState().reset()

			expect(useDownloadStore.getState().records).toEqual({})
			expect(useDownloadStore.getState().downloads).toEqual({})
		})
	})
})
