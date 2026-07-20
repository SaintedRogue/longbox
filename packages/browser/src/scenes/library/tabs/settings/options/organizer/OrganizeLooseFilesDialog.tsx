import { useGraphQL, useGraphQLMutation, useJobStore, useSDK } from '@longbox/client'
import { Button, Dialog, Text } from '@longbox/components'
import { graphql, OrganizeBucket } from '@longbox/graphql'
import { useLocaleContext } from '@longbox/i18n'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'

import {
	FindMatchSeed,
	OrganizeOverride,
	PreviewRows,
	ProposedMove,
	toDecisions,
	UnmatchedFile,
} from './organizeMoves'
import OrganizeSeriesMatchDialog from './OrganizeSeriesMatchDialog'

const planMutation = graphql(`
	mutation OrganizeLooseFilesPlan($libraryId: ID!) {
		planOrganizeLooseFiles(libraryId: $libraryId)
	}
`)

const applyMutation = graphql(`
	mutation OrganizeLooseFilesApply($libraryId: ID!, $decisions: [OrganizeDecisionInput!]!) {
		applyOrganizeLooseFiles(libraryId: $libraryId, decisions: $decisions)
	}
`)

const previewQuery = graphql(`
	query OrganizePreview($libraryId: ID!) {
		organizePreview(libraryId: $libraryId) {
			proposedMoves {
				src
				dst
				canonicalName
				year
				externalId
				provider
				confidence
				bucket
				existingSeriesId
			}
			unmatched {
				src
				parsedSeries
				reason
			}
		}
	}
`)

type Props = { libraryId: string; open: boolean; onOpenChange: (open: boolean) => void }

export default function OrganizeLooseFilesDialog({ libraryId, open, onOpenChange }: Props) {
	const { t } = useLocaleContext()
	const { sdk } = useSDK()

	const [checked, setChecked] = useState<Set<string>>(new Set())
	const [overrides, setOverrides] = useState<Map<string, OrganizeOverride>>(new Map())
	const [matchTarget, setMatchTarget] = useState<{ src: string; seed: FindMatchSeed } | null>(null)
	const [awaitingPlan, setAwaitingPlan] = useState(false)
	const prevFetching = useRef(false)
	const sawRunningJob = useRef(false)

	const { data, isFetching } = useGraphQL(
		previewQuery,
		sdk.cacheKey('organizePreview', [libraryId]),
		{ libraryId },
		{ enabled: open },
	)
	const preview = data?.organizePreview ?? null
	// Memoized so identity only changes when `preview` itself changes — otherwise
	// `?? []` would mint a fresh array every render and defeat memoization below.
	const proposed = useMemo(() => preview?.proposedMoves ?? [], [preview])
	const unmatched = useMemo(() => preview?.unmatched ?? [], [preview])

	const { mutateAsync: plan } = useGraphQLMutation(planMutation)
	const { mutateAsync: apply, isPending: isApplying } = useGraphQLMutation(applyMutation)

	// Number of jobs currently running (from the global job-event store). Used to
	// detect when the plan job has finished — success OR failure — so the
	// "scanning" indicator never sticks on a failed plan (a failed plan emits no
	// JobOutput, so it never invalidates the preview or triggers the refetch below).
	const runningJobCount = useJobStore((state) => Object.keys(state.jobs).length)

	// Default-check Confident moves whenever a fresh preview arrives.
	useEffect(() => {
		if (preview) {
			setChecked(
				new Set(proposed.filter((m) => m.bucket === OrganizeBucket.Confident).map((m) => m.src)),
			)
		}
	}, [preview, proposed])

	// A refetch (triggered by the plan job completing → cache invalidation) has landed.
	useEffect(() => {
		if (prevFetching.current && !isFetching) {
			setAwaitingPlan(false)
		}
		prevFetching.current = isFetching
	}, [isFetching])

	// Fallback for the failure case: once a job we saw start has left the store,
	// stop waiting even if no preview refetch was triggered (a failed plan).
	useEffect(() => {
		if (!awaitingPlan) return
		if (runningJobCount > 0) {
			sawRunningJob.current = true
		} else if (sawRunningJob.current) {
			setAwaitingPlan(false)
			sawRunningJob.current = false
		}
	}, [awaitingPlan, runningJobCount])

	const handleScan = useCallback(async () => {
		sawRunningJob.current = false
		setAwaitingPlan(true)
		try {
			await plan({ libraryId })
			toast.success(t(getKey('scanStarted')))
		} catch (error) {
			setAwaitingPlan(false)
			toast.error(t(getKey('scanFailed')), {
				description: error instanceof Error ? error.message : undefined,
			})
		}
	}, [plan, libraryId, t])

	const toggle = useCallback((src: string) => {
		setChecked((prev) => {
			const next = new Set(prev)
			if (next.has(src)) next.delete(src)
			else next.add(src)
			return next
		})
	}, [])

	const handleFindMatch = useCallback((src: string, seed: FindMatchSeed) => {
		setMatchTarget({ src, seed })
	}, [])

	const handlePicked = useCallback((src: string, override: OrganizeOverride) => {
		setOverrides((prev) => new Map(prev).set(src, override))
		setChecked((prev) => new Set(prev).add(src))
	}, [])

	const handleApply = useCallback(async () => {
		const decisions = toDecisions(proposed, checked, overrides)
		if (decisions.length === 0) return
		try {
			await apply({ libraryId, decisions })
			toast.success(t(getKey('applyStarted')))
			onOpenChange(false)
		} catch (error) {
			toast.error(t(getKey('applyFailed')), {
				description: error instanceof Error ? error.message : undefined,
			})
		}
	}, [apply, libraryId, proposed, checked, overrides, onOpenChange, t])

	const busy = awaitingPlan || isFetching
	const checkedCount = checked.size

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<Dialog.Content size="xl" className="flex max-h-[85vh] flex-col">
				<Dialog.Header>
					<Dialog.Title>{t(getKey('title'))}</Dialog.Title>
					<Dialog.Description>{t(getKey('description'))}</Dialog.Description>
					<Dialog.Close />
				</Dialog.Header>

				<div className="gap-4 min-h-0 flex flex-col">
					<div className="gap-2 flex items-center">
						<Button size="sm" onClick={handleScan} isLoading={busy}>
							{preview ? t(getKey('rescan')) : t(getKey('scan'))}
						</Button>
						{busy && (
							<Text size="sm" variant="muted">
								{t(getKey('scanning'))}
							</Text>
						)}
					</div>

					<div className="min-h-0 flex-1 overflow-y-auto">
						<PreviewBody
							preview={preview}
							busy={busy}
							proposed={proposed}
							unmatched={unmatched}
							checked={checked}
							overrides={overrides}
							onToggle={toggle}
							onFindMatch={handleFindMatch}
							t={t}
						/>
					</div>
				</div>

				<Dialog.Footer>
					<Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
						{t(getKey('cancel'))}
					</Button>
					<Button
						size="sm"
						onClick={handleApply}
						isLoading={isApplying}
						disabled={checkedCount === 0 || busy}
					>
						{t(getKey('apply'), { count: checkedCount })}
					</Button>
				</Dialog.Footer>
			</Dialog.Content>
			{matchTarget && (
				<OrganizeSeriesMatchDialog
					libraryId={libraryId}
					src={matchTarget.src}
					seed={matchTarget.seed}
					open
					onOpenChange={(o) => !o && setMatchTarget(null)}
					onPicked={handlePicked}
				/>
			)}
		</Dialog>
	)
}

function PreviewBody({
	preview,
	busy,
	proposed,
	unmatched,
	checked,
	overrides,
	onToggle,
	onFindMatch,
	t,
}: {
	preview: unknown
	busy: boolean
	proposed: ProposedMove[]
	unmatched: UnmatchedFile[]
	checked: Set<string>
	overrides: Map<string, OrganizeOverride>
	onToggle: (src: string) => void
	onFindMatch: (src: string, seed: FindMatchSeed) => void
	t: (key: string) => string
}) {
	if (busy && !preview) {
		return (
			<Text size="sm" variant="muted" className="py-10 text-center">
				{t(getKey('scanning'))}
			</Text>
		)
	}
	if (!preview) {
		return (
			<Text size="sm" variant="muted" className="py-10 text-center">
				{t(getKey('idle'))}
			</Text>
		)
	}
	if (proposed.length === 0 && unmatched.length === 0) {
		return (
			<Text size="sm" variant="muted" className="py-10 text-center">
				{t(getKey('empty'))}
			</Text>
		)
	}
	return (
		<PreviewRows
			proposed={proposed}
			unmatched={unmatched}
			checked={checked}
			overrides={overrides}
			onToggle={onToggle}
			onFindMatch={onFindMatch}
			t={t}
		/>
	)
}

const LOCALE_KEY = 'librarySettingsScene.options/organize.dialog'
const getKey = (key: string) => `${LOCALE_KEY}.${key}`
