// Intentionally empty. `CharacterRouter` used to be re-exported here, but AppRouter lazy-imports
// `./CharacterRouter` directly now. A barrel re-export makes the router statically reachable, so any
// eager import of this barrel drags the whole route tree back into the App chunk and undoes the
// code splitting -- keep leaf utilities here if needed, never the router.
export {}
