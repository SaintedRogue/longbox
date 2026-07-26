import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'

import URLPageSize from '../URLPageSize'

/**
 * The page-size control was the browse footer's *second* type-a-number-and-press-Enter field,
 * sized at 24-28px. Sizes come from a fixed set, so a select says so directly -- and gives
 * the value a finger-sized target instead of a spin box.
 */

jest.mock('@longbox/i18n', () => ({ useLocaleContext: () => ({ t: (key: string) => key }) }))
jest.mock('rooks', () => ({ useMediaMatch: () => false }))

function Harness() {
	const location = useLocation()
	return (
		<>
			<URLPageSize />
			<span data-testid="query">{location.search}</span>
		</>
	)
}

const renderAt = (entry: string) =>
	render(
		<MemoryRouter initialEntries={[entry]}>
			<Harness />
		</MemoryRouter>,
	)

describe('URLPageSize', () => {
	it('offers page sizes as a labelled select rather than a number field', () => {
		renderAt('/libraries/1/books')

		expect(screen.getByRole('combobox', { name: 'pagination.pageSize.label' })).toBeInTheDocument()
	})

	it('reflects the size currently in the URL', () => {
		renderAt('/libraries/1/books?pageSize=40')

		expect(screen.getByRole('combobox', { name: 'pagination.pageSize.label' })).toHaveValue('40')
	})

	it('writes the chosen size to the URL', () => {
		renderAt('/libraries/1/books?page=3')

		fireEvent.change(screen.getByRole('combobox', { name: 'pagination.pageSize.label' }), {
			target: { value: '60' },
		})

		expect(screen.getByTestId('query')).toHaveTextContent('pageSize=60')
	})
})
