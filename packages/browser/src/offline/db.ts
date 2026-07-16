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

export function getDB(): Promise<IDBPDatabase<LongboxOfflineDB>> {
	return openDB<LongboxOfflineDB>(DB_NAME, DB_VERSION, {
		upgrade(db) {
			if (!db.objectStoreNames.contains('progressOutbox')) {
				const store = db.createObjectStore('progressOutbox', { keyPath: 'bookId' })
				store.createIndex('by-status', 'status')
			}
		},
	})
}
