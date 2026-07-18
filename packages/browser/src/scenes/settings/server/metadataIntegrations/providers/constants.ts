import { MetadataProvider } from '@longbox/graphql'

export const PROVIDER_LABELS: Record<MetadataProvider, string> = {
	[MetadataProvider.Hardcover]: 'Hardcover',
	[MetadataProvider.Metron]: 'Metron',
	[MetadataProvider.ComicVine]: 'Comic Vine',
}

/** Providers that serve comic libraries (mirrors the backend's supported types). */
export const COMIC_PROVIDERS: MetadataProvider[] = [
	MetadataProvider.Metron,
	MetadataProvider.ComicVine,
]

export const isComicProvider = (provider: MetadataProvider): boolean =>
	COMIC_PROVIDERS.includes(provider)

export const PROVIDERS = Object.values(MetadataProvider)
