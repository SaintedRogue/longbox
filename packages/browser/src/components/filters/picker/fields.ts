import { MediaFilterInput, ReadingStatus, SeriesFilterInput } from '@longbox/graphql'

import { FilterInput } from '../context'
import { FilterableEntity } from '../form'
import { numericRangeToFilter } from '../form/NumericRangeFilter'

/**
 * A value the user can pick for a field. `value` is what goes into the filter,
 * `label` is what is rendered -- they differ for fields with a fixed vocabulary
 * (read status, extension), where the stored value is an enum or a file suffix.
 */
export type FilterFieldOption = {
	label: string
	value: string
}

export type NumericBounds = {
	from?: number | null
	to?: number | null
}

/**
 * The keys of `mediaMetadataOverview` a field can draw its options from. Kept as a
 * union rather than `string` so a typo in a field descriptor is a type error instead
 * of a field that silently renders no options.
 */
export type MediaOverviewKey =
	| 'genres'
	| 'writers'
	| 'pencillers'
	| 'colorists'
	| 'letterers'
	| 'inkers'
	| 'publishers'
	| 'editors'
	| 'characters'
	| 'teams'
	| 'coverArtists'
	| 'series'

/** The same, for `seriesMetadataOverview`. */
export type SeriesOverviewKey = 'publishers' | 'imprints' | 'bookTypes' | 'statuses'

export type OverviewKey = MediaOverviewKey | SeriesOverviewKey

type BaseField = {
	/** Stable identifier, used to address the field's screen and as a React key. */
	key: string
	label: string
}

/**
 * A field whose values are picked from a list, with any-of semantics: a book matches
 * if it carries *any* of the selected values.
 */
export type ValuesField = BaseField & {
	kind: 'values'
	/** A fixed vocabulary, for fields the server does not enumerate. */
	options?: FilterFieldOption[]
	/** Where to read the vocabulary from on the metadata overview, for the rest. */
	overviewKey?: OverviewKey
	read: (filters: FilterInput) => string[]
	write: (filters: FilterInput, values: string[]) => FilterInput
}

/** A field bounded by numbers rather than chosen from a list. */
export type RangeField = BaseField & {
	kind: 'range'
	placeholderFrom?: string
	placeholderTo?: string
	read: (filters: FilterInput) => NumericBounds
	write: (filters: FilterInput, bounds: NumericBounds) => FilterInput
}

export type FilterField = ValuesField | RangeField

/**
 * Drops keys with no value, collapsing an object with nothing left to `undefined`.
 *
 * Filters are serialised into the URL and counted by key, so a leftover `{"metadata":{}}`
 * is not inert: it would keep the "filters are active" badge lit, and the Clear button
 * enabled, after the last value had been cleared.
 */
const pruneEmpty = <T extends object>(obj: T): T | undefined => {
	const entries = Object.entries(obj).filter(([, value]) => value !== undefined && value !== null)
	return entries.length ? (Object.fromEntries(entries) as T) : undefined
}

/** Merges a patch into `filters.metadata`, pruning both levels once the patch empties them. */
const writeMetadata = (filters: FilterInput, patch: Record<string, unknown>): FilterInput => {
	const current = (filters as { metadata?: object }).metadata || {}
	const metadata = pruneEmpty({ ...current, ...patch })
	return (pruneEmpty({ ...filters, metadata }) || {}) as FilterInput
}

/** Merges a patch at the top level of the filter input, with the same pruning. */
const writeRoot = (filters: FilterInput, patch: Record<string, unknown>): FilterInput =>
	(pruneEmpty({ ...filters, ...patch }) || {}) as FilterInput

const readMetadata = (filters: FilterInput): Record<string, unknown> =>
	((filters as { metadata?: object }).metadata || {}) as Record<string, unknown>

/**
 * A metadata field matched with `likeAnyOf`.
 *
 * `likeAnyOf` rather than `anyOf` because these columns hold *comma-separated lists* --
 * a book's genres are one string -- so an equality match would only ever hit books with
 * exactly one genre.
 */
const metadataValuesField = (
	key: string,
	label: string,
	filterKey: string,
	overviewKey: OverviewKey,
): ValuesField => ({
	kind: 'values',
	key,
	label,
	overviewKey,
	read: (filters) => {
		const field = readMetadata(filters)[filterKey] as { likeAnyOf?: string[] } | undefined
		return field?.likeAnyOf || []
	},
	write: (filters, values) =>
		writeMetadata(filters, { [filterKey]: values.length ? { likeAnyOf: values } : undefined }),
})

/**
 * Reads a numeric filter back into the two bounds the range screen edits.
 *
 * The three shapes `numericRangeToFilter` can produce all have to round-trip, otherwise
 * reopening the picker on a filtered view would show empty inputs over a live filter.
 */
const readBounds = (
	field?: { gte?: number; lte?: number; range?: { from?: number; to?: number } } | null,
): NumericBounds => {
	if (!field) return {}
	if (field.range) return { from: field.range.from, to: field.range.to }
	return { from: field.gte, to: field.lte }
}

const metadataRangeField = (
	key: string,
	label: string,
	filterKey: string,
	placeholders?: { from?: string; to?: string },
): RangeField => ({
	kind: 'range',
	key,
	label,
	placeholderFrom: placeholders?.from,
	placeholderTo: placeholders?.to,
	read: (filters) =>
		readBounds(readMetadata(filters)[filterKey] as Parameters<typeof readBounds>[0]),
	write: (filters, bounds) =>
		writeMetadata(filters, { [filterKey]: numericRangeToFilter(bounds.from, bounds.to) }),
})

const READ_STATUS_OPTIONS: FilterFieldOption[] = [
	{ label: 'Unread', value: ReadingStatus.NotStarted },
	{ label: 'Reading', value: ReadingStatus.Reading },
	{ label: 'Completed', value: ReadingStatus.Finished },
	{ label: 'Abandoned', value: ReadingStatus.Abandoned },
]

const EXTENSION_OPTIONS: FilterFieldOption[] = [
	{ label: 'CBZ', value: 'cbz' },
	{ label: 'CBR', value: 'cbr' },
	{ label: 'ZIP', value: 'zip' },
	{ label: 'RAR', value: 'rar' },
	{ label: 'EPUB', value: 'epub' },
	{ label: 'PDF', value: 'pdf' },
]

const MEDIA_FIELDS: FilterField[] = [
	metadataValuesField('genre', 'Genre', 'genres', 'genres'),
	metadataValuesField('writer', 'Writer', 'writers', 'writers'),
	metadataValuesField('penciller', 'Penciller', 'pencillers', 'pencillers'),
	metadataValuesField('inker', 'Inker', 'inkers', 'inkers'),
	metadataValuesField('colorist', 'Colorist', 'colorists', 'colorists'),
	metadataValuesField('letterer', 'Letterer', 'letterers', 'letterers'),
	metadataValuesField('coverArtist', 'Cover artist', 'coverArtists', 'coverArtists'),
	metadataValuesField('editor', 'Editor', 'editors', 'editors'),
	// The filter input calls this one `publisher` while the overview calls it `publishers`.
	metadataValuesField('publisher', 'Publisher', 'publisher', 'publishers'),
	metadataValuesField('character', 'Character', 'characters', 'characters'),
	metadataValuesField('team', 'Team', 'teams', 'teams'),
	/*
	 * The ComicInfo `<Series>` string, which is not the same thing as the series a book
	 * was filed under on disk -- it is what the metadata claims, and the two disagree
	 * often enough to be worth filtering on separately.
	 */
	metadataValuesField('metadataSeries', 'Series (from metadata)', 'series', 'series'),
	{
		kind: 'values',
		key: 'readStatus',
		label: 'Read status',
		options: READ_STATUS_OPTIONS,
		read: (filters) => (filters as MediaFilterInput).readingStatus?.isAnyOf || [],
		write: (filters, values) =>
			writeRoot(filters, {
				readingStatus: values.length ? { isAnyOf: values as ReadingStatus[] } : undefined,
			}),
	},
	{
		kind: 'values',
		key: 'extension',
		label: 'File type',
		options: EXTENSION_OPTIONS,
		/*
		 * `eq` is read as well as `anyOf` so URLs written by the old filter drawer -- which
		 * could only express a single extension -- still show their selection here.
		 */
		read: (filters) => {
			const extension = (filters as MediaFilterInput).extension
			if (!extension) return []
			if ('anyOf' in extension && extension.anyOf) return extension.anyOf
			if ('eq' in extension && extension.eq) return [extension.eq]
			return []
		},
		write: (filters, values) =>
			writeRoot(filters, { extension: values.length ? { anyOf: values } : undefined }),
	},
	metadataRangeField('year', 'Publication year', 'year', { from: '1987', to: '2026' }),
	metadataRangeField('ageRating', 'Age rating', 'ageRating', { from: '0', to: '18' }),
]

/*
 * Series had three fields -- status, year, age rating -- while books had fourteen, which
 * made the control look broken rather than thin. These are the columns `series_metadata`
 * actually carries that are worth narrowing a shelf by; their vocabularies come from
 * `seriesMetadataOverview` for the same reason the media ones do, so only values that
 * exist are offered.
 */
const SERIES_FIELDS: FilterField[] = [
	metadataValuesField('publisher', 'Publisher', 'publisher', 'publishers'),
	metadataValuesField('imprint', 'Imprint', 'imprint', 'imprints'),
	metadataValuesField('bookType', 'Book type', 'booktype', 'bookTypes'),
	/*
	 * Sourced from the server rather than a hard-coded Continuing/Ended pair: the column is
	 * free text, and a fixed list silently offers values no series in the library has.
	 */
	metadataValuesField('status', 'Status', 'status', 'statuses'),
	{
		kind: 'values',
		key: 'readStatus',
		label: 'Read status',
		options: READ_STATUS_OPTIONS,
		read: (filters) => (filters as SeriesFilterInput).readingStatus?.isAnyOf || [],
		write: (filters, values) =>
			writeRoot(filters, {
				readingStatus: values.length ? { isAnyOf: values as ReadingStatus[] } : undefined,
			}),
	},
	metadataRangeField('year', 'Publication year', 'year', { from: '1987', to: '2026' }),
	metadataRangeField('volume', 'Volume', 'volume', { from: '1', to: '5' }),
	metadataRangeField('ageRating', 'Age rating', 'ageRating', { from: '0', to: '18' }),
]

export const fieldsForEntity = (entity: FilterableEntity): FilterField[] => {
	switch (entity) {
		case 'media':
			return MEDIA_FIELDS
		case 'series':
			return SERIES_FIELDS
		default:
			return []
	}
}

/**
 * How many values a field currently has selected. A range counts as one filter when
 * either bound is set, since a half-open range is still a filter.
 */
export const selectionCount = (field: FilterField, filters: FilterInput): number => {
	if (field.kind === 'values') return field.read(filters).length
	const { from, to } = field.read(filters)
	return typeof from === 'number' || typeof to === 'number' ? 1 : 0
}
