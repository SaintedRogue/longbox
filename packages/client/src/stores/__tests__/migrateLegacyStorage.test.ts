import { migrateLegacyStorage } from '../migrateLegacyStorage'

describe('migrateLegacyStorage', () => {
	beforeEach(() => {
		localStorage.clear()
	})

	it('copies a legacy stump- key to its longbox- equivalent and removes the old key', () => {
		localStorage.setItem('stump-user-store', '{"v":1}')

		migrateLegacyStorage()

		expect(localStorage.getItem('longbox-user-store')).toBe('{"v":1}')
		expect(localStorage.getItem('stump-user-store')).toBeNull()
	})

	it('migrates dynamic keys, e.g. stump-{id}-layout-store', () => {
		localStorage.setItem('stump-abc-layout-store', '{"layout":"grid"}')

		migrateLegacyStorage()

		expect(localStorage.getItem('longbox-abc-layout-store')).toBe('{"layout":"grid"}')
		expect(localStorage.getItem('stump-abc-layout-store')).toBeNull()
	})

	it('migrates colon-delimited keys, e.g. stump:entity-card-density', () => {
		localStorage.setItem('stump:entity-card-density', 'compact')

		migrateLegacyStorage()

		expect(localStorage.getItem('longbox:entity-card-density')).toBe('compact')
		expect(localStorage.getItem('stump:entity-card-density')).toBeNull()
	})

	it('does not clobber an existing longbox- value, but still removes the legacy key', () => {
		localStorage.setItem('longbox-user-store', '{"v":"new"}')
		localStorage.setItem('stump-user-store', '{"v":"old"}')

		migrateLegacyStorage()

		expect(localStorage.getItem('longbox-user-store')).toBe('{"v":"new"}')
		expect(localStorage.getItem('stump-user-store')).toBeNull()
	})

	it('is idempotent when run twice', () => {
		localStorage.setItem('stump-user-store', '{"v":1}')

		migrateLegacyStorage()
		migrateLegacyStorage()

		expect(localStorage.getItem('longbox-user-store')).toBe('{"v":1}')
		expect(localStorage.getItem('stump-user-store')).toBeNull()
	})

	it('leaves unrelated keys untouched', () => {
		localStorage.setItem('some-other-key', 'unrelated')

		migrateLegacyStorage()

		expect(localStorage.getItem('some-other-key')).toBe('unrelated')
	})

	it('accepts an injected storage implementation instead of the global localStorage', () => {
		const store = new Map<string, string>()
		const storage: Storage = {
			clear: () => store.clear(),
			getItem: (key) => (store.has(key) ? (store.get(key) as string) : null),
			key: (index) => Array.from(store.keys())[index] ?? null,
			get length() {
				return store.size
			},
			removeItem: (key) => void store.delete(key),
			setItem: (key, value) => void store.set(key, value),
		}
		storage.setItem('stump-main-store', '{"v":1}')

		migrateLegacyStorage(storage)

		expect(storage.getItem('longbox-main-store')).toBe('{"v":1}')
		expect(storage.getItem('stump-main-store')).toBeNull()
	})
})
