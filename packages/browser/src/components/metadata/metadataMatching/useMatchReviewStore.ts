import { MergeStrategy, MetadataField } from '@longbox/graphql'
import { create } from 'zustand'

import { FieldOverride, MatchRecord } from './types'

export type MatchReviewState = {
	isOpen: boolean
	records: MatchRecord[]
	currentRecordIndex: number
	currentCandidateIndex: number
	excludedFields: Set<MetadataField>
	strategy: MergeStrategy
	fieldOverrides: Map<MetadataField, FieldOverride>
	lockedFields: Map<MetadataField, boolean>

	open: (records: MatchRecord[], startIndex?: number, startCandidateIndex?: number) => void
	close: () => void
	nextRecord: () => void
	prevRecord: () => void
	nextCandidate: () => void
	prevCandidate: () => void
	selectCandidate: (index: number) => void
	/** Drop a rejected candidate from the record in place. Returns what is left. */
	dropCandidate: (index: number) => number
	toggleField: (field: MetadataField) => void
	resetExcludedFields: () => void
	setStrategy: (strategy: MergeStrategy) => void
	setFieldOverride: (field: MetadataField, override: FieldOverride) => void
	clearFieldOverride: (field: MetadataField) => void
	clearAllOverrides: () => void
	toggleLockedField: (field: MetadataField) => void
	getLockedFields: () => Set<MetadataField>
}

export const useMatchReviewStore = create<MatchReviewState>((set, get) => ({
	isOpen: false,
	records: [],
	currentRecordIndex: 0,
	currentCandidateIndex: 0,
	excludedFields: new Set(),
	strategy: MergeStrategy.FillGaps,
	fieldOverrides: new Map(),
	lockedFields: new Map(),

	/*
	 * `startCandidateIndex` exists for the on-demand provider search, which lands here with a
	 * candidate the user has already picked out of a result grid. Opening on candidate 0 would
	 * quietly review a different match than the one they clicked.
	 */
	open: (records, startIndex = 0, startCandidateIndex = 0) =>
		set({
			isOpen: true,
			records,
			currentRecordIndex: Math.min(startIndex, records.length - 1),
			currentCandidateIndex: startCandidateIndex,
			excludedFields: new Set(),
			fieldOverrides: new Map(),
			lockedFields: new Map(),
		}),

	close: () =>
		set({
			isOpen: false,
			records: [],
			currentRecordIndex: 0,
			currentCandidateIndex: 0,
			excludedFields: new Set(),
			fieldOverrides: new Map(),
			lockedFields: new Map(),
		}),

	nextRecord: () => {
		const { currentRecordIndex, records } = get()
		if (currentRecordIndex < records.length - 1) {
			set({
				currentRecordIndex: currentRecordIndex + 1,
				currentCandidateIndex: 0,
				excludedFields: new Set(),
				fieldOverrides: new Map(),
				lockedFields: new Map(),
			})
		}
	},

	prevRecord: () => {
		const { currentRecordIndex } = get()
		if (currentRecordIndex > 0) {
			set({
				currentRecordIndex: currentRecordIndex - 1,
				currentCandidateIndex: 0,
				excludedFields: new Set(),
				fieldOverrides: new Map(),
				lockedFields: new Map(),
			})
		}
	},

	nextCandidate: () => {
		const { currentCandidateIndex, records, currentRecordIndex } = get()
		const record = records[currentRecordIndex]
		const candidates = record?.matchCandidates ?? []
		if (currentCandidateIndex < candidates.length - 1) {
			set({ currentCandidateIndex: currentCandidateIndex + 1 })
		}
	},

	prevCandidate: () => {
		const { currentCandidateIndex } = get()
		if (currentCandidateIndex > 0) {
			set({ currentCandidateIndex: currentCandidateIndex - 1 })
		}
	},

	/*
	 * Field-level decisions belong to the candidate they were made against, so switching
	 * candidates clears them -- carrying an "exclude the summary" from one provider's
	 * result onto another's would silently exclude a value the user never looked at.
	 */
	selectCandidate: (index) =>
		set({
			currentCandidateIndex: index,
			excludedFields: new Set(),
			fieldOverrides: new Map(),
		}),

	/*
	 * Rejecting removes a single candidate server-side; the record itself stays pending as
	 * long as it has others. Mirroring that here is what stops a rejected candidate sitting
	 * on screen, and stops the review jumping to the next record with options still unseen.
	 */
	dropCandidate: (index) => {
		const { records, currentRecordIndex, currentCandidateIndex } = get()
		const record = records[currentRecordIndex]
		if (!record) return 0

		const remaining = (record.matchCandidates ?? []).filter((_, i) => i !== index)
		const nextRecords = records.map((entry, i) =>
			i === currentRecordIndex ? { ...entry, matchCandidates: remaining } : entry,
		)

		set({
			records: nextRecords,
			// Keep the position where it was, clamped -- rejecting candidate 3 of 5 should land
			// on the one that moved into slot 3, not send you back to the top of the list.
			currentCandidateIndex: Math.max(0, Math.min(currentCandidateIndex, remaining.length - 1)),
			excludedFields: new Set(),
			fieldOverrides: new Map(),
		})

		return remaining.length
	},

	toggleField: (field) =>
		set((state) => {
			const next = new Set(state.excludedFields)
			if (next.has(field)) {
				next.delete(field)
			} else {
				next.add(field)
			}
			return { excludedFields: next }
		}),

	resetExcludedFields: () => set({ excludedFields: new Set() }),

	setStrategy: (strategy) => set({ strategy }),

	setFieldOverride: (field, override) =>
		set((state) => {
			const next = new Map(state.fieldOverrides)
			next.set(field, override)
			return { fieldOverrides: next }
		}),

	clearFieldOverride: (field) =>
		set((state) => {
			const next = new Map(state.fieldOverrides)
			next.delete(field)
			return { fieldOverrides: next }
		}),

	clearAllOverrides: () => set({ fieldOverrides: new Map() }),

	toggleLockedField: (field) =>
		set((state) => {
			const next = new Map(state.lockedFields)
			const record = state.records[state.currentRecordIndex]
			const serverLocked: MetadataField[] =
				(record?.mediaId
					? record?.media?.metadata?.lockedFields
					: record?.series?.metadata?.lockedFields) ?? []
			const isCurrentlyLocked = next.has(field) ? next.get(field)! : serverLocked.includes(field)
			next.set(field, !isCurrentlyLocked)
			return { lockedFields: next }
		}),

	getLockedFields: () => {
		const { records, currentRecordIndex, lockedFields } = get()
		const record = records[currentRecordIndex]
		const serverLocked: MetadataField[] =
			(record?.mediaId
				? record?.media?.metadata?.lockedFields
				: record?.series?.metadata?.lockedFields) ?? []
		const result = new Set<MetadataField>(serverLocked)
		for (const [field, locked] of lockedFields) {
			if (locked) {
				result.add(field)
			} else {
				result.delete(field)
			}
		}
		return result
	},
}))
