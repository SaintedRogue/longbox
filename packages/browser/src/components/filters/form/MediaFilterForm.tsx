import { zodResolver } from '@hookform/resolvers/zod'
import { useGraphQL } from '@longbox/client'
import { CheckBox, Form } from '@longbox/components'
import {
	graphql,
	MediaFilterFormQuery,
	MediaFilterInput,
	MediaMetadataFilterInput,
	ReadingStatus,
} from '@longbox/graphql'
import { useEffect, useMemo, useState } from 'react'
import { FieldValues, useForm } from 'react-hook-form'
import z from 'zod'

import { useSeriesContextSafe } from '@/scenes/series'

import { useFilterContext } from '..'
import AgeRatingFilter from './AgeRatingFilter'
import ExtensionSelect from './ExtensionSelect'
import GenericFilterMultiselect from './GenericFilterMultiselect'
import NumericRangeFilter, { numericRangeToFilter } from './NumericRangeFilter'
import ReadStatusSelect from './ReadStatusSelect'

const query = graphql(`
	query MediaFilterForm($seriesId: ID) {
		mediaMetadataOverview(seriesId: $seriesId) {
			genres
			writers
			pencillers
			colorists
			letterers
			inkers
			publishers
			editors
			characters
			teams
			coverArtists
			series
		}
	}
`)

const schema = z.object({
	extension: z.string().optional(),
	metadata: z
		.object({
			age_rating: z
				.number()
				.optional()
				.nullable()
				.refine((val) => val == null || (val >= 0 && val <= 18)),
			character: z.array(z.string()).optional(),
			colorist: z.array(z.string()).optional(),
			coverArtist: z.array(z.string()).optional(),
			editor: z.array(z.string()).optional(),
			genre: z.array(z.string()).optional(),
			inker: z.array(z.string()).optional(),
			letterer: z.array(z.string()).optional(),
			penciller: z.array(z.string()).optional(),
			publisher: z.array(z.string()).optional(),
			series: z.array(z.string()).optional(),
			team: z.array(z.string()).optional(),
			writer: z.array(z.string()).optional(),
			yearFrom: z.number().optional().nullable(),
			yearTo: z.number().optional().nullable(),
		})
		.optional(),
	read_status: z.array(z.enum(['finished', 'reading', 'not_started'])).optional(),
})
export type MediaFilterFormSchema = z.infer<typeof schema>

export default function MediaFilterForm() {
	const { filters: filtersInput, setFilters } = useFilterContext()
	const filters = useMemo(() => (filtersInput || {}) as MediaFilterInput, [filtersInput])

	const seriesContext = useSeriesContextSafe()
	const [onlyFromSeries, setOnlyFromSeries] = useState(false)

	const params = useMemo(() => {
		if (onlyFromSeries && !!seriesContext?.series.id) {
			return {
				seriesId: seriesContext.series.id,
			}
		}
		return {}
	}, [onlyFromSeries, seriesContext])

	const { data: _data, isPending } = useGraphQL(query, ['mediaFilterForm', params], params, {
		placeholderData: (prev) => prev,
	})
	const data = _data?.mediaMetadataOverview

	const defaultValue = useMemo(() => {
		const flattenMetadata = {
			age_rating: (filters?.metadata as MediaMetadataFilterInput)?.ageRating?.eq ?? null,
			character: (filters?.metadata as MediaMetadataFilterInput)?.characters?.likeAnyOf ?? [],
			colorist: (filters?.metadata as MediaMetadataFilterInput)?.colorists?.likeAnyOf ?? [],
			coverArtist: (filters?.metadata as MediaMetadataFilterInput)?.coverArtists?.likeAnyOf ?? [],
			editor: (filters?.metadata as MediaMetadataFilterInput)?.editors?.likeAnyOf ?? [],
			genre: (filters?.metadata as MediaMetadataFilterInput)?.genres?.likeAnyOf ?? [],
			inker: (filters?.metadata as MediaMetadataFilterInput)?.inkers?.likeAnyOf ?? [],
			letterer: (filters?.metadata as MediaMetadataFilterInput)?.letterers?.likeAnyOf ?? [],
			penciller: (filters?.metadata as MediaMetadataFilterInput)?.pencillers?.likeAnyOf ?? [],
			publisher: (filters?.metadata as MediaMetadataFilterInput)?.publisher?.likeAnyOf ?? [],
			series: (filters?.metadata as MediaMetadataFilterInput)?.series?.likeAnyOf ?? [],
			team: (filters?.metadata as MediaMetadataFilterInput)?.teams?.likeAnyOf ?? [],
			writer: (filters?.metadata as MediaMetadataFilterInput)?.writers?.likeAnyOf ?? [],
			yearFrom:
				(filters?.metadata as MediaMetadataFilterInput)?.year?.range?.from ??
				(filters?.metadata as MediaMetadataFilterInput)?.year?.gte ??
				null,
			yearTo:
				(filters?.metadata as MediaMetadataFilterInput)?.year?.range?.to ??
				(filters?.metadata as MediaMetadataFilterInput)?.year?.lte ??
				null,
		}
		return {
			extension: filters?.extension?.eq as string,
			metadata: flattenMetadata,
			read_status: filters?.readingStatus?.isAnyOf?.map((elem) => (elem as string).toLowerCase()),
		}
	}, [filters])

	const form = useForm({
		defaultValues: defaultValue,
		resolver: zodResolver(schema),
	})
	const { reset } = form

	useEffect(() => {
		reset(defaultValue)
	}, [defaultValue, reset])

	/**
	 * A function that handles the form submission. This function merges the form
	 * values with the existing filters and sets the new filters.
	 * @param values The values from the form.
	 */
	const handleSubmit = (values: FieldValues) => {
		const newFilters: MediaFilterInput = {}
		if (values.extension) {
			newFilters.extension = { eq: values.extension }
		}

		if (values.read_status) {
			newFilters.readingStatus = {
				isAnyOf: values.read_status.map(
					(elem: string) => (elem as string).toUpperCase() as ReadingStatus,
				),
			}
		}

		if (values.metadata) {
			if (values.metadata.age_rating !== null) {
				newFilters.metadata = {
					ageRating: values.metadata.age_rating ? { lte: values.metadata.age_rating } : null,
				}
			}

			if (values.metadata.character?.length) {
				newFilters.metadata = {
					...newFilters.metadata,
					characters: { likeAnyOf: values.metadata.character },
				}
			}

			if (values.metadata.colorist?.length) {
				newFilters.metadata = {
					...newFilters.metadata,
					colorists: { likeAnyOf: values.metadata.colorist },
				}
			}

			if (values.metadata.editor?.length) {
				newFilters.metadata = {
					...newFilters.metadata,
					editors: { likeAnyOf: values.metadata.editor },
				}
			}

			if (values.metadata.genre?.length) {
				newFilters.metadata = {
					...newFilters.metadata,
					genres: { likeAnyOf: values.metadata.genre },
				}
			}

			if (values.metadata.inker?.length) {
				newFilters.metadata = {
					...newFilters.metadata,
					inkers: { likeAnyOf: values.metadata.inker },
				}
			}

			if (values.metadata.letterer?.length) {
				newFilters.metadata = {
					...newFilters.metadata,
					letterers: { likeAnyOf: values.metadata.letterer },
				}
			}

			if (values.metadata.penciller?.length) {
				newFilters.metadata = {
					...newFilters.metadata,
					pencillers: { likeAnyOf: values.metadata.penciller },
				}
			}

			if (values.metadata.publisher?.length) {
				newFilters.metadata = {
					...newFilters.metadata,
					publisher: { likeAnyOf: values.metadata.publisher },
				}
			}

			if (values.metadata.coverArtist?.length) {
				newFilters.metadata = {
					...newFilters.metadata,
					coverArtists: { likeAnyOf: values.metadata.coverArtist },
				}
			}

			if (values.metadata.team?.length) {
				newFilters.metadata = {
					...newFilters.metadata,
					teams: { likeAnyOf: values.metadata.team },
				}
			}

			if (values.metadata.series?.length) {
				newFilters.metadata = {
					...newFilters.metadata,
					series: { likeAnyOf: values.metadata.series },
				}
			}

			const year = numericRangeToFilter(values.metadata.yearFrom, values.metadata.yearTo)
			if (year) {
				newFilters.metadata = {
					...newFilters.metadata,
					year,
				}
			}

			if (values.metadata.writer?.length) {
				newFilters.metadata = {
					...newFilters.metadata,
					writers: { likeAnyOf: values.metadata.writer },
				}
			}
		}

		setFilters(newFilters)
	}

	const isEmptyState = useMemo(() => !isPending && isEmptyResult(data), [isPending, data])

	return (
		<Form
			className="px-6 py-2 scrollbar-hide flex max-h-full grow flex-col overflow-x-visible overflow-y-auto"
			id="filter-form"
			form={form}
			onSubmit={handleSubmit}
		>
			{!!seriesContext && (
				<CheckBox
					label="Only show options available from series"
					checked={onlyFromSeries}
					onClick={() => setOnlyFromSeries((prev) => !prev)}
				/>
			)}

			<ExtensionSelect />
			<ReadStatusSelect />
			<AgeRatingFilter />

			{/*
			 * Rendered outside the `isEmptyState` guard below: that guard hides the
			 * multiselects when there is no metadata to build options from, but a
			 * year range needs no options -- the user types the bounds.
			 */}
			<NumericRangeFilter
				fromName="metadata.yearFrom"
				toName="metadata.yearTo"
				label="Publication year"
				description="Leave either side blank for an open-ended range"
				placeholderFrom="1987"
				placeholderTo="2026"
			/>

			{!isEmptyState && (
				<>
					<GenericFilterMultiselect
						name="metadata.genre"
						label="Genre"
						options={
							data?.genres.map((genre) => ({ label: genre, value: genre.toLowerCase() })) || []
						}
					/>

					<GenericFilterMultiselect
						name="metadata.writer"
						label="Writer"
						options={
							data?.writers.map((writer) => ({ label: writer, value: writer.toLowerCase() })) || []
						}
					/>

					<GenericFilterMultiselect
						name="metadata.penciller"
						label="Penciller"
						options={
							data?.pencillers.map((penciller) => ({
								label: penciller,
								value: penciller.toLowerCase(),
							})) || []
						}
					/>

					<GenericFilterMultiselect
						name="metadata.colorist"
						label="Colorist"
						options={
							data?.colorists.map((colorist) => ({
								label: colorist,
								value: colorist.toLowerCase(),
							})) || []
						}
					/>

					<GenericFilterMultiselect
						name="metadata.letterer"
						label="Letterer"
						options={
							data?.letterers.map((letterer) => ({
								label: letterer,
								value: letterer.toLowerCase(),
							})) || []
						}
					/>

					<GenericFilterMultiselect
						name="metadata.inker"
						label="Inker"
						options={
							data?.inkers.map((inker) => ({ label: inker, value: inker.toLowerCase() })) || []
						}
					/>

					<GenericFilterMultiselect
						name="metadata.publisher"
						label="Publisher"
						options={
							data?.publishers.map((publisher) => ({
								label: publisher,
								value: publisher.toLowerCase(),
							})) || []
						}
					/>

					<GenericFilterMultiselect
						name="metadata.editor"
						label="Editor"
						options={
							data?.editors.map((editor) => ({ label: editor, value: editor.toLowerCase() })) || []
						}
					/>

					<GenericFilterMultiselect
						name="metadata.character"
						label="Character"
						options={
							data?.characters.map((character) => ({
								label: character,
								value: character.toLowerCase(),
							})) || []
						}
					/>

					<GenericFilterMultiselect
						name="metadata.team"
						label="Team"
						options={data?.teams.map((team) => ({ label: team, value: team.toLowerCase() })) || []}
					/>

					<GenericFilterMultiselect
						name="metadata.coverArtist"
						label="Cover artist"
						options={
							data?.coverArtists.map((artist) => ({
								label: artist,
								value: artist.toLowerCase(),
							})) || []
						}
					/>

					{/*
					 * The ComicInfo `<Series>` string, which is not the same thing as the
					 * series a book was filed under on disk -- it is what the metadata
					 * claims, and the two disagree often enough to be worth filtering on.
					 */}
					<GenericFilterMultiselect
						name="metadata.series"
						label="Series (from metadata)"
						options={
							data?.series.map((series) => ({ label: series, value: series.toLowerCase() })) || []
						}
					/>
				</>
			)}
		</Form>
	)
}

const isEmptyResult = (result?: MediaFilterFormQuery['mediaMetadataOverview']) =>
	!(
		result?.genres?.length ||
		result?.writers?.length ||
		result?.pencillers?.length ||
		result?.colorists?.length ||
		result?.letterers?.length ||
		result?.inkers?.length ||
		result?.publishers?.length ||
		result?.editors?.length ||
		result?.characters?.length ||
		result?.teams?.length ||
		result?.coverArtists?.length ||
		result?.series?.length
	) || result == null
