import { Badge, CheckBox, Text } from '@longbox/components'
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

/** Basename of a path, for display only — moves are always keyed by full `src`. */
const basename = (p: string) => p.split('/').pop() ?? p

/** Map the checked proposed moves into apply decisions. Pure — unit tested. */
export function toDecisions(moves: ProposedMove[], checked: Set<string>): OrganizeDecisionInput[] {
	return moves
		.filter((m) => checked.has(m.src))
		.map((m) => ({
			src: m.src,
			seriesId: m.existingSeriesId ?? null,
			canonicalName: m.canonicalName,
			year: m.year ?? null,
			externalId: m.externalId,
			provider: m.provider,
		}))
}

export function MoveRow({
	move,
	checked,
	onToggle,
	t,
}: {
	move: ProposedMove
	checked: boolean
	onToggle: () => void
	t: (key: string) => string
}) {
	const isAmbiguous = move.bucket === OrganizeBucket.Ambiguous
	const target = move.year ? `${move.canonicalName} (${move.year})` : move.canonicalName
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
					<Badge size="xs">{move.provider}</Badge>
					<ConfidenceBadge confidence={move.confidence} />
					{isAmbiguous && (
						<Badge variant="warning" size="xs">
							{t(getKey('reviewBadge'))}
						</Badge>
					)}
				</div>
			</div>
		</div>
	)
}

/** Renders the proposed-moves + "couldn't match" sections of an organize preview. */
export function PreviewRows({
	proposed,
	unmatched,
	checked,
	onToggle,
	t,
}: {
	proposed: ProposedMove[]
	unmatched: UnmatchedFile[]
	checked: Set<string>
	onToggle: (src: string) => void
	t: (key: string) => string
}) {
	return (
		<div className="gap-6 flex flex-col">
			{proposed.length > 0 && (
				<div className="gap-2 flex flex-col">
					<Text size="sm" className="font-medium">
						{t(getKey('proposedHeading'))}
					</Text>
					{proposed.map((m) => (
						<MoveRow
							key={m.src}
							move={m}
							checked={checked.has(m.src)}
							onToggle={() => onToggle(m.src)}
							t={t}
						/>
					))}
				</div>
			)}
			{unmatched.length > 0 && (
				<div className="gap-2 flex flex-col">
					<Text size="sm" className="font-medium">
						{t(getKey('unmatchedHeading'))}
					</Text>
					{unmatched.map((u) => (
						<div key={u.src} className="p-2 rounded-lg border border-border bg-background">
							<Text size="sm" className="truncate">
								{basename(u.src)}
							</Text>
							<Text size="xs" variant="muted">
								{u.reason}
							</Text>
						</div>
					))}
				</div>
			)}
		</div>
	)
}

const LOCALE_KEY = 'librarySettingsScene.options/organize.dialog'
const getKey = (key: string) => `${LOCALE_KEY}.${key}`
