import type { DownloadFormat } from './db'

/**
 * Derives a `DownloadFormat` from a book's `extension` field. There is no explicit format field on
 * `Media`/`BookCardFragment` (see stream4-interfaces.md A4), so this is the single source of truth
 * for "what kind of file is this, for offline-download purposes" -- both the enqueue button and any
 * future offline-reader code should go through this rather than re-deriving it themselves.
 *
 * Returns `null` when the extension is missing or doesn't map to a downloadable format (e.g. an
 * unsupported/unknown file type), which callers use as the "not offline-downloadable" signal.
 */
export function deriveDownloadFormat(extension?: string): DownloadFormat | null {
	if (!extension) return null

	const normalized = extension.toLowerCase().replace(/^\./, '')

	if (normalized.includes('epub')) return 'epub'
	if (normalized.includes('pdf')) return 'pdf'
	if (normalized.includes('cbz') || normalized.includes('zip')) return 'cbz'
	if (normalized.includes('cbr') || normalized.includes('rar')) return 'cbr'

	return null
}
