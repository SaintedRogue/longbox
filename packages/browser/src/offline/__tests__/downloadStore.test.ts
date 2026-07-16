import { useDownloadStore } from '../downloadStore'

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
})
