import { ensurePersisted, storageEstimate } from '../persist'

describe('persist', () => {
	const originalStorage = navigator.storage

	afterEach(() => {
		Object.defineProperty(navigator, 'storage', {
			value: originalStorage,
			configurable: true,
		})
	})

	describe('ensurePersisted', () => {
		it('returns true if already persisted, without calling persist()', async () => {
			const persist = jest.fn()
			const mockStorage = {
				persist,
				persisted: jest.fn(() => Promise.resolve(true)),
			}
			Object.defineProperty(navigator, 'storage', {
				value: mockStorage,
				configurable: true,
			})

			const result = await ensurePersisted()

			expect(result).toBe(true)
			expect(persist).not.toHaveBeenCalled()
		})

		it('calls persist() and returns true if granted on request', async () => {
			const persist = jest.fn(() => Promise.resolve(true))
			const mockStorage = {
				persist,
				persisted: jest.fn(() => Promise.resolve(false)),
			}
			Object.defineProperty(navigator, 'storage', {
				value: mockStorage,
				configurable: true,
			})

			const result = await ensurePersisted()

			expect(result).toBe(true)
			expect(persist).toHaveBeenCalled()
		})

		it('returns false if persist() is denied', async () => {
			const persist = jest.fn(() => Promise.resolve(false))
			const mockStorage = {
				persist,
				persisted: jest.fn(() => Promise.resolve(false)),
			}
			Object.defineProperty(navigator, 'storage', {
				value: mockStorage,
				configurable: true,
			})

			const result = await ensurePersisted()

			expect(result).toBe(false)
		})

		it('returns false if navigator.storage is unavailable', async () => {
			Object.defineProperty(navigator, 'storage', {
				value: undefined,
				configurable: true,
			})

			const result = await ensurePersisted()

			expect(result).toBe(false)
		})
	})

	describe('storageEstimate', () => {
		it('normalizes estimate() result with defined values', async () => {
			const mockStorage = {
				estimate: jest.fn(() => Promise.resolve({ usage: 123, quota: 456 })),
			}
			Object.defineProperty(navigator, 'storage', {
				value: mockStorage,
				configurable: true,
			})

			const result = await storageEstimate()

			expect(result).toEqual({ usage: 123, quota: 456 })
		})

		it('normalizes undefined fields to 0', async () => {
			const mockStorage = {
				estimate: jest.fn(() => Promise.resolve({})),
			}
			Object.defineProperty(navigator, 'storage', {
				value: mockStorage,
				configurable: true,
			})

			const result = await storageEstimate()

			expect(result).toEqual({ usage: 0, quota: 0 })
		})

		it('returns null if navigator.storage is unavailable', async () => {
			Object.defineProperty(navigator, 'storage', {
				value: undefined,
				configurable: true,
			})

			const result = await storageEstimate()

			expect(result).toBeNull()
		})
	})
})
