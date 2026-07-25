// NOTE: the <X>Router is deliberately NOT re-exported here. AppRouter lazy-imports the router
// module directly, and re-exporting it would make it statically reachable from this barrel --
// which the always-loaded shell imports for the hooks below, pulling the whole route tree back
// into the eager App chunk and undoing the code splitting.
export { usePrefetchSmartList } from './graphql'
