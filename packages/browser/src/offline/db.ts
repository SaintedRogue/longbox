import { type DBSchema, type IDBPDatabase, openDB } from 'idb'

import { purgeUnownedBlobs } from './purgeUnownedBlobs'

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
}

const DB_NAME = 'longbox-offline'
const DB_VERSION = 4

// Cached so repeated calls share one connection instead of opening a new one every time:
// an uncached `openDB` per call leaks connections (nothing ever closes them), and a
// still-open connection blocks a later `deleteDB` (used by tests, and potentially by a
// future reset/clear-data flow) indefinitely rather than rejecting it.
let dbPromise: Promise<IDBPDatabase<LongboxOfflineDB>> | null = null

export function getDB(): Promise<IDBPDatabase<LongboxOfflineDB>> {
	if (!dbPromise) {
		// Set inside `upgrade()` (which can't await CacheStorage work) and acted on once the version
		// change has committed. See the `.then` below.
		let purgeNeeded = false

		dbPromise = openDB<LongboxOfflineDB>(DB_NAME, DB_VERSION, {
			upgrade(db, oldVersion) {
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

				// v4 retires the passive read-through cache. Its two bookkeeping stores go here; the
				// blobs they tracked -- which share the `longbox-offline-v1` bucket with downloads --
				// are cleaned up by `purgeUnownedBlobs` below, since deleting them needs the async
				// Cache API and a version-change transaction can't wait on that.
				deleteRetiredStore(db, 'passiveCacheEntries')
				deleteRetiredStore(db, 'passiveCacheMeta')
				// Only for a database that already existed: a fresh install has no passive residue to
				// purge (and, with no DownloadRecords yet, nothing that could vouch for a blob either).
				if (oldVersion > 0 && oldVersion < 4) {
					purgeNeeded = true
				}
			},
		}).then(async (db) => {
			// Deliberately awaited *inside* the cached promise rather than fired and forgotten: every
			// offline path goes through `getDB()`, so blocking here guarantees the purge finishes
			// before a download job can enqueue and start writing blobs the purge would not recognize.
			// It runs at most once per browser (only a real version change sets the flag) and never
			// throws.
			if (purgeNeeded) await purgeUnownedBlobs(db)
			return db
		})
	}
	return dbPromise
}

/**
 * Drops a store that is no longer part of the schema, if the database still has it.
 *
 * A retired store's name is by definition not a `StoreNames<LongboxOfflineDB>` any more, so the
 * typed handle rejects it; the untyped view is the only way to name it. A no-op for any database
 * that never had the store (a fresh install, or a v1/v2 one from before the passive cache existed).
 */
function deleteRetiredStore(db: IDBPDatabase<LongboxOfflineDB>, name: string): void {
	const untyped = db as unknown as IDBPDatabase
	if (untyped.objectStoreNames.contains(name)) {
		untyped.deleteObjectStore(name)
	}
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
