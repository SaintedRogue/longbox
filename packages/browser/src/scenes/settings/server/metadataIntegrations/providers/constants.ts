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

export const PROVIDERS = Object.values(MetadataProvider)

/**
 * The providers offerable right now. Unofficial ones only appear once the server owner
 * has acknowledged what using them means.
 */
export const availableProviders = (unofficialAcknowledged: boolean): MetadataProvider[] =>
	unofficialAcknowledged ? PROVIDERS : PROVIDERS.filter((p) => !isUnofficialProvider(p))
