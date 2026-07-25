import { InterfaceLayout } from '@longbox/graphql'
import { render, screen } from '@testing-library/react'

import TableOrGridLayout from '../TableOrGridLayout'

jest.mock('@longbox/i18n', () => ({
	useLocaleContext: () => ({ t: (key: string) => key }),
}))

describe('TableOrGridLayout', () => {
	it('gives both icon-only layout toggles an accessible name', () => {
		render(<TableOrGridLayout layout={InterfaceLayout.Grid} setLayout={jest.fn()} />)

		expect(screen.getByRole('button', { name: 'filters.buttons.gridLayout' })).toBeInTheDocument()
		expect(screen.getByRole('button', { name: 'filters.buttons.tableLayout' })).toBeInTheDocument()
	})

	it('leaves no button without an accessible name', () => {
		render(<TableOrGridLayout layout={InterfaceLayout.Table} setLayout={jest.fn()} />)

		const unnamed = screen
			.getAllByRole('button')
			.filter((button) => !button.getAttribute('aria-label')?.trim() && !button.textContent?.trim())
		expect(unnamed).toHaveLength(0)
	})
})
