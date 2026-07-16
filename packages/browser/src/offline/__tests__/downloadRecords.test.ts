import 'fake-indexeddb/auto'

import { deleteDB } from 'idb'

import { _resetDBForTests, type DownloadRecord } from '../db'
import {
	addQueueItem,
	deleteDownloadRecord,
	deleteQueueItem,
	getDownloadRecord,
	getQueueItem,
	getQueueItemByBook,
	isDownloaded,
	listDownloadRecords,
	listQueueItems,
	listQueueItemsByStatus,
	putDownloadRecord,
	updateQueueItem,
} from '../downloadRecords'

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

describe('downloadRecords', () => {
	beforeEach(async () => {
		// `getDB()` caches a single open connection (see db.ts); close it before deleting
		// the database, otherwise the still-open connection from the previous test blocks
		// `deleteDB` indefinitely instead of rejecting it.
		await _resetDBForTests()
		await deleteDB('longbox-offline')
	})

	describe('downloads store', () => {
		it('putDownloadRecord + getDownloadRecord round-trips a full record; upserts on repeat put', async () => {
			const rec = makeRecord()
			await putDownloadRecord(rec)
			expect(await getDownloadRecord('b1')).toEqual(rec)

			const updated = makeRecord({ sizeBytes: 2048 })
			await putDownloadRecord(updated)
			expect(await getDownloadRecord('b1')).toEqual(updated)
			expect(await listDownloadRecords()).toHaveLength(1)
		})

		it('listDownloadRecords returns all; deleteDownloadRecord removes one, leaving the rest', async () => {
			await putDownloadRecord(makeRecord({ bookId: 'b1' }))
			await putDownloadRecord(makeRecord({ bookId: 'b2' }))
			await putDownloadRecord(makeRecord({ bookId: 'b3' }))

			expect(await listDownloadRecords()).toHaveLength(3)

			await deleteDownloadRecord('b2')

			const rows = await listDownloadRecords()
			expect(rows).toHaveLength(2)
			expect(rows.map((r) => r.bookId).sort()).toEqual(['b1', 'b3'])
		})

		it('isDownloaded is true after put, false for an unknown bookId', async () => {
			await putDownloadRecord(makeRecord({ bookId: 'b1' }))
			expect(await isDownloaded('b1')).toBe(true)
			expect(await isDownloaded('unknown')).toBe(false)
		})
	})

	describe('downloadQueue store', () => {
		it('addQueueItem on a fresh book enqueues a new item', async () => {
			const result = await addQueueItem({
				bookId: 'b1',
				title: 'Book One',
				format: 'cbz',
				totalBytes: 4096,
			})

			expect(result.status).toBe('enqueued')
			if (result.status !== 'enqueued') throw new Error('expected enqueued')
			expect(typeof result.item.id).toBe('number')
			expect(result.item).toMatchObject({
				bookId: 'b1',
				title: 'Book One',
				format: 'cbz',
				status: 'pending',
				receivedBytes: 0,
				totalBytes: 4096,
			})
		})

		it('addQueueItem twice for the same book returns already-queued with the same id, no duplicate row', async () => {
			const first = await addQueueItem({ bookId: 'b1', title: 'Book One', format: 'cbz' })
			if (first.status !== 'enqueued') throw new Error('expected enqueued')

			const second = await addQueueItem({ bookId: 'b1', title: 'Book One', format: 'cbz' })
			expect(second.status).toBe('already-queued')
			if (second.status !== 'already-queued') throw new Error('expected already-queued')
			expect(second.item.id).toBe(first.item.id)

			expect(await listQueueItems()).toHaveLength(1)
		})

		it('addQueueItem for a book that already has a DownloadRecord returns already-downloaded, adds nothing', async () => {
			await putDownloadRecord(makeRecord({ bookId: 'b1' }))

			const result = await addQueueItem({ bookId: 'b1', title: 'Book One', format: 'cbz' })
			expect(result.status).toBe('already-downloaded')
			if (result.status !== 'already-downloaded') throw new Error('expected already-downloaded')
			expect(result.record.bookId).toBe('b1')

			expect(await listQueueItems()).toHaveLength(0)
		})

		it('listQueueItemsByStatus filters via the by-status index', async () => {
			const a = await addQueueItem({ bookId: 'b1', title: 'Book One', format: 'cbz' })
			const b = await addQueueItem({ bookId: 'b2', title: 'Book Two', format: 'epub' })
			if (a.status !== 'enqueued' || b.status !== 'enqueued') throw new Error('expected enqueued')

			await updateQueueItem(b.item.id as number, { status: 'downloading' })

			const pending = await listQueueItemsByStatus('pending')
			expect(pending).toHaveLength(1)
			expect(pending[0]?.bookId).toBe('b1')

			const downloading = await listQueueItemsByStatus('downloading')
			expect(downloading).toHaveLength(1)
			expect(downloading[0]?.bookId).toBe('b2')
		})

		it('updateQueueItem patches fields without clobbering the rest', async () => {
			const created = await addQueueItem({
				bookId: 'b1',
				title: 'Book One',
				format: 'cbz',
				totalBytes: 4096,
			})
			if (created.status !== 'enqueued') throw new Error('expected enqueued')
			const id = created.item.id as number

			await updateQueueItem(id, { receivedBytes: 1024, failureReason: 'timeout' })

			const row = await getQueueItem(id)
			expect(row).toMatchObject({
				bookId: 'b1',
				title: 'Book One',
				format: 'cbz',
				totalBytes: 4096,
				receivedBytes: 1024,
				failureReason: 'timeout',
			})
		})

		it('getQueueItemByBook finds by bookId; deleteQueueItem removes it', async () => {
			const created = await addQueueItem({ bookId: 'b1', title: 'Book One', format: 'cbz' })
			if (created.status !== 'enqueued') throw new Error('expected enqueued')
			const id = created.item.id as number

			const found = await getQueueItemByBook('b1')
			expect(found?.id).toBe(id)

			await deleteQueueItem(id)

			expect(await getQueueItemByBook('b1')).toBeUndefined()
			expect(await getQueueItem(id)).toBeUndefined()
		})
	})
})
