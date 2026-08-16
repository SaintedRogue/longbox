import { MetadataProvider } from '@longbox/graphql'

export const PROVIDER_LABELS: Record<MetadataProvider, string> = {
	[MetadataProvider.Hardcover]: 'Hardcover',
	[MetadataProvider.Metron]: 'Metron',
	[MetadataProvider.ComicVine]: 'Comic Vine',
	[MetadataProvider.Locg]: 'League of Comic Geeks',
}

/** Providers that serve comic libraries (mirrors the backend's supported types). */
export const COMIC_PROVIDERS: MetadataProvider[] = [
	MetadataProvider.Metron,
	MetadataProvider.ComicVine,
	MetadataProvider.Locg,
]

export const isComicProvider = (provider: MetadataProvider): boolean =>
	COMIC_PROVIDERS.includes(provider)

/**
 * Providers with no official or public API, which can only be reached by driving a
 * site's own session-authenticated endpoints with the operator's personal login —
 * against that site's terms of use.
 *
 * These are withheld from the add-provider list entirely (absent, not disabled) until
 * the server owner acknowledges those terms. Mirrors the backend's
 * `MetadataProvider::is_unofficial`.
 */
export const UNOFFICIAL_PROVIDERS: MetadataProvider[] = [MetadataProvider.Locg]

export const isUnofficialProvider = (provider: MetadataProvider): boolean =>
	UNOFFICIAL_PROVIDERS.includes(provider)

/**
 * Providers whose search endpoints return list rows rather than full records.
 *
 * A search result from one of these carries a title, publisher, cover and date; the
 * summary, page count, ISBN, credits and characters live only on the item's own page. The
 * review grid fetches that page for the candidate on screen instead of comparing against
 * a near-empty card.
 *
 * Mirrors `MetadataProvider::search_returns_partial_metadata` on the backend, the same way
 * `isComicProvider` mirrors `supported_library_types`. Getting it wrong is cheap in both
 * directions: a false positive spends one request a review, a false negative shows dashes.
 */
export const PARTIAL_SEARCH_PROVIDERS: Set<string> = new Set([MetadataProvider.Locg])

/**
 * The backend speaks two names for every provider, and they are not the same string.
 *
 * A `MatchCandidate.provider` is the provider *trait id* — `locg`, `comicvine` — because
 * that is what identifies a provider implementation and what `external_metadata_link`
 * stores. The `MetadataProvider` GraphQL enum is `LOCG`, `COMIC_VINE`. Comparing one
 * against the other silently fails: `PARTIAL_SEARCH_PROVIDERS.has('locg')` is false, and
 * passing `'locg'` where the schema wants the enum is rejected outright.
 *
 * This is not a formatting difference that `toUpperCase` would fix — `comicvine` and
 * `COMIC_VINE` differ by more than case — so the mapping is explicit.
 */
const PROVIDER_BY_TRAIT_ID: Record<string, MetadataProvider> = {
	comicvine: MetadataProvider.ComicVine,
	hardcover: MetadataProvider.Hardcover,
	locg: MetadataProvider.Locg,
	metron: MetadataProvider.Metron,
}

/**
 * Resolve whatever a candidate calls its provider to the enum the API expects.
 *
 * Accepts either vocabulary, so a caller does not have to know which one it was handed:
 * an enum value passes straight through, a trait id is translated, and anything else is
 * `undefined` rather than a guess.
 */
export const providerFromId = (id?: string | null): MetadataProvider | undefined => {
	if (!id) return undefined
	if (PROVIDERS.includes(id as MetadataProvider)) return id as MetadataProvider
	return PROVIDER_BY_TRAIT_ID[id.toLowerCase()]
}

export const PROVIDERS = Object.values(MetadataProvider)

/**
 * The providers offerable right now. Unofficial ones only appear once the server owner
 * has acknowledged what using them means.
 */
export const availableProviders = (unofficialAcknowledged: boolean): MetadataProvider[] =>
	unofficialAcknowledged ? PROVIDERS : PROVIDERS.filter((p) => !isUnofficialProvider(p))
