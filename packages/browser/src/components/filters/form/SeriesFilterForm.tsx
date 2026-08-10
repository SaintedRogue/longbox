import { zodResolver } from '@hookform/resolvers/zod'
import { Form } from '@longbox/components'
import { SeriesFilterInput } from '@longbox/graphql'
import { useMemo } from 'react'
import { useForm } from 'react-hook-form'
import z from 'zod'

import { useSeriesFilterContext } from '../context'
import AgeRatingFilter from './AgeRatingFilter'
import GenericFilterMultiselect from './GenericFilterMultiselect'
import NumericRangeFilter, { numericRangeToFilter } from './NumericRangeFilter'

const DEFAULT_STATUS_OPTIONS = [
	{
		label: 'Continuing',
		value: 'continuing',
	},
	{
		label: 'Ended',
		value: 'ended',
	},
]

/**
 * `metaType` used to be carried here -- in the schema, the defaults and the
 * GraphQL mapping -- with no control ever rendered for it, so it read like a
 * working filter that could never be set. It is removed rather than wired up:
 * there is no overview query to source its options from, unlike the media form
 * which has `mediaMetadataOverview`. The backend filter still exists and is
 * reachable through smart lists and the API.
 */
const schema = z.object({
	metadata: z
		.object({
			ageRating: z
				.number()
				.optional()
				.nullable()
				.refine((val) => val == null || (val >= 0 && val <= 18)),
			status: z.array(z.string()).optional(),
			yearFrom: z.number().optional().nullable(),
			yearTo: z.number().optional().nullable(),
		})
		.optional(),
})
export type SeriesFilterFormSchema = z.infer<typeof schema>

export default function SeriesFilterForm() {
	const { filters, setFilters } = useSeriesFilterContext()

	const defaultValues = useMemo(
		() =>
			({
				metadata: {
					ageRating: filters?.metadata?.ageRating?.gte ?? null,
					status: filters?.metadata?.status?.likeAnyOf ?? [],
					yearFrom: filters?.metadata?.year?.range?.from ?? filters?.metadata?.year?.gte ?? null,
					yearTo: filters?.metadata?.year?.range?.to ?? filters?.metadata?.year?.lte ?? null,
				},
			}) satisfies SeriesFilterFormSchema,
		[filters],
	)

	const form = useForm({
		defaultValues,
		resolver: zodResolver(schema),
	})

	/**
	 * A function that handles the form submission. This function merges the form
	 * values with the existing filters and sets the new filters.
	 * @param values The values from the form.
	 */
	const handleSubmit = (values: SeriesFilterFormSchema) => {
		const adjustedValues = intoGraphql(values)
		const merged = {
			...filters,
			...adjustedValues,
			metadata: { ...(filters?.metadata || {}), ...adjustedValues.metadata },
		}
		setFilters(merged)
	}

	return (
		<Form
			className="px-6 py-2 scrollbar-hide flex max-h-full grow flex-col overflow-x-visible overflow-y-auto"
			id="filter-form"
			form={form}
			onSubmit={handleSubmit}
		>
			<GenericFilterMultiselect
				label="Status"
				name="metadata.status"
				options={DEFAULT_STATUS_OPTIONS}
			/>

			<AgeRatingFilter variant="series" />

			<NumericRangeFilter
				fromName="metadata.yearFrom"
				toName="metadata.yearTo"
				label="Publication year"
				description="Leave either side blank for an open-ended range"
			/>
		</Form>
	)
}

const intoGraphql = (values: SeriesFilterFormSchema) =>
	({
		metadata: {
			ageRating: values.metadata?.ageRating
				? {
						gte: values.metadata.ageRating,
					}
				: undefined,
			status: values.metadata?.status
				? {
						likeAnyOf: values.metadata.status,
					}
				: undefined,
			year: numericRangeToFilter(values.metadata?.yearFrom, values.metadata?.yearTo),
		},
	}) as SeriesFilterInput
