import { cn, Text, ToolTip } from '@longbox/components'
import { MetadataField } from '@longbox/graphql'

import { FIELD_DEF_BY_FIELD } from '../../fieldDefs'
import type { EnrichmentSource } from '../useEnrichmentPool'

type Props = {
	field: MetadataField
	/** Every source that has answered for this entity, accepted one first. */
	sources: EnrichmentSource[]
	/** Adopt a source's value for this field. */
	onAdopt: (value: unknown) => void
	disabled?: boolean
}

/**
 * The other sources' answers for one field, each adoptable in a click.
 *
 * The grid proper compares the *current* value against the *candidate being reviewed*.
 * This is the rest of the pool: what every other provider has for this field. Rendering
 * it inline rather than as extra grid columns is deliberate — a column per provider is
 * readable at two and unreadable at four, and the interesting comparison is almost always
 * one field at a time.
 *
 * Sources with nothing for the field are omitted rather than shown empty: a row of
 * "—" chips is noise that makes the sources that *do* have something harder to spot.
 */
export function FieldSourceChips({ field, sources, onAdopt, disabled }: Props) {
	const def = FIELD_DEF_BY_FIELD[field]
	// A field with no candidate key is one external metadata never carries, so no source
	// can have an opinion about it.
	if (!def?.candidateKey) return null

	const offers = sources
		.map((source) => ({ source, value: source.payload?.[def.candidateKey!] }))
		.filter(({ value }) => hasValue(value))

	if (!offers.length) return null

	return (
		<div className="gap-1 mt-1 flex flex-wrap items-center">
			{offers.map(({ source, value }) => (
				<ToolTip key={source.provider} content={describe(source, value)}>
					<button
						type="button"
						disabled={disabled}
						onClick={() => onAdopt(value)}
						className={cn(
							'px-1.5 py-0.5 gap-1 rounded flex max-w-[220px] items-center border border-border bg-muted text-left',
							'hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50',
						)}
					>
						<Text size="xs" variant="muted" className="font-medium shrink-0">
							{PROVIDER_SHORT_LABELS[source.provider] ?? source.provider}
						</Text>
						<Text size="xs" className="truncate">
							{preview(value)}
						</Text>
					</button>
				</ToolTip>
			))}
		</div>
	)
}

const PROVIDER_SHORT_LABELS: Record<string, string> = {
	comicvine: 'Comic Vine',
	locg: 'LOCG',
	manual: 'Yours',
	metron: 'Metron',
}

function hasValue(value: unknown): boolean {
	if (value == null) return false
	if (Array.isArray(value)) return value.length > 0
	if (typeof value === 'string') return value.trim().length > 0
	return true
}

/** A short, single-line rendering for the chip face. */
function preview(value: unknown): string {
	if (Array.isArray(value)) {
		return value.length > 2
			? `${value.slice(0, 2).join(', ')} +${value.length - 2}`
			: value.join(', ')
	}
	if (typeof value === 'string') return value
	return String(value)
}

/** The full value in the tooltip, since the chip face is truncated. */
function describe(source: EnrichmentSource, value: unknown): string {
	const label = PROVIDER_SHORT_LABELS[source.provider] ?? source.provider
	const full = Array.isArray(value) ? value.join(', ') : String(value)
	return `Use ${label}'s value: ${full}`
}
