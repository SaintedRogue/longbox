import { render, screen } from '@testing-library/react'

import { ProviderValidationFeedback } from '../ProviderValidationFeedback'

describe('ProviderValidationFeedback', () => {
	it('renders nothing when there is no feedback and not checking', () => {
		const { container } = render(<ProviderValidationFeedback feedback={null} />)
		expect(container).toBeEmptyDOMElement()
	})

	it('shows a checking indicator while validating', () => {
		render(<ProviderValidationFeedback feedback={null} isChecking />)
		expect(screen.getByText('Checking…')).toBeInTheDocument()
	})

	it('renders a success line with the title', () => {
		render(
			<ProviderValidationFeedback
				feedback={{
					severity: 'success',
					asFieldError: false,
					title: 'Verified',
					description: 'ok',
				}}
			/>,
		)
		expect(screen.getByText('Verified')).toBeInTheDocument()
		expect(screen.queryByRole('alert')).not.toBeInTheDocument()
	})

	it('renders warnings as an alert with description and hint', () => {
		render(
			<ProviderValidationFeedback
				feedback={{
					severity: 'warning',
					asFieldError: false,
					title: "Couldn't reach Metron",
					description: 'msg',
					hint: 'connectivity hint',
				}}
			/>,
		)
		expect(screen.getByRole('alert')).toBeInTheDocument()
		expect(screen.getByText("Couldn't reach Metron")).toBeInTheDocument()
		expect(screen.getByText('connectivity hint')).toBeInTheDocument()
	})

	it('renders error severity as an alert', () => {
		render(
			<ProviderValidationFeedback
				feedback={{
					severity: 'error',
					asFieldError: false,
					title: 'Access denied',
					description: 'm',
				}}
			/>,
		)
		expect(screen.getByRole('alert')).toBeInTheDocument()
		expect(screen.getByText('Access denied')).toBeInTheDocument()
	})
})
