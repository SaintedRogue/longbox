/**
 * Query key for the plugin list. Shared so every mutation in this section invalidates the
 * same key rather than each guessing at a string.
 */
export const PLUGINS_QUERY_KEY = ['plugins']

/**
 * Capabilities this build knows how to describe. A plugin may advertise anything it
 * likes — unknown capabilities are shown verbatim rather than hidden, so an operator
 * running a plugin built against a newer Longbox can still see what it claims.
 */
export const CAPABILITY_LABELS: Record<string, string> = {
	'release-source': 'Release calendar',
}
