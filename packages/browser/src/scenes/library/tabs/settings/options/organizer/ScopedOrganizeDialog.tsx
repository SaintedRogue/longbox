import { useGraphQL, useGraphQLMutation, useSDK } from '@longbox/client'
import { Button, Dialog, Text } from '@longbox/components'
import { graphql, OrganizeBucket } from '@longbox/graphql'
import { useLocaleContext } from '@longbox/i18n'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'

import { PreviewRows, toDecisions } from './organizeMoves'

const previewForPathQuery = graphql(`
	query OrganizePreviewForPath($libraryId: ID!, $path: String!) {
		organizePreviewForPath(libraryId: $libraryId, path: $path) {
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

// Same shape as OrganizeLooseFilesDialog's apply mutation — kept as a separate
// named operation (rather than importing the other dialog's document) since
// graphql-codegen's client preset requires unique operation names project-wide.
const applyMutation = graphql(`
	mutation ScopedOrganizeApply($libraryId: ID!, $decisions: [OrganizeDecisionInput!]!) {
		applyOrganizeLooseFiles(libraryId: $libraryId, decisions: $decisions)
	}
`)

type Props = {
	libraryId: string
	targetPath: string
	targetName: string
	open: boolean
	onOpenChange: (open: boolean) => void
}

export default function ScopedOrganizeDialog({
	libraryId,
	targetPath,
	targetName,
	open,
	onOpenChange,
}: Props) {
	const { t } = useLocaleContext()
	const { sdk } = useSDK()

	const [checked, setChecked] = useState<Set<string>>(new Set())

	const { data, isFetching, isError, refetch } = useGraphQL(
		previewForPathQuery,
		sdk.cacheKey('organizePreviewForPath', [libraryId, targetPath]),
		{ libraryId, path: targetPath },
		// This preview is a live, synchronous provider lookup (slow, and rate-limit /
		// IP-ban sensitive on some providers). Don't let a window-focus change silently
		// re-fire it — the user triggers it explicitly, and Retry covers refresh.
		{ enabled: open, refetchOnWindowFocus: false, staleTime: Infinity },
	)
	const preview = data?.organizePreviewForPath ?? null
	// Memoized so identity only changes when `preview` itself changes — otherwise
	// `?? []` would mint a fresh array every render and defeat memoization below.
	const proposed = useMemo(() => preview?.proposedMoves ?? [], [preview])
	const unmatched = useMemo(() => preview?.unmatched ?? [], [preview])

	const { mutateAsync: apply, isPending: isApplying } = useGraphQLMutation(applyMutation)

	// Default-check Confident moves whenever a fresh preview arrives.
	useEffect(() => {
		if (preview) {
			setChecked(
				new Set(proposed.filter((m) => m.bucket === OrganizeBucket.Confident).map((m) => m.src)),
			)
		}
	}, [preview, proposed])

	const toggle = useCallback((src: string) => {
		setChecked((prev) => {
			const next = new Set(prev)
			if (next.has(src)) next.delete(src)
			else next.add(src)
			return next
		})
	}, [])

	const handleApply = useCallback(async () => {
		const decisions = toDecisions(proposed, checked)
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
	}, [apply, libraryId, proposed, checked, onOpenChange, t])

	const checkedCount = checked.size

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<Dialog.Content size="xl" className="flex max-h-[85vh] flex-col">
				<Dialog.Header>
					<Dialog.Title>{t(getScopedKey('title'), { name: targetName })}</Dialog.Title>
					<Dialog.Description>{t(getScopedKey('description'))}</Dialog.Description>
					<Dialog.Close />
				</Dialog.Header>

				<div className="min-h-0 flex-1 overflow-y-auto">
					{isFetching && !preview && (
						<Text size="sm" variant="muted" className="py-10 text-center">
							{t(getScopedKey('working'))}
						</Text>
					)}
					{!isFetching && isError && (
						<div className="gap-3 py-10 flex flex-col items-center">
							<Text size="sm" variant="muted" className="text-center">
								{t(getScopedKey('error'))}
							</Text>
							<Button size="sm" variant="outline" onClick={() => refetch()}>
								{t(getScopedKey('retry'))}
							</Button>
						</div>
					)}
					{!isFetching &&
						!isError &&
						preview &&
						proposed.length === 0 &&
						unmatched.length === 0 && (
							<Text size="sm" variant="muted" className="py-10 text-center">
								{t(getScopedKey('empty'))}
							</Text>
						)}
					{!isFetching && !isError && preview && (proposed.length > 0 || unmatched.length > 0) && (
						<PreviewRows
							proposed={proposed}
							unmatched={unmatched}
							checked={checked}
							onToggle={toggle}
							t={t}
						/>
					)}
				</div>

				<Dialog.Footer>
					<Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
						{t(getKey('cancel'))}
					</Button>
					<Button
						size="sm"
						onClick={handleApply}
						isLoading={isApplying}
						disabled={checkedCount === 0 || isFetching}
					>
						{t(getKey('apply'), { count: checkedCount })}
					</Button>
				</Dialog.Footer>
			</Dialog.Content>
		</Dialog>
	)
}

// Reuses the library-wide organize dialog's locale keys for strings that are
// identical between the two dialogs (apply/cancel button labels, section
// headings inside `PreviewRows`).
const LOCALE_KEY = 'librarySettingsScene.options/organize.dialog'
const getKey = (key: string) => `${LOCALE_KEY}.${key}`

// Strings unique to the scoped (single file/folder) flow — no scan button, no
// job subscription, so the copy differs from the library-wide dialog's.
const SCOPED_LOCALE_KEY = 'librarySettingsScene.options/organize.scopedDialog'
const getScopedKey = (key: string) => `${SCOPED_LOCALE_KEY}.${key}`
