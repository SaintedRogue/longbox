import { useGraphQLMutation, useSDK } from '@longbox/client'
import { Badge, Button, Dialog, Input, NativeSelect, Text } from '@longbox/components'
import { graphql, MetadataProvider } from '@longbox/graphql'
import { useQueryClient } from '@tanstack/react-query'
import { ImageOff, Search } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'

import { ConfidenceBadge } from '@/components/metadata/metadataMatching'

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

// A single provider result normalized for the compare-grid, so media and series
// candidates render through the same card.
type ResultCard = {
	provider: string
	externalId: string
	confidence: number
	title: string
	coverUrl: string | null
	year: number | null
	publisher: string | null
	credit: string | null
}

const toYear = (value: string): number | null => {
	const trimmed = value.trim()
	if (!trimmed) return null
	const parsed = Number.parseInt(trimmed, 10)
	return Number.isFinite(parsed) ? parsed : null
}

const trimmedOrNull = (value: string): string | null => value.trim() || null

const upperFirst = (value: string): string =>
	value.length ? value.charAt(0).toUpperCase() + value.slice(1) : value

/**
 * Audiobookshelf-style interactive metadata match. The user picks a provider,
 * refines the parser-seeded query, searches, and selects a result from a
 * compare-grid (cover + key fields + confidence). Selecting applies it via the
 * existing accept mutations. Works for both an issue and a series.
 */
export default function ProviderMatchDialog({ kind, id, open, onOpenChange }: Props) {
	const { sdk } = useSDK()
	const client = useQueryClient()

	const [displayName, setDisplayName] = useState('')
	const [providers, setProviders] = useState<MetadataProvider[]>([])
	const [isLoadingContext, setIsLoadingContext] = useState(false)
	const [hasContext, setHasContext] = useState(false)

	const [provider, setProvider] = useState<MetadataProvider | ''>('')
	const [title, setTitle] = useState('')
	const [number, setNumber] = useState('')
	const [year, setYear] = useState('')
	const [publisher, setPublisher] = useState('')

	const [results, setResults] = useState<ResultCard[] | null>(null)
	const [isSearching, setIsSearching] = useState(false)
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
			setTitle(parsed.series ?? (isMedia ? '' : context.name))
			if (isMedia) setNumber(parsed.number ?? '')
			setYear(parsed.year != null ? String(parsed.year) : '')
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

	const handleSearch = async () => {
		setIsSearching(true)
		setResults(null)
		try {
			const query = {
				title: trimmedOrNull(title),
				number: isMedia ? trimmedOrNull(number) : null,
				year: toYear(year),
				publisher: isMedia ? trimmedOrNull(publisher) : null,
			}
			const providerArg = provider === '' ? null : provider

			if (isMedia) {
				const { fetchMediaMetadata } = await findMedia({ id, query, provider: providerArg })
				setResults(
					fetchMediaMetadata.map((c) => {
						const m = c.metadata.__typename === 'ExternalMediaMetadata' ? c.metadata : null
						return {
							provider: c.provider,
							externalId: c.externalId,
							confidence: c.confidence,
							title: m?.title ?? m?.seriesName ?? 'Untitled',
							coverUrl: m?.coverUrl ?? null,
							year: m?.year ?? null,
							publisher: m?.publisher ?? null,
							credit: m?.writers?.[0] ?? null,
						}
					}),
				)
			} else {
				const { fetchSeriesMetadata } = await findSeries({ id, query, provider: providerArg })
				setResults(
					fetchSeriesMetadata.map((c) => {
						const m = c.metadata.__typename === 'ExternalSeriesMetadata' ? c.metadata : null
						return {
							provider: c.provider,
							externalId: c.externalId,
							confidence: c.confidence,
							title: m?.title ?? 'Untitled',
							coverUrl: m?.coverUrl ?? null,
							year: m?.year ?? null,
							publisher: m?.publisher ?? null,
							credit: m?.authors?.[0] ?? null,
						}
					}),
				)
			}
		} catch (error) {
			toast.error('Failed to search for metadata.', {
				description: error instanceof Error ? error.message : undefined,
			})
		} finally {
			setIsSearching(false)
		}
	}

	const handleSelect = async (index: number) => {
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
	}

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
					{/* Search controls */}
					<div className="gap-3 flex flex-col">
						<div className="gap-3 sm:grid-cols-2 grid grid-cols-1">
							<div className="gap-1.5 flex flex-col">
								<Text size="sm" variant="muted">
									Provider
								</Text>
								<NativeSelect
									value={provider}
									onChange={(e) => setProvider(e.target.value as MetadataProvider | '')}
									options={providerOptions}
									disabled={isLoadingContext}
								/>
							</div>
							<Input
								label={isMedia ? 'Series / title' : 'Series title'}
								value={title}
								onChange={(e) => setTitle(e.target.value)}
								placeholder="e.g. Absolute Batman"
								disabled={isLoadingContext}
								fullWidth
							/>
						</div>
						<div className="gap-3 sm:grid-cols-4 grid grid-cols-2">
							{isMedia && (
								<Input
									label="Issue #"
									value={number}
									onChange={(e) => setNumber(e.target.value)}
									placeholder="1"
									disabled={isLoadingContext}
									fullWidth
								/>
							)}
							<Input
								label="Year"
								value={year}
								onChange={(e) => setYear(e.target.value)}
								placeholder="2024"
								inputMode="numeric"
								disabled={isLoadingContext}
								fullWidth
							/>
							{isMedia && (
								<Input
									label="Publisher"
									value={publisher}
									onChange={(e) => setPublisher(e.target.value)}
									placeholder="Optional"
									disabled={isLoadingContext}
									fullWidth
								/>
							)}
							<div className="flex items-end">
								<Button
									variant="default"
									onClick={handleSearch}
									isLoading={isSearching}
									disabled={isSearching || isLoadingContext}
									className="w-full"
								>
									<Search className="mr-1.5 h-4 w-4" />
									Search
								</Button>
							</div>
						</div>
					</div>

					{/* Results */}
					<div className="min-h-0 flex-1 overflow-y-auto">
						<ResultsBody
							results={results}
							isSearching={isSearching}
							applyingIndex={applyingIndex}
							onSelect={handleSelect}
						/>
					</div>
				</div>
			</Dialog.Content>
		</Dialog>
	)
}

function ResultsBody({
	results,
	isSearching,
	applyingIndex,
	onSelect,
}: {
	results: ResultCard[] | null
	isSearching: boolean
	applyingIndex: number | null
	onSelect: (index: number) => void
}) {
	if (isSearching) {
		return (
			<Text size="sm" variant="muted" className="py-10 text-center">
				Searching the provider…
			</Text>
		)
	}
	if (results === null) {
		return (
			<Text size="sm" variant="muted" className="py-10 text-center">
				Pick a provider, adjust the terms, and search to see matches.
			</Text>
		)
	}
	if (results.length === 0) {
		return (
			<Text size="sm" variant="muted" className="py-10 text-center">
				No matches. Try a different provider or adjust the search terms.
			</Text>
		)
	}
	return (
		<div className="gap-2 flex flex-col">
			{results.map((result, index) => (
				<ResultRow
					key={`${result.provider}-${result.externalId}-${index}`}
					result={result}
					isApplying={applyingIndex === index}
					disabled={applyingIndex !== null}
					onSelect={() => onSelect(index)}
				/>
			))}
		</div>
	)
}

function ResultRow({
	result,
	isApplying,
	disabled,
	onSelect,
}: {
	result: ResultCard
	isApplying: boolean
	disabled: boolean
	onSelect: () => void
}) {
	const [coverFailed, setCoverFailed] = useState(false)
	const subtitle = [result.year, result.publisher, result.credit]
		.filter((part): part is string | number => part != null && part !== '')
		.join(' · ')

	const showCover = result.coverUrl && !coverFailed

	return (
		<div className="gap-3 p-2 flex items-center rounded-lg border border-border bg-background">
			<div className="h-20 w-14 rounded shrink-0 overflow-hidden bg-muted">
				{showCover ? (
					<img
						src={result.coverUrl ?? undefined}
						alt={result.title}
						className="h-full w-full object-cover"
						onError={() => setCoverFailed(true)}
					/>
				) : (
					<div className="flex h-full w-full items-center justify-center text-muted-foreground">
						<ImageOff className="h-5 w-5" />
					</div>
				)}
			</div>

			<div className="min-w-0 flex-1">
				<Text size="sm" className="font-medium truncate">
					{result.title}
				</Text>
				{subtitle && (
					<Text size="xs" variant="muted" className="truncate">
						{subtitle}
					</Text>
				)}
				<div className="gap-1.5 mt-1 flex items-center">
					<Badge size="xs">{upperFirst(result.provider)}</Badge>
					<ConfidenceBadge confidence={result.confidence} />
				</div>
			</div>

			<Button
				variant="secondary"
				size="sm"
				onClick={onSelect}
				isLoading={isApplying}
				disabled={disabled}
				className="shrink-0"
			>
				Select
			</Button>
		</div>
	)
}
