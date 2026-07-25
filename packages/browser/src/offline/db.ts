import { type DBSchema, type IDBPDatabase, openDB } from 'idb'

export type OutboxStatus = 'UNSYNCED' | 'SYNCING' | 'ERROR'

/** One durable progress record per book, awaiting sync to the server. */
export type ProgressOutboxRecord = {
	bookId: string
	/** Discriminated by reader kind, mirrors MediaProgressInput. */
	kind: 'paged' | 'epub'
	page?: number
	epubcfi?: string
	percentage?: number
	isComplete?: boolean
	/** Accumulated unsynced elapsed seconds to add on the server (additive, safe to replay). */
	elapsedSecondsDelta: number
	status: OutboxStatus
	updatedAt: number
	failureReason?: string
}

export type DownloadFormat = 'cbz' | 'cbr' | 'epub' | 'pdf'

/** A fully-downloaded book available for offline reading. Parity with Expo `downloaded_files`. */
export type DownloadRecord = {
	bookId: string
	seriesId?: string
	title: string
	format: DownloadFormat
	pageCount?: number // comics
	fileUrl?: string // epub/pdf: the /file URL cached in the blob store
	pageUrls?: string[] // comics: the /page URLs cached, in reading order
	thumbnailUrl?: string
	metadataJson?: unknown // denormalized MediaMetadata for offline display
	sizeBytes: number
	downloadedAt: number
}

/**
 * One passive-cache log row per cached URL (comic page or thumbnail), tracking LRU recency plus the
 * cache validators needed to notice that the server's bytes for that (stable) URL have changed.
 *
 * `etag` / `lastValidatedAt` are optional on purpose: rows written before revalidation existed have
 * neither, and both are absent from any index (the only index is `by-last-accessed`, on
 * `lastAccessedAt`, which every row still has). IndexedDB stores records, not a fixed column set, so
 * adding these needs no `DB_VERSION` bump and no migration -- old rows stay valid and simply take
 * the "no stored validator" branch on their first revalidation.
 */
export type PassiveCacheEntry = {
	url: string
	sizeBytes: number
	lastAccessedAt: number
	/** Strong validator (`ETag`) of the response these bytes came from, when the writer had headers in hand. */
	etag?: string
	/** When the server last confirmed these bytes are current (a 304, or a 200 that replaced them). */
	lastValidatedAt?: number
}

/** Singleton row (id is always 'singleton') tracking the running total of passiveCacheEntries' sizeBytes. */
export type PassiveCacheMetaRecord = { id: 'singleton'; totalBytes: number }

export type QueueStatus = 'pending' | 'downloading' | 'completed' | 'failed'

/** A queued/in-flight download job. Parity with Expo `download_queue`. */
export type DownloadQueueItem = {
	id?: number // autoIncrement key
	bookId: string
	title: string
	format: DownloadFormat
	status: QueueStatus
	receivedBytes: number
	totalBytes?: number
	failureReason?: string
	createdAt: number
}

export interface LongboxOfflineDB extends DBSchema {
	progressOutbox: {
		key: string
		value: ProgressOutboxRecord
		indexes: { 'by-status': OutboxStatus }
	}
	downloads: {
		key: string // bookId
		value: DownloadRecord
	}
	downloadQueue: {
		key: number // autoIncrement id
		value: DownloadQueueItem
		indexes: { 'by-status': QueueStatus }
	}
	passiveCacheEntries: {
		key: string // url
		value: PassiveCacheEntry
		indexes: { 'by-last-accessed': number }
	}
	passiveCacheMeta: {
		key: string // always 'singleton'
		value: PassiveCacheMetaRecord
	}
}

const DB_NAME = 'longbox-offline'
const DB_VERSION = 3

// Cached so repeated calls share one connection instead of opening a new one every time:
// an uncached `openDB` per call leaks connections (nothing ever closes them), and a
// still-open connection blocks a later `deleteDB` (used by tests, and potentially by a
// future reset/clear-data flow) indefinitely rather than rejecting it.
let dbPromise: Promise<IDBPDatabase<LongboxOfflineDB>> | null = null

export function getDB(): Promise<IDBPDatabase<LongboxOfflineDB>> {
	if (!dbPromise) {
		dbPromise = openDB<LongboxOfflineDB>(DB_NAME, DB_VERSION, {
			upgrade(db) {
				if (!db.objectStoreNames.contains('progressOutbox')) {
					const store = db.createObjectStore('progressOutbox', { keyPath: 'bookId' })
					store.createIndex('by-status', 'status')
				}
				if (!db.objectStoreNames.contains('downloads')) {
					db.createObjectStore('downloads', { keyPath: 'bookId' })
				}
				if (!db.objectStoreNames.contains('downloadQueue')) {
					const q = db.createObjectStore('downloadQueue', { keyPath: 'id', autoIncrement: true })
					q.createIndex('by-status', 'status')
				}
				if (!db.objectStoreNames.contains('passiveCacheEntries')) {
					const store = db.createObjectStore('passiveCacheEntries', { keyPath: 'url' })
					store.createIndex('by-last-accessed', 'lastAccessedAt')
				}
				if (!db.objectStoreNames.contains('passiveCacheMeta')) {
					db.createObjectStore('passiveCacheMeta', { keyPath: 'id' })
				}
			},
		})
	}
	return dbPromise
}

/** Test-only: close and forget the cached connection so the next `getDB()` reopens fresh. */
export async function _resetDBForTests(): Promise<void> {
	const pending = dbPromise
	dbPromise = null
	if (pending) {
		const db = await pending
		db.close()
	}
}
