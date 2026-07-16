import { MetadataProvider } from '@stump/graphql'

export const PROVIDER_LABELS: Record<MetadataProvider, string> = {
	[MetadataProvider.Hardcover]: 'Hardcover',
	[MetadataProvider.Metron]: 'Metron',
}

export const PROVIDERS = Object.values(MetadataProvider)
