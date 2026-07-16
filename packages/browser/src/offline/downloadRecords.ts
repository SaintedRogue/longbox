import {
	type DownloadFormat,
	type DownloadQueueItem,
	type DownloadRecord,
	getDB,
	type QueueStatus,
} from './db'

// --- downloads store (completed, offline-readable books) ---

/** Upserts by `bookId` (the store's keyPath) -- a repeat put for the same book overwrites. */
export async function putDownloadRecord(rec: DownloadRecord): Promise<void> {
	const db = await getDB()
	await db.put('downloads', rec)
}

export async function getDownloadRecord(bookId: string): Promise<DownloadRecord | undefined> {
	const db = await getDB()
	return db.get('downloads', bookId)
}

export async function listDownloadRecords(): Promise<DownloadRecord[]> {
	const db = await getDB()
	return db.getAll('downloads')
}

export async function deleteDownloadRecord(bookId: string): Promise<void> {
	const db = await getDB()
	await db.delete('downloads', bookId)
}

export async function isDownloaded(bookId: string): Promise<boolean> {
	return (await getDownloadRecord(bookId)) !== undefined
}

// --- downloadQueue store (pending / in-flight jobs) ---

export type NewQueueItem = {
	bookId: string
	title: string
	format: DownloadFormat
	totalBytes?: number
}

export type EnqueueResult =
	| { status: 'already-downloaded'; record: DownloadRecord }
	| { status: 'already-queued'; item: DownloadQueueItem }
	| { status: 'enqueued'; item: DownloadQueueItem }

/**
 * Dedup rule (parity with Expo):
 *  - if a DownloadRecord already exists for bookId -> already-downloaded, add NOTHING
 *  - else if a queue item already exists for bookId (any status) -> already-queued
 *  - else create a new pending item -> enqueued
 * Runs the downloads-lookup, queue-lookup, and (if needed) the insert in one readwrite
 * transaction spanning both stores so a concurrent addQueueItem for the same book can't
 * race between the check and the add and produce a duplicate row.
 */
export async function addQueueItem(item: NewQueueItem): Promise<EnqueueResult> {
	const db = await getDB()
	const tx = db.transaction(['downloads', 'downloadQueue'], 'readwrite')
	const [downloads, queue] = [tx.objectStore('downloads'), tx.objectStore('downloadQueue')]

	const existingRecord = await downloads.get(item.bookId)
	if (existingRecord) {
		await tx.done
		return { status: 'already-downloaded', record: existingRecord }
	}

	const existingQueueItem = (await queue.getAll()).find((row) => row.bookId === item.bookId)
	if (existingQueueItem) {
		await tx.done
		return { status: 'already-queued', item: existingQueueItem }
	}

	const newItem: DownloadQueueItem = {
		bookId: item.bookId,
		title: item.title,
		format: item.format,
		totalBytes: item.totalBytes,
		status: 'pending',
		receivedBytes: 0,
		createdAt: Date.now(),
	}
	const id = await queue.add(newItem)
	const stored = await queue.get(id)
	await tx.done

	// `stored` is guaranteed to exist -- it was just added in this same transaction.
	return { status: 'enqueued', item: stored as DownloadQueueItem }
}

export async function getQueueItem(id: number): Promise<DownloadQueueItem | undefined> {
	const db = await getDB()
	return db.get('downloadQueue', id)
}

/** No dedicated index for bookId (schema is fixed at v2); the queue is small so a full scan is fine. */
export async function getQueueItemByBook(bookId: string): Promise<DownloadQueueItem | undefined> {
	const db = await getDB()
	const all = await db.getAll('downloadQueue')
	return all.find((row) => row.bookId === bookId)
}

export async function listQueueItems(): Promise<DownloadQueueItem[]> {
	const db = await getDB()
	return db.getAll('downloadQueue')
}

export async function listQueueItemsByStatus(status: QueueStatus): Promise<DownloadQueueItem[]> {
	const db = await getDB()
	return db.getAllFromIndex('downloadQueue', 'by-status', status)
}

/** Read-modify-write inside one readwrite transaction so a partial patch doesn't clobber unspecified fields. */
export async function updateQueueItem(
	id: number,
	patch: Partial<Omit<DownloadQueueItem, 'id'>>,
): Promise<void> {
	const db = await getDB()
	const tx = db.transaction('downloadQueue', 'readwrite')
	const existing = await tx.store.get(id)
	if (!existing) {
		await tx.done
		return
	}
	await tx.store.put({ ...existing, ...patch, id })
	await tx.done
}

export async function deleteQueueItem(id: number): Promise<void> {
	const db = await getDB()
	await db.delete('downloadQueue', id)
}
