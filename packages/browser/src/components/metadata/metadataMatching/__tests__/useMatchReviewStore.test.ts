import { MatchRecord } from '../types'
import { useMatchReviewStore } from '../useMatchReviewStore'

/**
 * Rejecting removes one *candidate* server-side; the record stays awaiting review while it
 * still has others. The dialog used to advance to the next record anyway, which is why a
 * rejected row never disappeared from the pending list and later came back showing a
 * different match -- its remaining candidates were skipped, never reviewed.
 */

const candidate = (externalId: string) =>
	({ provider: 'COMIC_VINE', externalId, confidence: 0.5, metadata: {} }) as never

const recordWith = (ids: string[]) =>
	({ id: 1, mediaId: 'book-1', matchCandidates: ids.map(candidate) }) as unknown as MatchRecord

const idsInStore = () =>
	(useMatchReviewStore.getState().records[0]?.matchCandidates ?? []).map(
		(c: { externalId: string }) => c.externalId,
	)

beforeEach(() => {
	useMatchReviewStore.getState().close()
})

describe('dropCandidate', () => {
	it('removes just the rejected candidate', () => {
		useMatchReviewStore.getState().open([recordWith(['a', 'b', 'c'])])

		const remaining = useMatchReviewStore.getState().dropCandidate(1)

		expect(remaining).toBe(2)
		expect(idsInStore()).toEqual(['a', 'c'])
	})

	it('keeps the record itself while candidates remain', () => {
		useMatchReviewStore.getState().open([recordWith(['a', 'b'])])
		useMatchReviewStore.getState().dropCandidate(0)

		expect(useMatchReviewStore.getState().records).toHaveLength(1)
		expect(useMatchReviewStore.getState().isOpen).toBe(true)
	})

	/** Rejecting the 2nd of 3 should land on whatever moved into that slot, not jump home. */
	it('holds the position rather than resetting to the first candidate', () => {
		useMatchReviewStore.getState().open([recordWith(['a', 'b', 'c'])])
		useMatchReviewStore.getState().selectCandidate(1)

		useMatchReviewStore.getState().dropCandidate(1)

		expect(useMatchReviewStore.getState().currentCandidateIndex).toBe(1)
		expect(idsInStore()[1]).toBe('c')
	})

	it('clamps onto the last candidate when the final one is rejected', () => {
		useMatchReviewStore.getState().open([recordWith(['a', 'b'])])
		useMatchReviewStore.getState().selectCandidate(1)

		useMatchReviewStore.getState().dropCandidate(1)

		expect(useMatchReviewStore.getState().currentCandidateIndex).toBe(0)
	})

	it('reports nothing left when the last candidate goes', () => {
		useMatchReviewStore.getState().open([recordWith(['a'])])

		expect(useMatchReviewStore.getState().dropCandidate(0)).toBe(0)
	})

	it('leaves other records untouched', () => {
		useMatchReviewStore.getState().open([recordWith(['a', 'b']), recordWith(['x', 'y'])])
		useMatchReviewStore.getState().dropCandidate(0)

		const second = useMatchReviewStore.getState().records[1]
		expect(second?.matchCandidates).toHaveLength(2)
	})
})

describe('selectCandidate', () => {
	it('moves straight to any candidate', () => {
		useMatchReviewStore.getState().open([recordWith(['a', 'b', 'c'])])
		useMatchReviewStore.getState().selectCandidate(2)

		expect(useMatchReviewStore.getState().currentCandidateIndex).toBe(2)
	})

	/**
	 * Field decisions belong to the candidate they were made against -- an "exclude the
	 * summary" aimed at one provider's result must not silently apply to another's.
	 */
	it('clears field decisions made against the previous candidate', () => {
		useMatchReviewStore.getState().open([recordWith(['a', 'b'])])
		useMatchReviewStore.getState().toggleField('TITLE' as never)
		expect(useMatchReviewStore.getState().excludedFields.size).toBe(1)

		useMatchReviewStore.getState().selectCandidate(1)

		expect(useMatchReviewStore.getState().excludedFields.size).toBe(0)
	})
})

describe('open', () => {
	it('opens on the candidate it was given', () => {
		useMatchReviewStore.getState().open([recordWith(['a', 'b', 'c'])], 0, 2)

		expect(useMatchReviewStore.getState().currentCandidateIndex).toBe(2)
	})
})
