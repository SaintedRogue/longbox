import { fireEvent, render, screen } from '@testing-library/react'

import URLPagination from '../URLPagination'

/**
 * The browse footer used to offer a 28px number input as the only way to change page: type a
 * number, press Enter, and lose it again if you clicked away (blur silently reverted). These
 * tests pin the replacement -- directly clickable page numbers, with the jump-to-page form
 * kept behind the ellipsis for lists too long to enumerate.
 */

jest.mock('@longbox/i18n', () => ({
	useLocaleContext: () => ({ t: (key: string) => key }),
}))
jest.mock('rooks', () => ({ useWindowSize: () => ({ innerWidth: 1280, innerHeight: 800 }) }))

// Each page button is named by its visible number, so these queries assert the real
// accessible name rather than an interpolated string echoed back by the `t` mock.
const pageButton = (page: number) => screen.getByRole('button', { name: String(page) })

describe('URLPagination', () => {
	describe('page numbers', () => {
		it('renders a clickable button per page', () => {
			const onChangePage = jest.fn()
			render(<URLPagination pages={5} currentPage={2} onChangePage={onChangePage} />)

			fireEvent.click(pageButton(4))

			expect(onChangePage).toHaveBeenCalledWith(4)
		})

		it('marks the current page for assistive tech', () => {
			render(<URLPagination pages={5} currentPage={2} onChangePage={jest.fn()} />)

			expect(pageButton(2)).toHaveAttribute('aria-current', 'page')
			expect(pageButton(3)).not.toHaveAttribute('aria-current', 'page')
		})

		it('collapses a long run of pages behind an ellipsis rather than rendering all of them', () => {
			render(<URLPagination pages={99} currentPage={50} onChangePage={jest.fn()} />)

			expect(
				screen.getAllByRole('button', { name: 'pagination.input.label' }).length,
			).toBeGreaterThan(0)
			expect(screen.queryByRole('button', { name: '25' })).not.toBeInTheDocument()
			// first and last stay reachable in one click
			expect(pageButton(1)).toBeInTheDocument()
			expect(pageButton(99)).toBeInTheDocument()
		})

		it('renders nothing when there is only one page', () => {
			const { container } = render(
				<URLPagination pages={1} currentPage={1} onChangePage={jest.fn()} />,
			)

			expect(container).toBeEmptyDOMElement()
		})
	})

	describe('arrows', () => {
		it('gives the icon-only page arrows an accessible name', () => {
			render(<URLPagination pages={5} currentPage={2} onChangePage={jest.fn()} />)

			expect(
				screen.getByRole('button', { name: 'pagination.buttons.previousPage' }),
			).toBeInTheDocument()
			expect(
				screen.getByRole('button', { name: 'pagination.buttons.nextPage' }),
			).toBeInTheDocument()
		})

		it('disables previous on the first page and next on the last', () => {
			const { rerender } = render(
				<URLPagination pages={5} currentPage={1} onChangePage={jest.fn()} />,
			)
			expect(screen.getByRole('button', { name: 'pagination.buttons.previousPage' })).toBeDisabled()

			rerender(<URLPagination pages={5} currentPage={5} onChangePage={jest.fn()} />)
			expect(screen.getByRole('button', { name: 'pagination.buttons.nextPage' })).toBeDisabled()
		})
	})

	it('leaves no button without an accessible name', () => {
		render(<URLPagination pages={99} currentPage={50} onChangePage={jest.fn()} />)

		const unnamed = screen
			.getAllByRole('button')
			.filter((button) => !button.getAttribute('aria-label')?.trim() && !button.textContent?.trim())
		expect(unnamed).toHaveLength(0)
	})
})
