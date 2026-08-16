import { Card, cn, Heading, Text } from '@longbox/components'
import { useLocaleContext } from '@longbox/i18n'
import { useOverlayScrollbars } from 'overlayscrollbars-react'
import { useEffect, useMemo, useRef } from 'react'

import { usePreferences } from '@/hooks/usePreferences'
import { useTheme } from '@/hooks/useTheme'
import {
	PARTIAL_SEARCH_PROVIDERS,
	providerFromId,
} from '@/scenes/settings/server/metadataIntegrations/providers/constants'

import {
	FieldComparison,
	getMediaFieldComparisons,
	getSeriesFieldComparisons,
	isMediaCandidate,
} from '../types'
import { useCandidateMetadata } from '../useCandidateMetadata'
import { useEnrichmentPool } from '../useEnrichmentPool'
import { useMatchReviewStore } from '../useMatchReviewStore'
import { CandidateToolbar } from './CandidateToolbar'
import { MatchFieldRow } from './MatchFieldRow'

export function MatchPreviewEditor() {
	const { t } = useLocaleContext()
	const {
		preferences: { enableHideScrollbar },
	} = usePreferences()
	const { records, currentRecordIndex, currentCandidateIndex } = useMatchReviewStore()

	const record = records[currentRecordIndex]
	const candidate = record?.matchCandidates?.[currentCandidateIndex]
	const isMedia = !!record?.mediaId
	const currentMetadata = isMedia ? record?.media?.metadata : record?.series?.metadata

	// Every provider that has answered for this entity, not just the candidate under
	// review. The provider whose candidate is being reviewed is dropped: its values are
	// already the "incoming" column, so offering them again as a chip is noise.
	const { sources, fieldSources } = useEnrichmentPool({
		id: (isMedia ? record?.mediaId : record?.seriesId) ?? undefined,
		isMedia,
	})
	const otherSources = useMemo(
		() => sources.filter((source) => source.provider !== candidate?.provider),
		[sources, candidate?.provider],
	)
	const provenanceByField = useMemo(
		() => new Map(fieldSources.map((row) => [row.field, row])),
		[fieldSources],
	)

	// A search result from a list-view provider carries a title, publisher, cover and date
	// and nothing else, so comparing against it shows a column of dashes. Fetch the real
	// thing for the candidate that is actually on screen — one request, not one per result.
	//
	// `candidate.provider` is the provider *trait id* (`locg`), not the `MetadataProvider`
	// enum (`LOCG`), so it has to be translated before it is either compared or sent. Both
	// failures here are silent: the set lookup just misses, and the column quietly shows
	// the thin search card as though that were all the provider knew.
	const candidateProvider = providerFromId(candidate?.provider)
	const { metadata: fetched, isLoading: isLoadingMetadata } = useCandidateMetadata({
		provider: candidateProvider,
		externalId: candidate?.externalId,
		isMedia,
		enabled: !!candidateProvider && PARTIAL_SEARCH_PROVIDERS.has(candidateProvider),
	})

	const fieldComparisons: FieldComparison[] = useMemo(() => {
		if (!candidate) return []
		// Prefer the fetched page; fall back to the search result while it loads or if it
		// failed, since a thin candidate is still a valid match to accept.
		const meta = (fetched ?? candidate.metadata) as Record<string, unknown>
		if (isMedia && isMediaCandidate(candidate.metadata)) {
			return getMediaFieldComparisons(currentMetadata, meta)
		} else if (!isMedia && !isMediaCandidate(candidate.metadata)) {
			return getSeriesFieldComparisons(currentMetadata, meta)
		}
		return []
	}, [candidate, fetched, currentMetadata, isMedia])

	const scrollRef = useRef<HTMLDivElement>(null)

	const { isDarkVariant } = useTheme()
	const [initialize] = useOverlayScrollbars({
		options: {
			scrollbars: {
				theme: isDarkVariant ? 'os-theme-light' : 'os-theme-dark',
			},
		},
	})

	useEffect(() => {
		const { current: scrollContainer } = scrollRef
		if (scrollContainer && !enableHideScrollbar) {
			initialize(scrollContainer)
		}
	}, [initialize, enableHideScrollbar])

	if (!candidate) {
		return (
			<div className="py-12 flex flex-1 items-center justify-center">
				<Text variant="muted">{t(getKey('noCandidates'))}</Text>
			</div>
		)
	}

	// Note: I didn't use a table because I couldn't quite get the layout I wanted
	return (
		<>
			<CandidateToolbar />
			<div
				className={cn('p-4 overflow-y-auto rounded-xl bg-border/25', {
					'scrollbar-hide': enableHideScrollbar,
				})}
				ref={scrollRef}
				data-overlayscrollbars-initialize
			>
				<Card className="overflow-hidden">
					<div className="py-2.5 pl-2.5 grid grid-cols-[140px_1fr_1fr_40px_1fr_32px] items-center border-b border-border bg-muted/50">
						<Heading className="text-sm font-medium">{t(getKey('headers.field'))}</Heading>
						<Heading className="text-sm font-medium">{t(getKey('headers.current'))}</Heading>
						<div className="gap-2 flex items-center">
							<Heading className="text-sm font-medium">{t(getKey('headers.external'))}</Heading>
							{/* Otherwise this column reads as "the provider has nothing" for the
							    moment before the fetched page arrives, and the values then change
							    under the reader. */}
							{isLoadingMetadata && (
								<Text size="xs" variant="muted">
									loading&hellip;
								</Text>
							)}
						</div>
						<div />
						<Heading className="text-sm font-medium">{t(getKey('headers.resolved'))}</Heading>
						<div />
					</div>

					<div className="divide-y divide-border">
						{fieldComparisons.map((comparison) => (
							<MatchFieldRow
								key={comparison.field}
								comparison={comparison}
								otherSources={otherSources}
								provenance={provenanceByField.get(comparison.field)}
							/>
						))}
						{fieldComparisons.length === 0 && (
							<div className="py-12 flex items-center justify-center">
								<Text variant="muted">{t(getKey('noComparableFields'))}</Text>
							</div>
						)}
					</div>
				</Card>
			</div>
			<div className="flex-1" />
		</>
	)
}

const LOCALE_KEY = 'metadataMatching.reviewDialog.previewEditor'
const getKey = (key: string) => `${LOCALE_KEY}.${key}`
