import { NativeSelect } from '@longbox/components'
import { CharacterOrderBy, CharacterOrdering, OrderDirection } from '@longbox/graphql'
import { useLocaleContext } from '@longbox/i18n'
import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'

/**
 * The orderings offered on the characters page. There are only four meaningful
 * (field, direction) combinations, so they're flattened into a single select rather than
 * the field-select + direction-toggle popover (`URLOrdering`) the filterable entity scenes
 * use — the characters scene has no filter context to hang that off of.
 */
const ORDER_BY_OPTION = {
	fewestBooks: {
		direction: OrderDirection.Asc,
		field: CharacterOrdering.BookCount,
	},
	mostBooks: {
		direction: OrderDirection.Desc,
		field: CharacterOrdering.BookCount,
	},
	nameAsc: {
		direction: OrderDirection.Asc,
		field: CharacterOrdering.Name,
	},
	nameDesc: {
		direction: OrderDirection.Desc,
		field: CharacterOrdering.Name,
	},
} as const satisfies Record<string, CharacterOrderBy>

export type CharacterOrderOption = keyof typeof ORDER_BY_OPTION

/**
 * Most-appearances-first, matching the server-side default for the `characters` query. The
 * whole point of the page is to make the characters you actually have books for obvious.
 */
export const DEFAULT_CHARACTER_ORDER: CharacterOrderOption = 'mostBooks'

// Rendered in this order, i.e. the two book-count orderings first
const ORDER_OPTIONS: CharacterOrderOption[] = ['mostBooks', 'fewestBooks', 'nameAsc', 'nameDesc']

const isOrderOption = (value: string | null): value is CharacterOrderOption =>
	!!value && value in ORDER_BY_OPTION

/**
 * Reads (and writes) the character ordering from the `order` URL param, so that an ordering
 * survives a refresh and can be shared/linked.
 */
export function useURLCharacterOrdering() {
	const [searchParams, setSearchParams] = useSearchParams()

	const order = useMemo(() => {
		const value = searchParams.get('order')
		return isOrderOption(value) ? value : DEFAULT_CHARACTER_ORDER
	}, [searchParams])

	const setOrder = useCallback(
		(value: CharacterOrderOption) => {
			setSearchParams((prev) => {
				if (value === DEFAULT_CHARACTER_ORDER) {
					prev.delete('order')
				} else {
					prev.set('order', value)
				}
				// Whichever page you were on no longer means anything once the list is reordered
				prev.set('page', '1')
				return prev
			})
		},
		[setSearchParams],
	)

	const orderBy = useMemo<CharacterOrderBy[]>(() => [ORDER_BY_OPTION[order]], [order])

	return { order, orderBy, setOrder }
}

type Props = {
	value: CharacterOrderOption
	onChange: (value: CharacterOrderOption) => void
}

export default function CharacterOrderSelect({ value, onChange }: Props) {
	const { t } = useLocaleContext()

	const options = useMemo(
		() =>
			ORDER_OPTIONS.map((option) => ({
				label: t(`charactersScene.ordering.options.${option}`),
				value: option,
			})),
		[t],
	)

	return (
		<NativeSelect
			className="w-auto shrink-0"
			size="sm"
			options={options}
			value={value}
			aria-label={t('charactersScene.ordering.label')}
			onChange={(e) => onChange(e.target.value as CharacterOrderOption)}
		/>
	)
}
