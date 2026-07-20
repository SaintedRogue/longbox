import { Badge, Button, CheckBox, Text } from '@longbox/components'
import { OrganizeBucket, OrganizeDecisionInput, OrganizePreviewQuery } from '@longbox/graphql'

// Imported from the concrete module (not the `metadataMatching` barrel) so this
// file — and anything that imports it (including unit tests) — doesn't pull in
// unrelated heavy deps (react-markdown via MatchReviewDialog) that babel-jest
// can't transform.
import { ConfidenceBadge } from '@/components/metadata/metadataMatching/reviewDialog/ConfidenceBadge'

export type ProposedMove = NonNullable<
	OrganizePreviewQuery['organizePreview']
>['proposedMoves'][number]
export type UnmatchedFile = NonNullable<
	OrganizePreviewQuery['organizePreview']
>['unmatched'][number]

/** A user-picked series match from `OrganizeSeriesMatchDialog`, keyed by `src` in the caller's state. */
export type OrganizeOverride = {
	canonicalName: string
	year: number | null
	externalId: string
	provider: string
}

/** Basename of a path, for display only — moves are always keyed by full `src`. */
const basename = (p: string) => p.split('/').pop() ?? p

/**
 * Map the checked proposed moves into apply decisions, folding in any manual
 * per-row overrides picked via `OrganizeSeriesMatchDialog`. An override wins
 * over the auto-proposed match for the same `src` (including for a src that
 * had no auto match at all — i.e. a promoted "unmatched" row). Pure — unit
 * tested.
 */
export function toDecisions(
	moves: ProposedMove[],
	checked: Set<string>,
	overrides: Map<string, OrganizeOverride> = new Map(),
): OrganizeDecisionInput[] {
	const bySrc = new Map<string, OrganizeDecisionInput>()
	for (const m of moves) {
		if (!checked.has(m.src) || overrides.has(m.src)) continue
		bySrc.set(m.src, {
			src: m.src,
			seriesId: m.existingSeriesId ?? null,
			canonicalName: m.canonicalName,
			year: m.year ?? null,
			externalId: m.externalId,
			provider: m.provider,
		})
	}
	for (const [src, o] of overrides) {
		if (!checked.has(src)) continue
		bySrc.set(src, {
			src,
			seriesId: null,
			canonicalName: o.canonicalName,
			year: o.year,
			externalId: o.externalId,
			provider: o.provider,
		})
	}
	return [...bySrc.values()]
}

/** Seed passed to `OrganizeSeriesMatchDialog` when the user asks to find a match by hand. */
export type FindMatchSeed = { title: string; year: number | null }

export function MoveRow({
	move,
	override,
	checked,
	onToggle,
	onFindMatch,
	t,
}: {
	move: ProposedMove
	/** A manually-picked override for this row's `src`, if any — takes over the displayed target + badge. */
	override?: OrganizeOverride
	checked: boolean
	onToggle: () => void
	onFindMatch: (src: string, seed: FindMatchSeed) => void
	t: (key: string) => string
}) {
	const isAmbiguous = move.bucket === OrganizeBucket.Ambiguous
	const target = override
		? `${override.canonicalName}${override.year ? ` (${override.year})` : ''}`
		: move.year
			? `${move.canonicalName} (${move.year})`
			: move.canonicalName
	return (
		<div className="gap-3 p-2 flex items-center rounded-lg border border-border bg-background">
			<CheckBox
				id={`organize-${move.src.replace(/\W+/g, '-')}`}
				checked={checked}
				onClick={onToggle}
			/>
			<div className="min-w-0 flex-1">
				<Text size="sm" className="truncate">
					{basename(move.src)} → {target}
				</Text>
				<div className="gap-1.5 mt-1 flex items-center">
					{override ? (
						<Badge variant="primary" size="xs">
							{t(getSeriesMatchKey('manualBadge'))}
						</Badge>
					) : (
						<>
							<Badge size="xs">{move.provider}</Badge>
							<ConfidenceBadge confidence={move.confidence} />
							{isAmbiguous && (
								<Badge variant="warning" size="xs">
									{t(getKey('reviewBadge'))}
								</Badge>
							)}
						</>
					)}
				</div>
			</div>
			<Button
				variant="ghost"
				size="sm"
				className="shrink-0"
				onClick={() =>
					onFindMatch(move.src, { title: move.canonicalName, year: move.year ?? null })
				}
			>
				{t(getSeriesMatchKey('findMatch'))}
			</Button>
		</div>
	)
}

/** Renders the proposed-moves + "couldn't match" sections of an organize preview. */
export function PreviewRows({
	proposed,
	unmatched,
	checked,
	overrides,
	onToggle,
	onFindMatch,
	t,
}: {
	proposed: ProposedMove[]
	unmatched: UnmatchedFile[]
	checked: Set<string>
	/** Manual per-row overrides, keyed by `src`. A promoted (previously-unmatched) src is
	 *  rendered in the proposed section using the override; an already-proposed src whose
	 *  override is set has its display swapped to the override instead of the auto match. */
	overrides: Map<string, OrganizeOverride>
	onToggle: (src: string) => void
	onFindMatch: (src: string, seed: FindMatchSeed) => void
	t: (key: string) => string
}) {
	// An unmatched file the user found a manual match for is "promoted" into the
	// proposed section (rendered via a synthetic move built from the override) —
	// it never had auto-match fields (confidence/bucket/provider) of its own, but
	// `MoveRow` doesn't read those when an `override` is present.
	const promotedUnmatched = unmatched.filter((u) => overrides.has(u.src))
	const remainingUnmatched = unmatched.filter((u) => !overrides.has(u.src))

	const promotedMoves: ProposedMove[] = promotedUnmatched.map((u) => {
		const o = overrides.get(u.src)
		return {
			src: u.src,
			dst: '',
			canonicalName: o?.canonicalName ?? '',
			year: o?.year ?? null,
			externalId: o?.externalId ?? '',
			provider: o?.provider ?? '',
			confidence: 1,
			bucket: OrganizeBucket.Confident,
			existingSeriesId: null,
		}
	})

	const allProposed = [...proposed, ...promotedMoves]

	return (
		<div className="gap-6 flex flex-col">
			{allProposed.length > 0 && (
				<div className="gap-2 flex flex-col">
					<Text size="sm" className="font-medium">
						{t(getKey('proposedHeading'))}
					</Text>
					{allProposed.map((m) => (
						<MoveRow
							key={m.src}
							move={m}
							override={overrides.get(m.src)}
							checked={checked.has(m.src)}
							onToggle={() => onToggle(m.src)}
							onFindMatch={onFindMatch}
							t={t}
						/>
					))}
				</div>
			)}
			{remainingUnmatched.length > 0 && (
				<div className="gap-2 flex flex-col">
					<Text size="sm" className="font-medium">
						{t(getKey('unmatchedHeading'))}
					</Text>
					{remainingUnmatched.map((u) => (
						<div
							key={u.src}
							className="gap-3 p-2 flex items-center rounded-lg border border-border bg-background"
						>
							<div className="min-w-0 flex-1">
								<Text size="sm" className="truncate">
									{basename(u.src)}
								</Text>
								<Text size="xs" variant="muted">
									{u.reason}
								</Text>
							</div>
							<Button
								variant="ghost"
								size="sm"
								className="shrink-0"
								onClick={() =>
									onFindMatch(u.src, { title: u.parsedSeries ?? basename(u.src), year: null })
								}
							>
								{t(getSeriesMatchKey('findMatch'))}
							</Button>
						</div>
					))}
				</div>
			)}
		</div>
	)
}

const LOCALE_KEY = 'librarySettingsScene.options/organize.dialog'
const getKey = (key: string) => `${LOCALE_KEY}.${key}`

const SERIES_MATCH_LOCALE_KEY = 'librarySettingsScene.options/organize.seriesMatch'
const getSeriesMatchKey = (key: string) => `${SERIES_MATCH_LOCALE_KEY}.${key}`
