import { cn, Text } from '@longbox/components'
import { MetadataProvider } from '@longbox/graphql'

import { PROVIDER_LABELS } from './constants'

type Props = {
	provider: MetadataProvider
	className?: string
}

export function ProviderLogo({ provider, className }: Props) {
	const logo = LOGOS[provider]

	// Providers without a bundled logo get a monogram instead of a broken image. LOCG
	// is deliberately in that group: it is an unofficial integration and we would
	// rather not ship their branding into the repo to identify it.
	if (!logo) {
		return (
			<div
				aria-label={`${PROVIDER_LABELS[provider] ?? provider} logo`}
				role="img"
				className={cn(
					'h-16 w-16 flex items-center justify-center rounded-lg border border-border bg-muted',
					className,
				)}
			>
				<Text size="lg" variant="muted" className="font-semibold">
					{MONOGRAMS[provider] ?? provider.slice(0, 2)}
				</Text>
			</div>
		)
	}

	return (
		<img
			src={logo}
			alt={`${provider[0] + provider.slice(1).toLowerCase()} logo`}
			className={cn('h-16 w-16 object-scale-down', className, {
				'rotate-[12deg] transform': provider === MetadataProvider.Hardcover,
			})}
		/>
	)
}

const LOGOS: Record<MetadataProvider, string | null> = {
	[MetadataProvider.Hardcover]: '/assets/logos/hardcover.png',
	[MetadataProvider.Metron]: '/assets/logos/metron.png',
	[MetadataProvider.ComicVine]: '/assets/logos/comicvine.svg',
	[MetadataProvider.Locg]: null,
}

const MONOGRAMS: Partial<Record<MetadataProvider, string>> = {
	[MetadataProvider.Locg]: 'LCG',
}
