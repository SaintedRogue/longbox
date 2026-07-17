/**
 * Resolve the 1-indexed page the reader should open on.
 *
 * Precedence: an explicit one-shot `startPage` (router state, e.g. "Read from beginning")
 * wins over saved reading progress, which wins over the default first page. The result is
 * clamped into the book's real page range so a stale progress value can never open an
 * out-of-range page.
 */
export function resolveInitialPage(
	startPage: number | undefined,
	progressPage: number | null | undefined,
	pages: number,
): number {
	const desired = startPage ?? progressPage ?? 1
	const lastPage = Math.max(1, pages)
	return Math.min(Math.max(1, desired), lastPage)
}
