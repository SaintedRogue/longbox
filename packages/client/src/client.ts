import { QueryClient } from '@tanstack/react-query'

export { QueryClientProvider } from '@tanstack/react-query'

export const queryClient = new QueryClient({
	defaultOptions: {
		queries: {
			refetchOnWindowFocus: true,
			retry: false,
			/**
			 * Drilling into a book and coming back must repaint the list from cache, instantly and
			 * at full height -- otherwise scroll restoration has nothing to restore against.
			 *
			 * The two react-query defaults both worked against that. `staleTime: 0` marked every
			 * list stale the instant it resolved, so remounting always refetched; `gcTime` of 5
			 * minutes evicted any list left unobserved for longer, so returning to it re-suspended
			 * and rendered at zero height while `useScrollRestoration` burned through its retry
			 * budget. Note `staleTime` is per-observer in v5, so the PREFETCH_STALE_TIME passed to
			 * `prefetchQuery` calls below never applied to the mounted list itself -- only these
			 * defaults do.
			 */
			staleTime: 1000 * 30, // 30 seconds
			gcTime: 1000 * 60 * 30, // 30 minutes
		},
	},
})

export const PREFETCH_STALE_TIME = 1000 * 20 // 20 seconds

export const ALPHABET_STALE_TIME = 1000 * 60 * 60 * 24 * 7 // 1 week
