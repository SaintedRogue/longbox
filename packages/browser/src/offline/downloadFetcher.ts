import type { Api } from '@stump/sdk'

import * as blobStore from './blobStore'
import type { DownloadFetcher, DownloadFetchResult } from './downloadManager'

/** Storage sink -- injectable so tests never construct a real Response / touch a real Cache. */
export type FetcherDeps = {
	putBlob: (url: string, blob: Blob) => Promise<void>
	deleteUrls: (urls: string[]) => Promise<void>
}

// Default deps: the ONLY place a real Response is constructed (live-verified at the gate).
export const defaultFetcherDeps: FetcherDeps = {
	putBlob: (url, blob) => blobStore.putUrl(url, new Response(blob)),
	deleteUrls: (urls) => blobStore.deleteUrls(urls),
}

/**
 * Build the real fetcher, closing over an authenticated SDK. Fetches every byte via
 * `sdk.axios.get(url, { responseType: 'blob' })` -- never a bare `fetch`/anchor -- so the request
 * interceptor attaches auth in both session (cookie) and token/api-key mode (see stream4-interfaces
 * A1). Task 4.3 registers the result via `setDownloadFetcher`.
 */
export function createDownloadFetcher(
	sdk: Api,
	deps: FetcherDeps = defaultFetcherDeps,
): DownloadFetcher {
	return async (job, onProgress, signal) => {
		// Every URL actually stored this run, so a throw (incl. abort) anywhere below can be
		// unwound with best-effort partial cleanup -- no orphaned blobs for a cancelled/failed job.
		const storedUrls: string[] = []
		let sizeBytes = 0
		let thumbnailUrl: string | undefined

		try {
			// Thumbnail (both formats), best-effort: a missing thumbnail must not fail the download.
			try {
				const url = sdk.media.thumbnailURL(job.bookId)
				const resp = await sdk.axios.get(url, { responseType: 'blob', signal })
				await deps.putBlob(url, resp.data)
				storedUrls.push(url)
				sizeBytes += resp.data.size
				thumbnailUrl = url
			} catch (err) {
				// Only swallow a genuine thumbnail failure; an abort must still propagate so the
				// manager classifies the whole job as cancelled.
				if (signal.aborted) throw err
			}

			if (job.format === 'epub' || job.format === 'pdf') {
				const fileUrl = sdk.media.downloadURL(job.bookId)
				const resp = await sdk.axios.get(fileUrl, {
					responseType: 'blob',
					signal,
					onDownloadProgress: (event: { loaded: number; total?: number }) =>
						onProgress(event.loaded, event.total),
				})
				await deps.putBlob(fileUrl, resp.data)
				storedUrls.push(fileUrl)
				sizeBytes += resp.data.size
				onProgress(resp.data.size, resp.data.size)

				const result: DownloadFetchResult = { fileUrl, thumbnailUrl, sizeBytes }
				return result
			}

			// Comics: page-by-page, in order. Total bytes are unknown up front (no content-length
			// summed across pages), so progress reports cumulative received bytes only.
			const pageUrls: string[] = []
			let received = 0
			const pageCount = job.pageCount ?? 0
			for (let page = 1; page <= pageCount; page++) {
				if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
				const url = sdk.media.bookPageURL(job.bookId, page)
				const resp = await sdk.axios.get(url, { responseType: 'blob', signal })
				await deps.putBlob(url, resp.data)
				storedUrls.push(url)
				pageUrls.push(url)
				received += resp.data.size
				sizeBytes += resp.data.size
				onProgress(received)
			}

			const result: DownloadFetchResult = { pageUrls, thumbnailUrl, sizeBytes }
			return result
		} catch (err) {
			await deps.deleteUrls(storedUrls).catch(() => {})
			throw err
		}
	}
}
