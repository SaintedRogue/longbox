import { render, screen } from '@testing-library/react'

import URLPagination from '../URLPagination'

jest.mock('@longbox/i18n', () => ({
	useLocaleContext: () => ({ t: (key: string) => key }),
}))

describe('URLPagination', () => {
	it('gives the icon-only page arrows an accessible name', () => {
		render(<URLPagination pages={5} currentPage={2} onChangePage={jest.fn()} />)

		expect(
			screen.getByRole('button', { name: 'pagination.buttons.previousPage' }),
		).toBeInTheDocument()
		expect(screen.getByRole('button', { name: 'pagination.buttons.nextPage' })).toBeInTheDocument()
	})

	it('labels the page number input, which has no visible <label>', () => {
		render(<URLPagination pages={5} currentPage={2} onChangePage={jest.fn()} />)

		expect(screen.getByRole('spinbutton', { name: 'pagination.input.label' })).toBeInTheDocument()
	})

	it('leaves no button without an accessible name', () => {
		render(<URLPagination pages={5} currentPage={2} onChangePage={jest.fn()} />)

		const unnamed = screen
			.getAllByRole('button')
			.filter((button) => !button.getAttribute('aria-label')?.trim() && !button.textContent?.trim())
		expect(unnamed).toHaveLength(0)
	})
})
