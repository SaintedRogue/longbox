import { Badge, Button, Input, NativeSelect, Text } from '@longbox/components'
import { ImageOff, Search } from 'lucide-react'
import { useState } from 'react'

import { ConfidenceBadge } from '@/components/metadata/metadataMatching/reviewDialog/ConfidenceBadge'

// A single provider result, normalized just enough for the compare-grid to
// key off `kind`. `metadata` is intentionally a loose bag (rather than a
// GraphQL union) so this panel has no GraphQL dependency of its own — see
// `toResultCard` for how the display fields are pulled out of it per kind.
export type SearchPanelCandidate = {
	provider: string
	externalId: string
	confidence: number
	metadata: Record<string, unknown> // rendered by kind; see ResultRow
}

export type MetadataSearchQuery = {
	title: string
	number?: string
	year?: number | null
	publisher?: string
}

export type MetadataSearchPanelProps = {
	/**
	 * Whether this is matching a single issue (`media`) or a whole `series`.
	 * Controls which query fields render and how a candidate's `metadata`
	 * bag is read for the compare-grid.
	 */
	kind: 'media' | 'series'
	/** Initial query values (e.g. seeded from a parsed filename or stored metadata). */
	seed: MetadataSearchQuery
	/** Enabled providers for the dropdown; the first entry is selected by default. */
	providers: { value: string; label: string }[]
	/** Runs a search for the current query + selected provider against the caller's backend. */
	onSearch: (query: MetadataSearchQuery, provider: string | null) => Promise<SearchPanelCandidate[]>
	/** Applies the candidate the user picked from the compare-grid. */
	onSelect: (candidate: SearchPanelCandidate, index: number) => void
	/** Row index whose select is in flight — shows a spinner and disables the rest of the grid. */
	selectingIndex?: number | null
}

const toYear = (value: string): number | null => {
	const trimmed = value.trim()
	if (!trimmed) return null
	const parsed = Number.parseInt(trimmed, 10)
	return Number.isFinite(parsed) ? parsed : null
}

const upperFirst = (value: string): string =>
	value.length ? value.charAt(0).toUpperCase() + value.slice(1) : value

const asString = (value: unknown): string | undefined =>
	typeof value === 'string' ? value : undefined
const asNumber = (value: unknown): number | undefined =>
	typeof value === 'number' ? value : undefined
const firstString = (value: unknown): string | null => {
	if (!Array.isArray(value)) return null
	const match = value.find((entry): entry is string => typeof entry === 'string')
	return match ?? null
}

// A candidate's `metadata` bag shapes differently per kind (issue writers vs.
// series authors, series name vs. title) — this normalizes it for the card.
function toResultCard(kind: MetadataSearchPanelProps['kind'], candidate: SearchPanelCandidate) {
	const m = candidate.metadata
	const title =
		kind === 'media'
			? (asString(m.title) ?? asString(m.seriesName) ?? 'Untitled')
			: (asString(m.title) ?? 'Untitled')
	const credit = kind === 'media' ? firstString(m.writers) : firstString(m.authors)

	return {
		title,
		coverUrl: asString(m.coverUrl) ?? null,
		year: asNumber(m.year) ?? null,
		publisher: asString(m.publisher) ?? null,
		credit,
	}
}

/**
 * Backend-agnostic search-and-compare panel: an editable query (title always;
 * issue number + publisher only for `kind: 'media'`), a provider picker, a
 * Search button, and a compare-grid of results. The caller supplies the
 * actual search + select behavior via `onSearch`/`onSelect`, so this can be
 * reused across different dialogs/pickers without depending on GraphQL.
 */
export function MetadataSearchPanel({
	kind,
	seed,
	providers,
	onSearch,
	onSelect,
	selectingIndex = null,
}: MetadataSearchPanelProps) {
	const isMedia = kind === 'media'

	const [provider, setProvider] = useState(() => providers[0]?.value ?? '')
	const [title, setTitle] = useState(seed.title)
	const [number, setNumber] = useState(seed.number ?? '')
	const [year, setYear] = useState(seed.year != null ? String(seed.year) : '')
	const [publisher, setPublisher] = useState(seed.publisher ?? '')

	const [results, setResults] = useState<SearchPanelCandidate[] | null>(null)
	const [isSearching, setIsSearching] = useState(false)

	const handleSearch = async () => {
		setIsSearching(true)
		setResults(null)
		try {
			const query: MetadataSearchQuery = {
				title: title.trim(),
				number: isMedia ? number.trim() || undefined : undefined,
				year: toYear(year),
				publisher: isMedia ? publisher.trim() || undefined : undefined,
			}
			const candidates = await onSearch(query, provider || null)
			setResults(candidates)
		} catch {
			// The caller is responsible for surfacing the error (e.g. a toast);
			// leave `results` at null so the panel keeps its "not searched yet"
			// state instead of a misleading "no matches".
		} finally {
			setIsSearching(false)
		}
	}

	return (
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
							onChange={(e) => setProvider(e.target.value)}
							options={providers}
						/>
					</div>
					<Input
						label={isMedia ? 'Series / title' : 'Series title'}
						value={title}
						onChange={(e) => setTitle(e.target.value)}
						placeholder="e.g. Absolute Batman"
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
							fullWidth
						/>
					)}
					<Input
						label="Year"
						value={year}
						onChange={(e) => setYear(e.target.value)}
						placeholder="2024"
						inputMode="numeric"
						fullWidth
					/>
					{isMedia && (
						<Input
							label="Publisher"
							value={publisher}
							onChange={(e) => setPublisher(e.target.value)}
							placeholder="Optional"
							fullWidth
						/>
					)}
					<div className="flex items-end">
						<Button
							variant="default"
							onClick={handleSearch}
							isLoading={isSearching}
							disabled={isSearching}
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
					kind={kind}
					results={results}
					isSearching={isSearching}
					selectingIndex={selectingIndex ?? null}
					onSelect={onSelect}
				/>
			</div>
		</div>
	)
}

function ResultsBody({
	kind,
	results,
	isSearching,
	selectingIndex,
	onSelect,
}: {
	kind: MetadataSearchPanelProps['kind']
	results: SearchPanelCandidate[] | null
	isSearching: boolean
	selectingIndex: number | null
	onSelect: (candidate: SearchPanelCandidate, index: number) => void
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
			{results.map((candidate, index) => (
				<ResultRow
					key={`${candidate.provider}-${candidate.externalId}-${index}`}
					kind={kind}
					candidate={candidate}
					index={index}
					isApplying={selectingIndex === index}
					disabled={selectingIndex !== null}
					onSelect={onSelect}
				/>
			))}
		</div>
	)
}

function ResultRow({
	kind,
	candidate,
	index,
	isApplying,
	disabled,
	onSelect,
}: {
	kind: MetadataSearchPanelProps['kind']
	candidate: SearchPanelCandidate
	index: number
	isApplying: boolean
	disabled: boolean
	onSelect: (candidate: SearchPanelCandidate, index: number) => void
}) {
	const [coverFailed, setCoverFailed] = useState(false)
	const card = toResultCard(kind, candidate)
	const subtitle = [card.year, card.publisher, card.credit]
		.filter((part): part is string | number => part != null && part !== '')
		.join(' · ')

	const showCover = card.coverUrl && !coverFailed

	return (
		<div className="gap-3 p-2 flex items-center rounded-lg border border-border bg-background">
			<div className="h-20 w-14 rounded shrink-0 overflow-hidden bg-muted">
				{showCover ? (
					<img
						src={card.coverUrl ?? undefined}
						alt={card.title}
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
					{card.title}
				</Text>
				{subtitle && (
					<Text size="xs" variant="muted" className="truncate">
						{subtitle}
					</Text>
				)}
				<div className="gap-1.5 mt-1 flex items-center">
					<Badge size="xs">{upperFirst(candidate.provider)}</Badge>
					<ConfidenceBadge confidence={candidate.confidence} />
				</div>
			</div>

			<Button
				variant="secondary"
				size="sm"
				onClick={() => onSelect(candidate, index)}
				isLoading={isApplying}
				disabled={disabled}
				className="shrink-0"
			>
				Select
			</Button>
		</div>
	)
}
