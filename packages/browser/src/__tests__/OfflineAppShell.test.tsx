import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

import { OfflineAppShell } from '../OfflineAppShell'

jest.mock('@stump/i18n', () => ({
	useLocaleContext: () => ({ t: (key: string) => key }),
}))

function MarkerRoute() {
	return <div>marker-child-route</div>
}

function renderShell(initialEntry: string) {
	return render(
		<MemoryRouter initialEntries={[initialEntry]}>
			<Routes>
				<Route path="/" element={<OfflineAppShell />}>
					<Route path="downloads" element={<MarkerRoute />} />
				</Route>
			</Routes>
		</MemoryRouter>,
	)
}

describe('OfflineAppShell', () => {
	it('renders the matched child route (Outlet) for /downloads paths', () => {
		renderShell('/downloads')

		expect(screen.getByText('marker-child-route')).toBeInTheDocument()
		expect(screen.queryByText('offline.title')).not.toBeInTheDocument()
	})

	it('renders an offline notice with a link to downloads for non-downloads paths', () => {
		renderShell('/')

		expect(screen.queryByText('marker-child-route')).not.toBeInTheDocument()
		expect(screen.getByText('offline.title')).toBeInTheDocument()
		expect(screen.getByText('offline.message')).toBeInTheDocument()

		const downloadsLinks = screen.getAllByRole('link', { name: 'offline.viewDownloads' })
		expect(downloadsLinks.length).toBeGreaterThan(0)
		downloadsLinks.forEach((link) => expect(link).toHaveAttribute('href', '/downloads'))
	})
})
