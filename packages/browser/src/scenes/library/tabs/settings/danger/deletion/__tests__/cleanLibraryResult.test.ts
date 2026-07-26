import { buildCleanLibraryMessage, CleanLibraryResult } from '../cleanLibraryResult'

// Echo the key back along with any interpolation values, so assertions can check both which
// message was chosen and what it was told to say
const t = (key: string, options?: Record<string, unknown>) =>
	options ? `${key}(${JSON.stringify(options)})` : key

const base: CleanLibraryResult = {
	deletedMediaCount: 0,
	deletedSeriesCount: 0,
	missingFileCount: 0,
	storageUnavailable: false,
	isEmpty: false,
}

const KEY = 'librarySettingsScene.danger-zone/delete.sections.cleanLibrary'

describe('buildCleanLibraryMessage', () => {
	it('calls out stale entries whose files were gone from disk', () => {
		const message = buildCleanLibraryMessage(
			{ ...base, deletedMediaCount: 3, deletedSeriesCount: 1, missingFileCount: 4 },
			t,
		)

		expect(message).toContain(`${KEY}.confirmation.success({"mediaCount":3,"seriesCount":1})`)
		expect(message).toContain(`${KEY}.confirmation.missingFiles({"count":4})`)
	})

	it('omits the stale entry note when nothing was stale', () => {
		const message = buildCleanLibraryMessage({ ...base, deletedSeriesCount: 2 }, t)

		expect(message).not.toContain('missingFiles')
	})

	it('reports a skipped sweep rather than implying the library was healthy', () => {
		// The dangerous misread: unreachable storage must never be summarised as "nothing to
		// clean", or the user will assume their library is fine
		const message = buildCleanLibraryMessage({ ...base, storageUnavailable: true }, t)

		expect(message).toBe(`${KEY}.confirmation.storageUnavailable`)
	})

	it('still reports a skipped sweep alongside records it did remove', () => {
		const message = buildCleanLibraryMessage(
			{ ...base, deletedMediaCount: 1, storageUnavailable: true },
			t,
		)

		expect(message).toContain(`${KEY}.confirmation.success`)
		expect(message).toContain(`${KEY}.confirmation.storageUnavailable`)
	})

	it('distinguishes an empty library from one with nothing to clean', () => {
		expect(buildCleanLibraryMessage({ ...base, isEmpty: true }, t)).toBe(`${KEY}.emptyText`)
		expect(buildCleanLibraryMessage(base, t)).toBe(`${KEY}.confirmation.nothingToDelete`)
	})
})
