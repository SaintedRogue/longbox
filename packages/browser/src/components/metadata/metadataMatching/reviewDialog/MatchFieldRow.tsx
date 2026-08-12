import { CheckBox, cn, IconButton, Text, ToolTip } from '@longbox/components'
import { useLocaleContext } from '@longbox/i18n'
import { Undo2 } from 'lucide-react'
import { useState } from 'react'

import { type FieldComparison, resolveFieldValue } from '../types'
import type { EnrichmentSource, FieldProvenance } from '../useEnrichmentPool'
import { useMatchReviewStore } from '../useMatchReviewStore'
import { FieldActionMenu } from './FieldActionMenu'
import { FieldSourceChips } from './FieldSourceChips'
import { FieldValue } from './FieldValue'
import { ResolvedFieldEditor } from './ResolvedFieldEditor'
import { getDidValuesEffectivelyChange } from './utils'

type Props = {
	comparison: FieldComparison
	/** Providers other than the one under review, for adopting a value per field. */
	otherSources?: EnrichmentSource[]
	/** Where the currently-stored value came from, when we know. */
	provenance?: FieldProvenance
}

export function MatchFieldRow({ comparison, otherSources = [], provenance }: Props) {
	const { t } = useLocaleContext()
	const {
		strategy,
		excludedFields,
		toggleField,
		fieldOverrides,
		clearFieldOverride,
		setFieldOverride,
		getLockedFields,
	} = useMatchReviewStore()
	const { binding, currentValue, candidateValue, field } = comparison

	const excluded = excludedFields.has(field)
	const locked = getLockedFields().has(field)
	const disabled = excluded || locked
	const override = fieldOverrides.get(field)
	const resolved = resolveFieldValue(currentValue, candidateValue, strategy, excluded, override)
	const willChange = getDidValuesEffectivelyChange(currentValue, resolved)
	const hasOverride = fieldOverrides.has(field)

	const [isEditing, setIsEditing] = useState(false)

	const handleUndo = () => {
		clearFieldOverride(field)
		setIsEditing(false)
	}

	const handleEditManually = () => {
		setIsEditing(true)
	}

	return (
		<div
			className={cn(
				'group/edit py-2 pl-2.5 grid grid-cols-[140px_1fr_1fr_40px_1fr_32px] items-center bg-background',
				{
					'opacity-40': disabled,
				},
			)}
		>
			<div className="gap-1 flex flex-col items-start self-start">
				<Text size="sm" className="font-medium">
					{t(`metadataEditor.labels.${binding}`)}
				</Text>
				{provenance && (
					<ToolTip
						content={
							provenance.chosenBy === 'user'
								? 'You chose this value'
								: `Applied automatically from ${provenance.sourceProvider}`
						}
					>
						<Text size="xs" variant="muted" className="font-mono">
							{provenance.sourceProvider}
						</Text>
					</ToolTip>
				)}
			</div>

			<div className="min-w-0 pr-3 self-start">
				<FieldValue value={currentValue} />
				{/* The rest of the pool. Adopting one records it as your choice, which is
				    also what locks it against the next fetch. */}
				<FieldSourceChips
					field={field}
					sources={otherSources}
					disabled={disabled}
					onAdopt={(value) => setFieldOverride(field, { type: 'custom', value })}
				/>
			</div>

			<div className="min-w-0 pr-3 self-start">
				<FieldValue value={candidateValue} />
			</div>

			<div className="flex justify-center">
				<ToolTip
					content={
						locked
							? t('metadataMatching.fieldLocked')
							: excluded
								? t('metadataMatching.includeField')
								: t('metadataMatching.excludeField')
					}
				>
					<CheckBox
						className={cn({
							'data-[state=unchecked]:border-primary data-[state=unchecked]:bg-primary/10':
								willChange && !disabled,
						})}
						checked={!excluded}
						onClick={() => !locked && toggleField(comparison.field)}
						disabled={locked}
					/>
				</ToolTip>
			</div>

			<div className="min-w-0 pr-2.5">
				{isEditing && !disabled ? (
					<ResolvedFieldEditor field={field} resolvedValue={resolved} />
				) : (
					<FieldValue
						value={resolved}
						highlight={(willChange || hasOverride) && !disabled}
						compareWith={currentValue}
					/>
				)}
			</div>

			<div className="flex items-center justify-center">
				{isEditing && hasOverride && !locked ? (
					<ToolTip content={t('metadataMatching.reviewDialog.fieldAction.undoManualEdit')}>
						<IconButton variant="ghost" size="xs" onClick={handleUndo}>
							<Undo2 className="h-3.5 w-3.5" />
						</IconButton>
					</ToolTip>
				) : (
					<FieldActionMenu field={field} disabled={disabled} onEditManually={handleEditManually} />
				)}
			</div>
		</div>
	)
}
