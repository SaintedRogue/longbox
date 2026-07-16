/**
 * Ask the browser to make site storage persistent (best-effort).
 * Returns true if storage is (or becomes) persisted, false if not granted or the API is unavailable.
 * If already persisted, returns true WITHOUT calling persist() again.
 */
export async function ensurePersisted(): Promise<boolean> {
	const storage = navigator?.storage
	if (!storage?.persist || !storage?.persisted) return false
	if (await storage.persisted()) return true
	return storage.persist()
}

/**
 * Report current usage/quota in bytes (best-effort). Returns null if the API is unavailable.
 * Normalizes possibly-undefined fields from StorageEstimate to numbers.
 */
export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
	const storage = navigator?.storage
	if (!storage?.estimate) return null
	const { usage, quota } = await storage.estimate()
	return { usage: usage ?? 0, quota: quota ?? 0 }
}
