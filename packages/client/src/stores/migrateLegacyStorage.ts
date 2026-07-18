/**
 * One-time migration for the rebrand: any `localStorage` key that starts with the legacy
 * server-name prefix (a dash or colon delimiter) is copied over to its current equivalent
 * (unless that key is already set, in which case the existing value wins), and the legacy key
 * is always removed.
 *
 * This is a prefix scan rather than an enumerated key list so it transparently handles dynamic
 * keys too, e.g. a per-entity layout store key or a per-id dismissal flag.
 *
 * Safe to call multiple times (idempotent) and safe to call when there is nothing to migrate.
 */
const LEGACY_PREFIX = 'stump'
const CURRENT_PREFIX = 'longbox'
const legacyKeyPattern = new RegExp(`^${LEGACY_PREFIX}[-:]`)

export function migrateLegacyStorage(storage: Storage = localStorage): void {
	const legacyKeys: string[] = []
	for (let i = 0; i < storage.length; i++) {
		const key = storage.key(i)
		if (key && legacyKeyPattern.test(key)) {
			legacyKeys.push(key)
		}
	}

	for (const oldKey of legacyKeys) {
		const newKey = `${CURRENT_PREFIX}${oldKey.slice(LEGACY_PREFIX.length)}`

		if (storage.getItem(newKey) === null) {
			const value = storage.getItem(oldKey)
			if (value !== null) {
				storage.setItem(newKey, value)
			}
		}

		storage.removeItem(oldKey)
	}
}
