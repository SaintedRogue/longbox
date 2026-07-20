import { useGraphQLMutation, useSDK } from '@longbox/client'
import { Dialog, Text } from '@longbox/components'
import { graphql, MetadataProvider } from '@longbox/graphql'
import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'

import {
	MetadataSearchPanel,
	type MetadataSearchQuery,
	type SearchPanelCandidate,
} from './MetadataSearchPanel'

// Human labels for the provider dropdown. Kept local so this component doesn't
// reach into the settings scene; the set is tiny and stable.
const PROVIDER_LABELS: Record<MetadataProvider, string> = {
	[MetadataProvider.Hardcover]: 'Hardcover',
	[MetadataProvider.Metron]: 'Metron',
	[MetadataProvider.ComicVine]: 'Comic Vine',
}

const mediaContextQuery = graphql(`
	query ProviderMatchMediaContext($id: ID!) {
		mediaById(id: $id) {
			id
			name
			resolvedName
		}
	}
`)

const seriesContextQuery = graphql(`
	query ProviderMatchSeriesContext($id: ID!) {
		seriesById(id: $id) {
			id
			name
			resolvedName
		}
	}
`)

const parseQuery = graphql(`
	query ProviderMatchParse($name: String!) {
		parseComicFilename(name: $name) {
			series
			number
			year
		}
	}
`)

const providersQuery = graphql(`
	query ProviderMatchProviders {
		metadataProviderConfigs {
			id
			providerType
			enabled
			position
		}
	}
`)

// autoApply:false keeps the fetch record awaiting review so the user can pick ANY
// candidate (a high-confidence top hit would otherwise auto-apply and lock the record).
const findMediaMutation = graphql(`
	mutation ProviderMatchFindMedia(
		$id: ID!
		$query: MetadataSearchInput
		$provider: MetadataProvider
	) {
		fetchMediaMetadata(id: $id, query: $query, provider: $provider, autoApply: false) {
			provider
			externalId
			confidence
			metadata {
				__typename
				... on ExternalMediaMetadata {
					title
					seriesName
					numberRaw
					year
					publisher
					writers
					coverUrl
				}
			}
		}
	}
`)

const findSeriesMutation = graphql(`
	mutation ProviderMatchFindSeries(
		$id: ID!
		$query: MetadataSearchInput
		$provider: MetadataProvider
	) {
		fetchSeriesMetadata(id: $id, query: $query, provider: $provider, autoApply: false) {
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

const acceptMediaMutation = graphql(`
	mutation ProviderMatchAcceptMedia($mediaId: ID!, $candidateIndex: Int!) {
		acceptMediaMatch(mediaId: $mediaId, candidateIndex: $candidateIndex) {
			id
			status
		}
	}
`)

const acceptSeriesMutation = graphql(`
	mutation ProviderMatchAcceptSeries($seriesId: ID!, $candidateIndex: Int!) {
		acceptSeriesMatch(seriesId: $seriesId, candidateIndex: $candidateIndex) {
			id
			status
		}
	}
`)

type MatchKind = 'media' | 'series'

type Props = {
	kind: MatchKind
	id: string
	open: boolean
	onOpenChange: (open: boolean) => void
}

const trimmedOrNull = (value: string): string | null => value.trim() || null

/**
 * Audiobookshelf-style interactive metadata match. The user picks a provider,
 * refines the parser-seeded query, searches, and selects a result from a
 * compare-grid (cover + key fields + confidence). Selecting applies it via the
 * existing accept mutations. Works for both an issue and a series.
 *
 * The editable-query/provider-picker/search/compare-grid UI itself lives in
 * `MetadataSearchPanel` (backend-agnostic); this component owns context
 * loading, the GraphQL queries/mutations, and wires them in via
 * `onSearch`/`onSelect`.
 */
export default function ProviderMatchDialog({ kind, id, open, onOpenChange }: Props) {
	const { sdk } = useSDK()
	const client = useQueryClient()

	const [displayName, setDisplayName] = useState('')
	const [providers, setProviders] = useState<MetadataProvider[]>([])
	const [isLoadingContext, setIsLoadingContext] = useState(false)
	const [hasContext, setHasContext] = useState(false)

	const [seed, setSeed] = useState<MetadataSearchQuery>({ title: '' })
	const [applyingIndex, setApplyingIndex] = useState<number | null>(null)

	const { mutateAsync: findMedia } = useGraphQLMutation(findMediaMutation)
	const { mutateAsync: findSeries } = useGraphQLMutation(findSeriesMutation)
	const { mutateAsync: acceptMedia } = useGraphQLMutation(acceptMediaMutation)
	const { mutateAsync: acceptSeries } = useGraphQLMutation(acceptSeriesMutation)

	const isMedia = kind === 'media'

	// Load the entity's raw name (to seed the fields via the shared server-side
	// parser) and the enabled providers. Runs once per dialog lifetime.
	const loadContext = useCallback(async () => {
		setIsLoadingContext(true)
		try {
			const [context, providerData] = await Promise.all([
				isMedia
					? sdk.execute(mediaContextQuery, { id }).then((r) => r.mediaById)
					: sdk.execute(seriesContextQuery, { id }).then((r) => r.seriesById),
				sdk.execute(providersQuery, undefined),
			])
			if (!context) return

			const parsed = (await sdk.execute(parseQuery, { name: context.name })).parseComicFilename

			setDisplayName(context.resolvedName)
			setProviders(
				providerData.metadataProviderConfigs
					.filter((p) => p.enabled)
					.sort((a, b) => a.position - b.position)
					.map((p) => p.providerType),
			)
			// Series titles seed from the parsed series (strips a trailing "(2025)"),
			// falling back to the raw name; issues seed series + number + year.
			setSeed({
				title: parsed.series ?? (isMedia ? '' : context.name),
				number: isMedia ? (parsed.number ?? '') : undefined,
				year: parsed.year ?? null,
			})
			setHasContext(true)
		} catch (error) {
			toast.error('Failed to prepare the metadata search.', {
				description: error instanceof Error ? error.message : undefined,
			})
		} finally {
			setIsLoadingContext(false)
		}
	}, [sdk, id, isMedia])

	useEffect(() => {
		if (open && !hasContext && !isLoadingContext) {
			void loadContext()
		}
	}, [open, hasContext, isLoadingContext, loadContext])

	// `MetadataSearchPanel` owns no GraphQL — it calls this with its (already
	// parsed) query + selected provider and gets back candidates normalized
	// for the compare-grid.
	const runFetch = useCallback(
		async (
			query: MetadataSearchQuery,
			provider: string | null,
		): Promise<SearchPanelCandidate[]> => {
			try {
				const graphqlQuery = {
					title: trimmedOrNull(query.title),
					number: isMedia ? trimmedOrNull(query.number ?? '') : null,
					year: query.year ?? null,
					publisher: isMedia ? trimmedOrNull(query.publisher ?? '') : null,
				}
				const providerArg = provider as MetadataProvider | null

				if (isMedia) {
					const { fetchMediaMetadata } = await findMedia({
						id,
						query: graphqlQuery,
						provider: providerArg,
					})
					return fetchMediaMetadata.map((c) => ({
						provider: c.provider,
						externalId: c.externalId,
						confidence: c.confidence,
						metadata: (c.metadata.__typename === 'ExternalMediaMetadata'
							? c.metadata
							: {}) as unknown as Record<string, unknown>,
					}))
				}
				const { fetchSeriesMetadata } = await findSeries({
					id,
					query: graphqlQuery,
					provider: providerArg,
				})
				return fetchSeriesMetadata.map((c) => ({
					provider: c.provider,
					externalId: c.externalId,
					confidence: c.confidence,
					metadata: (c.metadata.__typename === 'ExternalSeriesMetadata'
						? c.metadata
						: {}) as unknown as Record<string, unknown>,
				}))
			} catch (error) {
				toast.error('Failed to search for metadata.', {
					description: error instanceof Error ? error.message : undefined,
				})
				throw error
			}
		},
		[isMedia, id, findMedia, findSeries],
	)

	// Accept-by-index: `index` is the position of `candidate` within the list
	// that was JUST returned by `runFetch` — the accept mutations re-run the
	// same search server-side and apply whichever candidate sits at that
	// index, so it must be the same index the compare-grid rendered.
	const acceptAtIndex = useCallback(
		async (_candidate: SearchPanelCandidate, index: number) => {
			setApplyingIndex(index)
			try {
				if (isMedia) {
					await acceptMedia({ mediaId: id, candidateIndex: index })
				} else {
					await acceptSeries({ seriesId: id, candidateIndex: index })
				}
				toast.success('Metadata applied from the selected match.')
				// A deliberate one-off apply — refresh everything so book and series
				// views reflect the new title/credits without a manual reload.
				void client.invalidateQueries()
				onOpenChange(false)
			} catch (error) {
				toast.error('Failed to apply the selected match.', {
					description: error instanceof Error ? error.message : undefined,
				})
			} finally {
				setApplyingIndex(null)
			}
		},
		[isMedia, id, acceptMedia, acceptSeries, client, onOpenChange],
	)

	const providerOptions = [
		{ label: 'All enabled providers', value: '' },
		...providers.map((p) => ({ label: PROVIDER_LABELS[p] ?? p, value: p })),
	]

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<Dialog.Content size="xl" className="flex max-h-[85vh] flex-col">
				<Dialog.Header>
					<Dialog.Title>Match metadata</Dialog.Title>
					<Dialog.Description>
						{displayName ? `Search providers for "${displayName}"` : 'Search metadata providers'}
					</Dialog.Description>
					<Dialog.Close />
				</Dialog.Header>

				<div className="gap-4 min-h-0 flex flex-col">
					{hasContext ? (
						<MetadataSearchPanel
							kind={kind}
							seed={seed}
							providers={providerOptions}
							onSearch={runFetch}
							onSelect={acceptAtIndex}
							selectingIndex={applyingIndex}
						/>
					) : (
						<Text size="sm" variant="muted" className="py-10 text-center">
							Preparing the metadata search…
						</Text>
					)}
				</div>
			</Dialog.Content>
		</Dialog>
	)
}
