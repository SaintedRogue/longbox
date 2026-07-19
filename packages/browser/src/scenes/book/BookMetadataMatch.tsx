import { useGraphQLMutation, useSDK } from '@longbox/client'
import { Button, cn, Input, Popover, Text } from '@longbox/components'
import {
	FragmentType,
	graphql,
	MetadataFetchStatus,
	useFragment,
	UserPermission,
} from '@longbox/graphql'
import { useQueryClient } from '@tanstack/react-query'
import { Wand2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import {
	MatchReviewDialog,
	pendingMatchRecordFragment,
	useMatchReviewStore,
} from '@/components/metadata/metadataMatching'
import { useAppContext } from '@/context'

// Search context for the issue: the raw filename (what the parser reads) plus the
// series it belongs to, so we can offer a series-level match too.
const searchContextQuery = graphql(`
	query BookMetadataSearchContext($media: ID!) {
		mediaById(id: $media) {
			id
			name
			series {
				id
				name
			}
		}
	}
`)

// Run the *same* server-side filename parser that drives auto-matching against both
// the issue filename and the series name, so the manual fields start pre-filled and
// there is no duplicated parsing logic on the client.
const parseNamesQuery = graphql(`
	query ParseComicNames($issueName: String!, $seriesName: String!) {
		issue: parseComicFilename(name: $issueName) {
			series
			number
			year
		}
		series: parseComicFilename(name: $seriesName) {
			series
			year
		}
	}
`)

const findMediaMatchMutation = graphql(`
	mutation BookFindMetadataMatch($id: ID!, $query: MetadataSearchInput) {
		fetchMediaMetadata(id: $id, query: $query) {
			provider
		}
	}
`)

const findSeriesMatchMutation = graphql(`
	mutation SeriesFindMetadataMatch($id: ID!, $query: MetadataSearchInput) {
		fetchSeriesMetadata(id: $id, query: $query) {
			provider
		}
	}
`)

const mediaFetchRecordQuery = graphql(`
	query BookMetadataFetchRecord($media: String!) {
		metadataFetchRecord(id: { media: $media }) {
			...PendingMatchRecord
		}
	}
`)

const seriesFetchRecordQuery = graphql(`
	query SeriesMetadataFetchRecord($series: String!) {
		metadataFetchRecord(id: { series: $series }) {
			...PendingMatchRecord
		}
	}
`)

type Props = {
	mediaId: string
}

type SearchMode = 'issue' | 'series'

type SearchContext = {
	name: string
	series: { id: string; name: string } | null
}

const toYear = (value: string): number | null => {
	const trimmed = value.trim()
	if (!trimmed) {
		return null
	}
	const parsed = Number.parseInt(trimmed, 10)
	return Number.isFinite(parsed) ? parsed : null
}

const trimmedOrNull = (value: string): string | null => value.trim() || null

/**
 * Per-issue "Find metadata match" action for the book detail page. Opens a small
 * search form whose fields are pre-filled by the server-side filename parser, lets the
 * user refine the series title / issue number / year / publisher before searching, and
 * can search either this issue or its whole series. Results flow into the shared review
 * dialog (or report an auto-applied high-confidence match). Reuses the metadataMatching
 * dialog/store; no new review UI.
 */
export default function BookMetadataMatch({ mediaId }: Props) {
	const { sdk } = useSDK()
	const client = useQueryClient()
	const { checkPermission } = useAppContext()
	const openReview = useMatchReviewStore((state) => state.open)
	const isReviewOpen = useMatchReviewStore((state) => state.isOpen)

	const [isOpen, setIsOpen] = useState(false)
	const [mode, setMode] = useState<SearchMode>('issue')
	const [context, setContext] = useState<SearchContext | null>(null)
	const [isLoadingContext, setIsLoadingContext] = useState(false)
	const [isSearching, setIsSearching] = useState(false)
	const [pendingRecord, setPendingRecord] = useState<
		FragmentType<typeof pendingMatchRecordFragment> | null | undefined
	>(null)

	// Editable issue fields.
	const [issueTitle, setIssueTitle] = useState('')
	const [issueNumber, setIssueNumber] = useState('')
	const [issueYear, setIssueYear] = useState('')
	const [issuePublisher, setIssuePublisher] = useState('')

	// Editable series fields.
	const [seriesTitle, setSeriesTitle] = useState('')
	const [seriesYear, setSeriesYear] = useState('')

	const wasReviewOpen = useRef(false)

	const { mutateAsync: findMediaMatch } = useGraphQLMutation(findMediaMatchMutation)
	const { mutateAsync: findSeriesMatch } = useGraphQLMutation(findSeriesMatchMutation)

	const invalidateBook = useCallback(() => {
		void client.invalidateQueries({ queryKey: sdk.cacheKey('bookOverview', [mediaId]) })
	}, [client, sdk, mediaId])

	// Load the issue/series context and seed every field from the parser. Runs once per
	// panel open (until closed), in the open handler rather than an effect to keep the
	// async flow out of the render path.
	const loadContext = useCallback(async () => {
		setIsLoadingContext(true)
		try {
			const { mediaById } = await sdk.execute(searchContextQuery, { media: mediaId })
			if (!mediaById) {
				return
			}

			const series = mediaById.series ?? null
			const { issue, series: parsedSeries } = await sdk.execute(parseNamesQuery, {
				issueName: mediaById.name,
				seriesName: series?.name ?? '',
			})

			setContext({ name: mediaById.name, series })
			setIssueTitle(issue.series ?? '')
			setIssueNumber(issue.number ?? '')
			setIssueYear(issue.year != null ? String(issue.year) : '')
			setIssuePublisher('')
			setSeriesTitle(parsedSeries.series ?? series?.name ?? '')
			setSeriesYear(parsedSeries.year != null ? String(parsedSeries.year) : '')
		} catch (error) {
			toast.error('Failed to prepare the metadata search.', {
				description: error instanceof Error ? error.message : undefined,
			})
		} finally {
			setIsLoadingContext(false)
		}
	}, [sdk, mediaId])

	const handleOpenChange = (nowOpen: boolean) => {
		setIsOpen(nowOpen)
		if (nowOpen && !context && !isLoadingContext) {
			void loadContext()
		}
	}

	const record = useFragment(pendingMatchRecordFragment, pendingRecord)

	// When a search resolves a fetch record, branch on its status: open the review
	// dialog for candidates awaiting review, or surface *why* nothing opened (no match,
	// auto-applied, rate-limited) instead of a single opaque "no matches" message.
	useEffect(() => {
		if (!record) {
			return
		}
		switch (record.status) {
			case MetadataFetchStatus.AwaitingReview:
				setIsOpen(false)
				openReview([record], 0)
				break
			case MetadataFetchStatus.Fetched:
			case MetadataFetchStatus.Matched:
				toast.success('A high-confidence match was applied automatically.')
				invalidateBook()
				break
			case MetadataFetchStatus.RateLimited:
				toast.warning('A provider is rate-limited. Try again in a little while.')
				break
			default:
				toast.info('No matches found. Try adjusting the search terms.')
				break
		}
		setPendingRecord(null)
	}, [record, openReview, invalidateBook])

	// Accepting a match inside the dialog mutates metadata; refresh the book once the
	// dialog closes so the new title/credits show without a manual reload.
	useEffect(() => {
		if (wasReviewOpen.current && !isReviewOpen) {
			invalidateBook()
		}
		wasReviewOpen.current = isReviewOpen
	}, [isReviewOpen, invalidateBook])

	if (
		!checkPermission(UserPermission.MetadataFetchRecordManage) ||
		!checkPermission(UserPermission.MetadataFetchRecordRead)
	) {
		return null
	}

	const handleSearch = async () => {
		setIsSearching(true)
		try {
			if (mode === 'issue') {
				await findMediaMatch({
					id: mediaId,
					query: {
						title: trimmedOrNull(issueTitle),
						number: trimmedOrNull(issueNumber),
						year: toYear(issueYear),
						publisher: trimmedOrNull(issuePublisher),
					},
				})
				const { metadataFetchRecord } = await sdk.execute(mediaFetchRecordQuery, {
					media: mediaId,
				})
				if (!metadataFetchRecord) {
					toast.info('No matches found. Try adjusting the search terms.')
					return
				}
				setPendingRecord(metadataFetchRecord)
			} else {
				const seriesId = context?.series?.id
				if (!seriesId) {
					toast.error(
						'This issue is not part of a series, so it can’t be matched at the series level.',
					)
					return
				}
				await findSeriesMatch({
					id: seriesId,
					query: {
						title: trimmedOrNull(seriesTitle),
						year: toYear(seriesYear),
					},
				})
				const { metadataFetchRecord } = await sdk.execute(seriesFetchRecordQuery, {
					series: seriesId,
				})
				if (!metadataFetchRecord) {
					toast.info('No matches found. Try adjusting the search terms.')
					return
				}
				setPendingRecord(metadataFetchRecord)
			}
		} catch (error) {
			toast.error('Failed to search for metadata.', {
				description: error instanceof Error ? error.message : undefined,
			})
		} finally {
			setIsSearching(false)
		}
	}

	const hasSeries = !!context?.series

	return (
		<>
			<Popover open={isOpen} onOpenChange={handleOpenChange}>
				<Popover.Trigger asChild>
					<Button variant="secondary" size="sm">
						<Wand2 className="mr-1.5 h-4 w-4" />
						Find metadata match
					</Button>
				</Popover.Trigger>
				<Popover.Content size="md" align="end">
					<div className="gap-3 flex flex-col">
						<div className="gap-0.5 flex flex-col">
							<Text size="sm" className="font-medium">
								Search metadata providers
							</Text>
							<Text size="xs" variant="muted">
								Fields are pre-filled from the filename — edit them to refine the match.
							</Text>
						</div>

						{/* Issue vs. series scope. */}
						<div className="gap-1 p-0.5 flex rounded-md bg-muted">
							<ScopeButton
								label="This issue"
								active={mode === 'issue'}
								onClick={() => setMode('issue')}
							/>
							<ScopeButton
								label="Whole series"
								active={mode === 'series'}
								disabled={!hasSeries}
								onClick={() => setMode('series')}
							/>
						</div>

						{isLoadingContext ? (
							<Text size="sm" variant="muted" className="py-4 text-center">
								Reading the filename…
							</Text>
						) : mode === 'issue' ? (
							<div className="gap-2 flex flex-col">
								<Input
									label="Series / title"
									value={issueTitle}
									onChange={(e) => setIssueTitle(e.target.value)}
									placeholder="e.g. Absolute Batman"
									fullWidth
								/>
								<div className="gap-2 grid grid-cols-2">
									<Input
										label="Issue #"
										value={issueNumber}
										onChange={(e) => setIssueNumber(e.target.value)}
										placeholder="1"
										fullWidth
									/>
									<Input
										label="Year"
										value={issueYear}
										onChange={(e) => setIssueYear(e.target.value)}
										placeholder="2024"
										inputMode="numeric"
										fullWidth
									/>
								</div>
								<Input
									label="Publisher"
									value={issuePublisher}
									onChange={(e) => setIssuePublisher(e.target.value)}
									placeholder="Optional"
									fullWidth
								/>
							</div>
						) : (
							<div className="gap-2 flex flex-col">
								<Input
									label="Series title"
									value={seriesTitle}
									onChange={(e) => setSeriesTitle(e.target.value)}
									placeholder="e.g. Absolute Batman"
									fullWidth
								/>
								<Input
									label="Year"
									value={seriesYear}
									onChange={(e) => setSeriesYear(e.target.value)}
									placeholder="2025"
									inputMode="numeric"
									containerClassName="w-28"
									fullWidth
								/>
							</div>
						)}

						<Button
							variant="default"
							size="sm"
							onClick={handleSearch}
							isLoading={isSearching}
							disabled={isSearching || isLoadingContext}
						>
							<Wand2 className="mr-1.5 h-4 w-4" />
							Search
						</Button>
					</div>
				</Popover.Content>
			</Popover>
			<MatchReviewDialog />
		</>
	)
}

function ScopeButton({
	label,
	active,
	disabled,
	onClick,
}: {
	label: string
	active: boolean
	disabled?: boolean
	onClick: () => void
}) {
	return (
		<button
			type="button"
			disabled={disabled}
			onClick={onClick}
			className={cn(
				'rounded px-2 py-1 text-xs font-medium flex-1 transition-colors',
				active
					? 'shadow-sm bg-background text-foreground'
					: 'text-muted-foreground hover:text-foreground',
				disabled && 'cursor-not-allowed opacity-50 hover:text-muted-foreground',
			)}
		>
			{label}
		</button>
	)
}
