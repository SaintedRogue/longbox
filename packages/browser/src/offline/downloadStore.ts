import deepEqual from 'deep-equal'
import { produce } from 'immer'
import { createWithEqualityFn } from 'zustand/traditional'

import type { DownloadRecord, QueueStatus } from './db'

/** Live (in-memory) progress for one book's download. Durable state lives in IndexedDB (downloadRecords/downloadQueue). */
export type LiveDownload = {
	bookId: string
	status: QueueStatus
	receivedBytes: number
	totalBytes?: number
	failureReason?: string
}

type DownloadStore = {
	downloads: Record<string, LiveDownload>
	upsert: (bookId: string, patch: Partial<LiveDownload> & { status: QueueStatus }) => void
	remove: (bookId: string) => void
	/** The durable catalog (completed downloads), keyed by bookId. Hydrated from IndexedDB at
	 *  startup and kept in sync by the manager on completion/removal -- see `downloadManager.ts`. */
	records: Record<string, DownloadRecord>
	/** Replaces the records map wholesale. Called once at startup with the IndexedDB contents. */
	hydrateRecords: (records: DownloadRecord[]) => void
	/** Upserts a single record. Called by the manager right after `putDownloadRecord`. */
	setRecord: (record: DownloadRecord) => void
	/** Deletes a single record. Called by the manager right after `deleteDownloadRecord`. */
	removeRecord: (bookId: string) => void
	/** Test hygiene: clear all live entries (and the records projection). */
	reset: () => void
}

/**
 * Live-progress mirror of the downloadManager's queue, keyed by bookId. Mirrors the `useJobStore`
 * pattern (packages/client/src/stores/job.ts): `createWithEqualityFn` + immer `produce` + a Record map.
 * Durable state (the source of truth) lives in IndexedDB via downloadRecords/downloadQueue; this store
 * exists purely so React can subscribe to progress without polling IndexedDB, and so the manager (a
 * plain-TS singleton, no React import) can drive it via `useDownloadStore.getState()`.
 */
export const useDownloadStore = createWithEqualityFn<DownloadStore>(
	(set) => ({
		downloads: {} as Record<string, LiveDownload>,
		upsert: (bookId, patch) =>
			set((state) =>
				produce(state, (draft) => {
					const existing = draft.downloads[bookId]
					draft.downloads[bookId] = {
						bookId,
						receivedBytes: existing?.receivedBytes ?? 0,
						...existing,
						...patch,
					}
				}),
			),
		remove: (bookId) =>
			set((state) =>
				produce(state, (draft) => {
					delete draft.downloads[bookId]
				}),
			),
		records: {} as Record<string, DownloadRecord>,
		hydrateRecords: (records) =>
			set((state) =>
				produce(state, (draft) => {
					draft.records = Object.fromEntries(records.map((record) => [record.bookId, record]))
				}),
			),
		setRecord: (record) =>
			set((state) =>
				produce(state, (draft) => {
					draft.records[record.bookId] = record
				}),
			),
		removeRecord: (bookId) =>
			set((state) =>
				produce(state, (draft) => {
					delete draft.records[bookId]
				}),
			),
		reset: () => set({ downloads: {}, records: {} }),
	}),
	deepEqual,
)
