import { Button, cn, Text } from '@longbox/components'
import { upperFirst } from 'lodash'
import { Check } from 'lucide-react'

import { isMediaCandidate } from '../types'
import { useMatchReviewStore } from '../useMatchReviewStore'
import { ConfidenceBadge } from './ConfidenceBadge'

/**
 * Every candidate for the record, laid out at once.
 *
 * This was a prev/next stepper showing "2 of 9". With nine results from three providers
 * that meant clicking through the whole list to find out what was on offer, and holding
 * the ones you had already seen in your head. Reviewing a match is a comparison, so the
 * options have to be comparable side by side.
 */
export function CandidateToolbar() {
	const { records, currentRecordIndex, currentCandidateIndex, selectCandidate } =
		useMatchReviewStore()

	const record = records[currentRecordIndex]
	const candidates = record?.matchCandidates ?? []

	if (!candidates.length) return null

	return (
		<div className="gap-1 px-1 max-h-40 flex flex-col overflow-y-auto">
			{candidates.map((candidate, index) => {
				const isSelected = index === currentCandidateIndex
				return (
					<Button
						key={`${candidate.provider}-${candidate.externalId}`}
						variant="ghost"
						onClick={() => selectCandidate(index)}
						className={cn(
							'px-2 py-1.5 gap-3 flex h-auto w-full items-center justify-start text-left',
							isSelected && 'bg-muted',
						)}
					>
						<Check
							className={cn('h-4 w-4 shrink-0', isSelected ? 'text-foreground' : 'opacity-0')}
						/>

						<Text size="sm" className="min-w-0 flex-1 truncate">
							{getCandidateTitle(candidate) ?? 'Untitled result'}
						</Text>

						<Text size="xs" variant="muted" className="shrink-0">
							{upperFirst(candidate.provider)}
						</Text>

						<ConfidenceBadge confidence={candidate.confidence} />
					</Button>
				)
			})}
		</div>
	)
}

/**
 * Media candidates carry `title`; series candidates carry it as `seriesTitle`, because the
 * fragment aliases it to keep the two apart in one selection set.
 */
const getCandidateTitle = (candidate: { metadata: { __typename: string } }): string | null => {
	const metadata = candidate.metadata as unknown as Record<string, unknown> | null
	if (!metadata) return null
	const title = isMediaCandidate(candidate.metadata) ? metadata.title : metadata.seriesTitle
	return typeof title === 'string' && title ? title : null
}
