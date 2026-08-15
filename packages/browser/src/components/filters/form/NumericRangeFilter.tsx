import { Input, Label } from '@longbox/components'
import { useFormContext } from 'react-hook-form'

type Props = {
	/** Form field path holding the lower bound, e.g. `metadata.yearFrom`. */
	fromName: string
	/** Form field path holding the upper bound. */
	toName: string
	label: string
	description?: string
	placeholderFrom?: string
	placeholderTo?: string
}

/**
 * A two-input bounded range, for filters where a single bound is not enough.
 *
 * Either side may be left blank -- see [`numericRangeToFilter`] for how the
 * three cases map onto the GraphQL numeric filter. `AgeRatingFilter` stays
 * separate rather than being folded in here: it is a single "X and up" bound
 * with a radio for "any", which is a different question from a range.
 */
export default function NumericRangeFilter({
	fromName,
	toName,
	label,
	description,
	placeholderFrom,
	placeholderTo,
}: Props) {
	const form = useFormContext()

	return (
		<div className="py-2 gap-y-1.5 flex flex-col">
			<Label>{label}</Label>
			{description && <p className="text-xs text-muted-foreground">{description}</p>}

			<div className="gap-x-2 flex items-center">
				<Input
					type="number"
					placeholder={placeholderFrom ?? 'From'}
					aria-label={`${label} from`}
					{...form.register(fromName, { valueAsNumber: true })}
				/>
				<span className="text-sm text-muted-foreground">to</span>
				<Input
					type="number"
					placeholder={placeholderTo ?? 'To'}
					aria-label={`${label} to`}
					{...form.register(toName, { valueAsNumber: true })}
				/>
			</div>
		</div>
	)
}

/**
 * Maps a pair of optional bounds onto a GraphQL numeric filter.
 *
 * Both bounds present becomes an inclusive `range`; one bound becomes the
 * matching open-ended comparison, because `NumericRange` requires *both* `from`
 * and `to` and so cannot express "1990 onwards". Neither returns `undefined` so
 * the caller can omit the field entirely.
 *
 * An empty number input yields `NaN` rather than undefined, which would
 * serialise into the query and match nothing -- hence the `isFinite` guards.
 */
/**
 * A union rather than one object with three optional keys: the GraphQL numeric
 * filters are `@oneOf`, so their generated types are discriminated unions where
 * the unselected keys must be absent. A loose shape cannot narrow to a member.
 */
export type NumericRangeFilterValue =
	| { gte: number }
	| { lte: number }
	| { range: { from: number; to: number; inclusive: boolean } }

export function numericRangeToFilter(
	from?: number | null,
	to?: number | null,
): NumericRangeFilterValue | undefined {
	const hasFrom = typeof from === 'number' && Number.isFinite(from)
	const hasTo = typeof to === 'number' && Number.isFinite(to)

	if (hasFrom && hasTo) {
		// Guard against inverted input rather than sending a range that can never match.
		const [low, high] = from <= to ? [from, to] : [to, from]
		return { range: { from: low, inclusive: true, to: high } }
	}

	if (hasFrom) return { gte: from }
	if (hasTo) return { lte: to }

	return undefined
}
