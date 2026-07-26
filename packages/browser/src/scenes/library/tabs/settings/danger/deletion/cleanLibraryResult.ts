import { LocaleContextProps } from '@longbox/i18n'

export const CLEAN_LIBRARY_LOCALE_KEY =
	'librarySettingsScene.danger-zone/delete.sections.cleanLibrary'
export const getCleanLibraryKey = (key: string) => `${CLEAN_LIBRARY_LOCALE_KEY}.${key}`

export type CleanLibraryResult = {
	deletedMediaCount: number
	deletedSeriesCount: number
	/** How many removed records were stale: still marked ready, but with no file on disk */
	missingFileCount: number
	/** The server could not read the library root, so no missing-file check was performed */
	storageUnavailable: boolean
	isEmpty: boolean
}

/**
 * Turn a clean result into a sentence a user can act on.
 *
 * Two things must survive into the message: that stale entries (records whose file had
 * silently disappeared) were removed, and that a skipped sweep is a skipped sweep — an
 * unreachable library root means "we could not check", not "nothing was wrong".
 */
export const buildCleanLibraryMessage = (
	result: CleanLibraryResult,
	t: LocaleContextProps['t'],
): string => {
	const { deletedMediaCount, deletedSeriesCount, missingFileCount, storageUnavailable, isEmpty } =
		result

	const storageNote = storageUnavailable
		? t(getCleanLibraryKey('confirmation.storageUnavailable'))
		: ''

	if (deletedMediaCount === 0 && deletedSeriesCount === 0) {
		if (storageNote) return storageNote
		if (isEmpty) return t(getCleanLibraryKey('emptyText'))
		return t(getCleanLibraryKey('confirmation.nothingToDelete'))
	}

	const parts = [
		t(getCleanLibraryKey('confirmation.success'), {
			mediaCount: deletedMediaCount,
			seriesCount: deletedSeriesCount,
		}),
	]

	if (missingFileCount > 0) {
		parts.push(t(getCleanLibraryKey('confirmation.missingFiles'), { count: missingFileCount }))
	}

	if (storageNote) {
		parts.push(storageNote)
	}

	return parts.join(' ')
}
