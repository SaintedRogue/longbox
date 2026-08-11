import { getPaginationRowModel } from '@tanstack/react-table'
import { render, screen } from '@testing-library/react'

import Table from '../Table'

/**
 * The row count fell back to `pageCount * pageSize` whenever no `totalCount` was passed,
 * which rounds a short list up to a full page: a pending-matches table holding one row
 * reported "1 to 10 of 10". That fallback is only right for a server-paginated table, where
 * `data` is one page and its length says nothing about the total.
 */

jest.mock('@/hooks/usePreferences', () => ({ usePreferences: () => ({ preferences: {} }) }))
jest.mock('@/hooks/useTheme', () => ({ useTheme: () => ({ isDarkVariant: false }) }))
jest.mock('overlayscrollbars-react', () => ({ useOverlayScrollbars: () => [jest.fn()] }))

type Row = { name: string }

const columns = [{ accessorKey: 'name', header: 'Name', id: 'name' }]

const renderTable = (rowCount: number, extra: Record<string, unknown> = {}) =>
	render(
		<Table<Row, unknown>
			data={Array.from({ length: rowCount }, (_, i) => ({ name: `row ${i}` }))}
			columns={columns}
			options={{
				getPaginationRowModel: getPaginationRowModel(),
				...extra,
			}}
		/>,
	)

/**
 * Reads as `1 to 1of 1` in the DOM: the bounds sit in a span and `of N` is a sibling text
 * node, with the visual gap coming from the flex container rather than a space character.
 */
const countSummary = () =>
	screen
		.getByText(
			(_, element) => element?.textContent?.includes(' to ') === true && element.tagName === 'P',
		)
		.textContent?.replace(/\s+/g, ' ')
		.trim()

describe('Table row count', () => {
	it('counts the rows it actually has when paginating client-side', () => {
		renderTable(1)

		expect(countSummary()).toBe('1 to 1of 1')
	})

	it('does not round a short list up to a full page', () => {
		renderTable(3)

		expect(countSummary()).toBe('1 to 3of 3')
	})

	/**
	 * A server-paginated table only holds one page, so its row count says nothing about the
	 * total — `pageCount * pageSize` stays the right estimate there.
	 */
	it('still estimates from the page count when pagination is server-side', () => {
		renderTable(10, { pageCount: 3, manualPagination: true })

		expect(countSummary()).toBe('1 to 10of 30')
	})

	it('prefers an explicit total over either', () => {
		render(
			<Table<Row, unknown>
				data={[{ name: 'only' }]}
				columns={columns}
				options={{}}
				totalCount={42}
			/>,
		)

		expect(countSummary()).toContain('of 42')
	})
})
