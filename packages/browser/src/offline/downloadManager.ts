import * as blobStore from './blobStore'
import type { DownloadFormat, DownloadQueueItem } from './db'
import {
	addQueueItem,
	deleteDownloadRecord,
	deleteQueueItem,
	type EnqueueResult,
	getDownloadRecord,
	getQueueItemByBook,
	listQueueItemsByStatus,
	putDownloadRecord,
	updateQueueItem,
} from './downloadRecords'
import { useDownloadStore } from './downloadStore'
import { ensurePersisted } from './persist'

const CONCURRENCY = 2

// --- the fetcher seam (this module defines it; Task 4.2 registers the real implementation) ---

export type DownloadJob = {
	bookId: string
	title: string
	format: DownloadFormat
	/** Comics: number of pages to fetch. */
	pageCount?: number
}

export type DownloadFetchResult = {
	/** Comics: the page URLs stored, in order. */
	pageUrls?: string[]
	/** Epub/pdf: the file URL stored. */
	fileUrl?: string
	thumbnailUrl?: string
	/** Total bytes stored. */
	sizeBytes: number
}

/** Fetches all bytes for a book into the blob store, reporting progress, honoring abort. */
export type DownloadFetcher = (
	job: DownloadJob,
	onProgress: (receivedBytes: number, totalBytes?: number) => void,
	signal: AbortSignal,
) => Promise<DownloadFetchResult>

const defaultFetcher: DownloadFetcher = async () => {
	throw new Error('download fetcher not configured')
}

let currentFetcher: DownloadFetcher = defaultFetcher

/** Register the real fetcher (Task 4.2 calls this at module load; tests inject a stub). */
export function setDownloadFetcher(fetcher: DownloadFetcher): void {
	currentFetcher = fetcher
}

// --- module-level singleton state ---

/** In-flight (downloading) jobs, keyed by bookId -- also doubles as the "claimed" guard for pump(). */
const controllers = new Map<string, AbortController>()
/** The full DownloadJob (incl. pageCount, not persisted on DownloadQueueItem) for the current session. */
const jobMeta = new Map<string, DownloadJob>()
let inFlight = 0
let ensurePersistedCalled = false
// Reentrancy guard: pump() awaits IndexedDB reads, so a concurrent caller (another enqueue(), or a
// job finishing) could otherwise start a second overlapping loop and over-claim concurrency slots.
let pumping = false
let pumpQueued = false

function isAbortError(err: unknown): boolean {
	return err instanceof DOMException && err.name === 'AbortError'
}

/** Test-only: reset all singleton state and restore the default (throwing) fetcher. */
export function _resetManagerForTests(): void {
	controllers.clear()
	jobMeta.clear()
	inFlight = 0
	ensurePersistedCalled = false
	pumping = false
	pumpQueued = false
	currentFetcher = defaultFetcher
}

// --- orchestration ---

/**
 * While a concurrency slot is free and a pending item exists, claims it (synchronously, via the
 * `controllers` map) and starts it. The claim happens before any await inside the loop body so two
 * overlapping iterations can never pick the same item, even though the DB write that flips its
 * status to 'downloading' is still in flight.
 */
async function pump(): Promise<void> {
	if (pumping) {
		pumpQueued = true
		return
	}
	pumping = true
	try {
		while (inFlight < CONCURRENCY) {
			const pendingItems = await listQueueItemsByStatus('pending')
			const next = pendingItems
				.filter((item) => !controllers.has(item.bookId))
				.sort((a, b) => a.createdAt - b.createdAt)[0]
			if (!next) break

			inFlight += 1
			const controller = new AbortController()
			controllers.set(next.bookId, controller)

			// Set the live store synchronously so callers awaiting enqueue()/pump() observe the
			// 'downloading' transition immediately, without waiting on startJob's own DB write.
			useDownloadStore.getState().upsert(next.bookId, {
				status: 'downloading',
				receivedBytes: next.receivedBytes ?? 0,
				totalBytes: next.totalBytes,
			})

			void startJob(next, controller)
		}
	} finally {
		pumping = false
	}
	if (pumpQueued) {
		pumpQueued = false
		await pump()
	}
}

async function startJob(item: DownloadQueueItem, controller: AbortController): Promise<void> {
	const { bookId } = item
	const queueId = item.id as number

	try {
		// cancel() can race pump()'s claim of a pending item: it may delete this queue row (and,
		// as a fallback, abort us -- see cancel()'s own recheck) between pump() setting the
		// controller and this write landing. `updateQueueItem` reports whether the row was still
		// there to patch (no extra round-trip); if not, honor the cancel and bail out via the same
		// cleanup path as an aborted fetch -- no fetcher call, no DownloadRecord.
		const stillQueued = await updateQueueItem(queueId, { status: 'downloading' })
		if (!stillQueued) {
			useDownloadStore.getState().remove(bookId)
			return
		}

		const job: DownloadJob = {
			bookId,
			title: item.title,
			format: item.format,
			pageCount: jobMeta.get(bookId)?.pageCount,
		}

		const onProgress = (receivedBytes: number, totalBytes?: number) => {
			useDownloadStore
				.getState()
				.upsert(bookId, { status: 'downloading', receivedBytes, totalBytes })
		}

		const result = await currentFetcher(job, onProgress, controller.signal)

		const record = {
			bookId,
			title: item.title,
			format: item.format,
			pageCount: job.pageCount,
			pageUrls: result.pageUrls,
			fileUrl: result.fileUrl,
			thumbnailUrl: result.thumbnailUrl,
			sizeBytes: result.sizeBytes,
			downloadedAt: Date.now(),
		}
		await putDownloadRecord(record)
		useDownloadStore.getState().setRecord(record)
		await deleteQueueItem(queueId)
		useDownloadStore.getState().upsert(bookId, {
			status: 'completed',
			receivedBytes: result.sizeBytes,
			totalBytes: result.sizeBytes,
		})
	} catch (err) {
		if (controller.signal.aborted || isAbortError(err)) {
			// Cancellation, not a failure: no record, no leftover queue item.
			await deleteQueueItem(queueId)
			useDownloadStore.getState().remove(bookId)
		} else {
			const failureReason = err instanceof Error ? err.message : String(err)
			await updateQueueItem(queueId, { status: 'failed', failureReason })
			useDownloadStore
				.getState()
				.upsert(bookId, { status: 'failed', failureReason, receivedBytes: item.receivedBytes ?? 0 })
		}
	} finally {
		controllers.delete(bookId)
		jobMeta.delete(bookId)
		inFlight -= 1
		void pump()
	}
}

// --- public API ---

export async function enqueue(job: DownloadJob): Promise<EnqueueResult> {
	const result = await addQueueItem({
		bookId: job.bookId,
		title: job.title,
		format: job.format,
		totalBytes: undefined,
	})

	if (result.status !== 'enqueued') {
		return result
	}

	jobMeta.set(job.bookId, job)

	if (!ensurePersistedCalled) {
		ensurePersistedCalled = true
		await ensurePersisted()
	}

	useDownloadStore.getState().upsert(job.bookId, { status: 'pending', receivedBytes: 0 })

	await pump()

	return result
}

export async function cancel(bookId: string): Promise<void> {
	const controller = controllers.get(bookId)
	if (controller) {
		controller.abort()
		return
	}

	const item = await getQueueItemByBook(bookId)
	if (item && item.id !== undefined) {
		await deleteQueueItem(item.id)
	}

	// pump() can race this: it may claim the (still-pending, per our first check above) item
	// while we were awaiting the reads/deletes above, starting a job whose AbortController we
	// never saw. If that happened, abort it now -- startJob's own abort branch does the rest of
	// the cleanup -- instead of just removing the store entry and letting the now-orphaned job
	// run to completion and silently resurrect it as 'completed'. (And if the claim instead landed
	// *after* this check, startJob's own `updateQueueItem` call -- see its bail-out above -- will
	// find the row we just deleted already gone and bail out on its own, so either ordering closes
	// the race.)
	const racedController = controllers.get(bookId)
	if (racedController) {
		racedController.abort()
		return
	}

	useDownloadStore.getState().remove(bookId)
}

export async function retry(bookId: string): Promise<void> {
	const item = await getQueueItemByBook(bookId)
	if (!item || item.id === undefined || item.status !== 'failed') return

	await updateQueueItem(item.id, { status: 'pending', failureReason: undefined })
	useDownloadStore
		.getState()
		.upsert(bookId, { status: 'pending', receivedBytes: 0, failureReason: undefined })

	await pump()
}

/** Deletes a completed download's record and blobs. */
export async function remove(bookId: string): Promise<void> {
	const record = await getDownloadRecord(bookId)
	if (record) {
		const urls = [...(record.pageUrls ?? []), record.fileUrl, record.thumbnailUrl].filter(
			(url): url is string => Boolean(url),
		)
		if (urls.length > 0) {
			await blobStore.deleteUrls(urls)
		}
		await deleteDownloadRecord(bookId)
		useDownloadStore.getState().removeRecord(bookId)
	}
	useDownloadStore.getState().remove(bookId)
}
