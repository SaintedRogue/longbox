import { useGraphQL, useSDK } from '@longbox/client'
import { Dialog, Text } from '@longbox/components'
import { graphql, MetadataProvider } from '@longbox/graphql'
import { useLocaleContext } from '@longbox/i18n'
import { useCallback, useMemo } from 'react'
import { toast } from 'sonner'

import { MetadataSearchPanel, SearchPanelCandidate } from '@/components/metadata/providerMatch'

import { OrganizeOverride } from './organizeMoves'

// Human labels for the provider dropdown — same set `ProviderMatchDialog` uses.
const PROVIDER_LABELS: Record<MetadataProvider, string> = {
	[MetadataProvider.Hardcover]: 'Hardcover',
	[MetadataProvider.Metron]: 'Metron',
	[MetadataProvider.ComicVine]: 'Comic Vine',
}

const organizeSearchSeriesQuery = graphql(`
	query OrganizeSearchSeries(
		$libraryId: ID!
		$title: String!
		$year: Int
		$provider: MetadataProvider
	) {
		organizeSearchSeries(libraryId: $libraryId, title: $title, year: $year, provider: $provider) {
			provider
			externalId
			confidence
			metadata {
				__typename
				... on ExternalSeriesMetadata {
					title
					year
					publisher
					authors
					coverUrl
				}
			}
		}
	}
`)

// Reuses the same `metadataProviderConfigs` query `ProviderMatchDialog` uses to
// populate its provider dropdown, co-located here rather than shared, since
// each caller's query needs a unique operation name for codegen anyway.
const providersQuery = graphql(`
	query OrganizeSeriesMatchProviders {
		metadataProviderConfigs {
			providerType
			enabled
			position
		}
	}
`)

type Props = {
	libraryId: string
	src: string
	seed: { title: string; year: number | null }
	open: boolean
	onOpenChange: (open: boolean) => void
	onPicked: (src: string, override: OrganizeOverride) => void
}

/**
 * The launched picker for a manual series match: seeded from the row's
 * parsed title/year, lets the user search a chosen (or all-enabled)
 * provider and pick a candidate to override that row's series match.
 *
 * Unlike `ProviderMatchDialog`, this never fetches/applies metadata to an
 * existing media/series record — it only searches (`organizeSearchSeries`,
 * live + non-persisting) and hands the picked candidate back to the caller
 * via `onPicked`, which folds it into the organize preview as an override.
 */
export default function OrganizeSeriesMatchDialog({
	libraryId,
	src,
	seed,
	open,
	onOpenChange,
	onPicked,
}: Props) {
	const { t } = useLocaleContext()
	const { sdk } = useSDK()

	const { data: providersData } = useGraphQL(
		providersQuery,
		['metadataProviderConfigs', 'organizeSeriesMatch'],
		undefined,
		{ enabled: open },
	)

	// Gate mounting `MetadataSearchPanel` on the query having resolved — same
	// shape as `ProviderMatchDialog`'s `hasContext` gate. Without this, the
	// panel mounts on a cold open with `providers` still `[]`, its lazy
	// `useState` default locks in as `''`, and a search with no provider
	// selected falls through to "all enabled providers" — including Metron,
	// which must only ever be contacted by explicit user choice.
	const providersLoaded = !!providersData

	const providers = useMemo(
		() =>
			(providersData?.metadataProviderConfigs ?? [])
				.filter((p) => p.enabled)
				.sort((a, b) => a.position - b.position)
				.map((p) => ({
					value: p.providerType as string,
					label: PROVIDER_LABELS[p.providerType] ?? p.providerType,
				})),
		[providersData],
	)

	const runSearch = useCallback(
		async (query: { title: string; year?: number | null }, provider: string | null) => {
			try {
				const res = await sdk.execute(organizeSearchSeriesQuery, {
					libraryId,
					title: query.title,
					year: query.year ?? null,
					provider: (provider as MetadataProvider | null) ?? null,
				})
				// `metadata` is a `MatchCandidate.metadata` union (series vs. media) —
				// only series-shaped candidates carry a usable `title`/`year`, so a
				// non-series candidate is dropped here rather than risking an empty
				// `canonicalName` reaching the compare-grid (and `handleSelect`).
				return (res.organizeSearchSeries ?? [])
					.filter((candidate) => candidate.metadata.__typename === 'ExternalSeriesMetadata')
					.map((candidate) => ({
						provider: candidate.provider,
						externalId: candidate.externalId,
						confidence: candidate.confidence,
						metadata: candidate.metadata as unknown as Record<string, unknown>,
					})) as SearchPanelCandidate[]
			} catch (error) {
				toast.error('Failed to search for a series match.', {
					description: error instanceof Error ? error.message : undefined,
				})
				return []
			}
		},
		[sdk, libraryId],
	)

	const handleSelect = useCallback(
		(candidate: SearchPanelCandidate) => {
			// Belt-and-suspenders: `runSearch` already filters to series-shaped
			// candidates, but never hand a non-series candidate's (empty)
			// `canonicalName` to `onPicked` if one somehow slips through.
			if (candidate.metadata.__typename !== 'ExternalSeriesMetadata') return
			const meta = candidate.metadata as { title?: string; year?: number | null }
			onPicked(src, {
				canonicalName: meta.title ?? '',
				year: meta.year ?? null,
				externalId: candidate.externalId,
				provider: candidate.provider,
			})
			onOpenChange(false)
		},
		[onPicked, src, onOpenChange],
	)

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<Dialog.Content size="xl" className="flex max-h-[85vh] flex-col">
				<Dialog.Header>
					<Dialog.Title>{t(getKey('title'))}</Dialog.Title>
					<Dialog.Close />
				</Dialog.Header>
				<div className="min-h-0 flex-1 overflow-y-auto">
					{providersLoaded ? (
						<MetadataSearchPanel
							kind="series"
							seed={{ title: seed.title, year: seed.year }}
							providers={providers}
							onSearch={runSearch}
							onSelect={handleSelect}
						/>
					) : (
						<Text size="sm" variant="muted" className="py-10 text-center">
							Loading providers…
						</Text>
					)}
				</div>
			</Dialog.Content>
		</Dialog>
	)
}

const LOCALE_KEY = 'librarySettingsScene.options/organize.seriesMatch'
const getKey = (key: string) => `${LOCALE_KEY}.${key}`
