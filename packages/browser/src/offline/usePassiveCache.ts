import { useEffect } from 'react'

import { runStartupMaintenance } from './passiveCache'
import { ensurePersisted } from './persist'

/**
 * Runs passive-cache startup maintenance (pruning log rows since absorbed by an explicit download,
 * then sweeping if still over the cap) and proactively requests persistent storage, once on mount.
 * `ensurePersisted` is called here rather than only lazily on first download (see downloadManager.ts)
 * because passive writes now happen continuously from normal reading, not just from explicit
 * downloads. Mount once, high in the app shell (see AppLayout), next to `useOfflineDownloads`.
 */
export function usePassiveCacheMaintenance(): void {
	useEffect(() => {
		void runStartupMaintenance()
		void ensurePersisted()
	}, [])
}
