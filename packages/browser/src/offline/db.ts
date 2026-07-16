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

export interface LongboxOfflineDB extends DBSchema {
	progressOutbox: {
		key: string
		value: ProgressOutboxRecord
		indexes: { 'by-status': OutboxStatus }
	}
}

const DB_NAME = 'longbox-offline'
const DB_VERSION = 1

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
