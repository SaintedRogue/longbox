import { useGraphQL } from '@longbox/client'
import { Button, Command, IconButton, Input, Popover, ToolTip } from '@longbox/components'
import { graphql } from '@longbox/graphql'
import { useLocaleContext } from '@longbox/i18n'
import { Check, ChevronLeft, ChevronRight, ListFilter } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { useMediaMatch } from 'rooks'

import { useLibraryContextSafe } from '@/scenes/library/context'
import { useSeriesContextSafe } from '@/scenes/series'

import { FilterInput, useFilterContext } from '../context'
import { FilterableEntity } from '../form'
import { clearFilters, getActiveFilterCount } from '../utils'
import {
	fieldsForEntity,
	FilterField,
	FilterFieldOption,
	NumericBounds,
	OverviewKey,
	RangeField,
	selectionCount,
	ValuesField,
} from './fields'

/**
 * The vocabulary for every value-backed media field, in one round trip.
 *
 * Scoped by the view it is opened from -- see the `libraryId` argument -- so a library's
 * options describe that library rather than the whole server.
 */
const optionsQuery = graphql(`
	query FilterPickerOptions($seriesId: ID, $libraryId: ID) {
		mediaMetadataOverview(seriesId: $seriesId, libraryId: $libraryId) {
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

type Props = {
	entity: FilterableEntity
}

/**
 * A field-first filter control: the popover opens on the list of filterable fields,
 * and picking one drills into that field's values with a search box over them.
 *
 * This replaces a form that rendered every field's multiselect stacked in a drawer. With
 * a real library the option lists run to thousands of names, so the useful interaction is
 * "I know the field, let me search it" rather than "scroll past eleven fields I do not
 * want". Selections apply immediately -- there is no Apply button to forget to press.
 */
export default function FilterPicker({ entity }: Props) {
	const { t } = useLocaleContext()
	const { filters, setFilters, setPage } = useFilterContext()
	const isMobile = useMediaMatch('(max-width: 768px)')

	const [isOpen, setIsOpen] = useState(false)
	const [activeFieldKey, setActiveFieldKey] = useState<string | null>(null)

	const libraryContext = useLibraryContextSafe()
	const seriesContext = useSeriesContextSafe()

	const fields = useMemo(() => fieldsForEntity(entity), [entity])
	const activeField = useMemo(
		() => fields.find((field) => field.key === activeFieldKey) || null,
		[fields, activeFieldKey],
	)

	const params = useMemo(() => {
		const libraryId = libraryContext?.library.id
		const seriesId = seriesContext?.series.id
		return {
			...(libraryId ? { libraryId } : {}),
			...(seriesId ? { seriesId } : {}),
		}
	}, [libraryContext, seriesContext])

	/*
	 * Only media fields draw their options from the server; the series fields all have a
	 * fixed vocabulary. The query is also held until the popover is opened, so a browse
	 * page does not pay for option lists nobody has asked to see yet.
	 */
	const { data: overview } = useGraphQL(optionsQuery, ['filterPickerOptions', params], params, {
		enabled: isOpen && entity === 'media',
		placeholderData: (prev) => prev,
	})
	const overviewValues = overview?.mediaMetadataOverview

	/*
	 * The shared counter rather than a walk over this picker's own fields: a URL can carry
	 * filters the picker does not model -- a smart list's `_or`, a virtual shelf -- and a
	 * badge that ignored them would claim the view was unfiltered when it is not.
	 */
	const totalActive = useMemo(() => getActiveFilterCount(filters), [filters])

	/**
	 * Applying a filter from page 5 of a list would otherwise leave the view on page 5 of a
	 * result set that may now be one page long, which reads as "my filter returned nothing".
	 */
	const applyFilters = useCallback(
		(next: FilterInput) => {
			setFilters(next)
			setPage(1)
		},
		[setFilters, setPage],
	)

	const handleClear = useCallback(
		() => applyFilters(clearFilters(filters) as FilterInput),
		[filters, applyFilters],
	)

	const handleOpenChange = useCallback((open: boolean) => {
		setIsOpen(open)
		if (!open) {
			setActiveFieldKey(null)
		}
	}, [])

	return (
		<Popover open={isOpen} onOpenChange={handleOpenChange}>
			<ToolTip content={t('filters.buttons.filters')} size="sm" isDisabled={isOpen}>
				<Popover.Trigger asChild>
					<IconButton
						variant="ghost"
						size="sm"
						className="relative hover:bg-accent"
						aria-label={t('filters.buttons.filters')}
					>
						<ListFilter className="h-4 w-4" />
						{totalActive > 0 && (
							<span className="-mr-1.5 -mt-1.5 h-4 w-4 right-0 top-0 absolute inline-flex items-center justify-center rounded-full bg-primary">
								<span className="font-semibold text-white text-xxs">{totalActive}</span>
							</span>
						)}
					</IconButton>
				</Popover.Trigger>
			</ToolTip>

			<Popover.Content
				className="p-0 shadow-sm w-72 overflow-hidden"
				align={isMobile ? 'start' : 'end'}
				portal
			>
				{activeField ? (
					<FieldScreen
						key={activeField.key}
						field={activeField}
						filters={filters}
						options={optionsFor(activeField, overviewValues)}
						onApply={applyFilters}
						onBack={() => setActiveFieldKey(null)}
					/>
				) : (
					<FieldList
						fields={fields}
						filters={filters}
						totalActive={totalActive}
						onSelect={setActiveFieldKey}
						onClear={handleClear}
					/>
				)}
			</Popover.Content>
		</Popover>
	)
}

type OverviewValues = Partial<Record<OverviewKey, string[]>> | undefined

/**
 * The option list for a field: its fixed vocabulary, or the matching slice of the
 * overview. Values come back already distinct from the server.
 */
const optionsFor = (field: FilterField, overview: OverviewValues): FilterFieldOption[] => {
	if (field.kind !== 'values') return []
	if (field.options) return field.options
	if (!field.overviewKey) return []
	return (overview?.[field.overviewKey] || []).map((value) => ({ label: value, value }))
}

type FieldListProps = {
	fields: FilterField[]
	filters: FilterInput
	totalActive: number
	onSelect: (key: string) => void
	onClear: () => void
}

function FieldList({ fields, filters, totalActive, onSelect, onClear }: FieldListProps) {
	return (
		<Command>
			<Command.Input
				placeholder="Filter by..."
				wrapperClassName="border-0 border-b border-border rounded-none"
			/>
			<Command.List>
				<Command.Empty>No matching field</Command.Empty>
				{fields.map((field) => {
					const count = selectionCount(field, filters)
					return (
						<Command.Item
							key={field.key}
							value={field.label}
							onSelect={() => onSelect(field.key)}
							className="cursor-pointer justify-between"
						>
							<span className="truncate">{field.label}</span>
							<span className="gap-1.5 flex shrink-0 items-center text-muted-foreground">
								{count > 0 && <span className="text-xs text-foreground-subtle">{count}</span>}
								<ChevronRight className="h-4 w-4" />
							</span>
						</Command.Item>
					)
				})}
			</Command.List>

			{totalActive > 0 && (
				<div className="p-1 border-t border-border">
					<Button variant="ghost" size="sm" className="w-full" onClick={onClear}>
						Clear filters
					</Button>
				</div>
			)}
		</Command>
	)
}

type FieldScreenProps = {
	field: FilterField
	filters: FilterInput
	options: FilterFieldOption[]
	onApply: (filters: FilterInput) => void
	onBack: () => void
}

function FieldScreen({ field, filters, options, onApply, onBack }: FieldScreenProps) {
	return (
		<div className="flex flex-col">
			<button
				type="button"
				onClick={onBack}
				className="px-3 py-2 text-sm font-medium gap-1.5 flex items-center border-b border-border text-foreground hover:bg-muted"
			>
				<ChevronLeft className="h-4 w-4 text-muted-foreground" />
				<span className="truncate">{field.label}</span>
			</button>

			{field.kind === 'values' ? (
				<ValueList
					field={field}
					filters={filters}
					options={options}
					onApply={onApply}
					onBack={onBack}
				/>
			) : (
				<RangeInputs field={field} filters={filters} onApply={onApply} />
			)}
		</div>
	)
}

type ValueListProps = {
	field: ValuesField
	filters: FilterInput
	options: FilterFieldOption[]
	onApply: (filters: FilterInput) => void
	onBack: () => void
}

function ValueList({ field, filters, options, onApply, onBack }: ValueListProps) {
	const selected = useMemo(() => new Set(field.read(filters)), [field, filters])

	const toggle = useCallback(
		(value: string) => {
			const next = new Set(selected)
			if (next.has(value)) {
				next.delete(value)
			} else {
				next.add(value)
			}
			onApply(field.write(filters, Array.from(next)))
		},
		[selected, field, filters, onApply],
	)

	return (
		<Command>
			<Command.Input
				placeholder={`Search ${field.label.toLowerCase()}...`}
				wrapperClassName="border-0 border-b border-border rounded-none"
				autoFocus
			/>
			<Command.List>
				<Command.Empty>No matching values</Command.Empty>
				{options.map((option) => {
					const isSelected = selected.has(option.value)
					return (
						<Command.Item
							key={option.value}
							value={option.label}
							onSelect={() => toggle(option.value)}
							className="cursor-pointer justify-between"
						>
							<span className="truncate">{option.label}</span>
							{isSelected && <Check className="h-4 w-4 text-foreground-subtle shrink-0" />}
						</Command.Item>
					)
				})}
			</Command.List>

			{selected.size > 0 && (
				<div className="p-1 border-t border-border">
					<Button
						variant="ghost"
						size="sm"
						className="w-full"
						onClick={() => {
							onApply(field.write(filters, []))
							onBack()
						}}
					>
						Clear {field.label.toLowerCase()}
					</Button>
				</div>
			)}
		</Command>
	)
}

type RangeInputsProps = {
	field: RangeField
	filters: FilterInput
	onApply: (filters: FilterInput) => void
}

/**
 * A blank input means "unbounded", so the value is committed on blur rather than on every
 * keystroke: applying mid-type would turn `19` into a live filter on its way to `1987`.
 */
function RangeInputs({ field, filters, onApply }: RangeInputsProps) {
	const bounds = useMemo(() => field.read(filters), [field, filters])
	const [draft, setDraft] = useState<{ from: string; to: string }>(() => ({
		from: bounds.from?.toString() ?? '',
		to: bounds.to?.toString() ?? '',
	}))

	const commit = useCallback(
		(next: { from: string; to: string }) => {
			const parse = (value: string) => (value.trim() ? Number(value) : null)
			const parsed: NumericBounds = { from: parse(next.from), to: parse(next.to) }
			onApply(field.write(filters, parsed))
		},
		[field, filters, onApply],
	)

	return (
		<div className="p-3 gap-2 flex items-center">
			<Input
				type="number"
				aria-label={`${field.label} from`}
				placeholder={field.placeholderFrom ?? 'From'}
				value={draft.from}
				onChange={(e) => setDraft((prev) => ({ ...prev, from: e.target.value }))}
				onBlur={() => commit(draft)}
			/>
			<span className="text-sm text-foreground-muted">to</span>
			<Input
				type="number"
				aria-label={`${field.label} to`}
				placeholder={field.placeholderTo ?? 'To'}
				value={draft.to}
				onChange={(e) => setDraft((prev) => ({ ...prev, to: e.target.value }))}
				onBlur={() => commit(draft)}
			/>
		</div>
	)
}
