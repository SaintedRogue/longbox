import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import { useMatchReviewStore } from '../../metadataMatching/useMatchReviewStore'
import ProviderMatchDialog from '../ProviderMatchDialog'

/**
 * Picking the right *match* and accepting every one of its *fields* are two different
 * decisions. Selecting a candidate used to apply the whole thing outright, so a provider
 * that got the issue right could still overwrite a good summary or the wrong creators with
 * no way to say no. It now hands off to the same field-by-field review that queued matches
 * already went through.
 */

const mockExecute = jest.fn()
const mockMutateAsync = jest.fn()

jest.mock('@longbox/client', () => ({
	useSDK: () => ({ sdk: { execute: (...args: unknown[]) => mockExecute(...args) } }),
	useGraphQLMutation: () => ({ mutateAsync: (...args: unknown[]) => mockMutateAsync(...args) }),
}))
jest.mock('@longbox/i18n', () => ({ useLocaleContext: () => ({ t: (key: string) => key }) }))
jest.mock('../../metadataMatching/reviewDialog/MatchReviewDialog', () => ({
	MatchReviewDialog: () => <div data-testid="review-dialog" />,
}))

const RECORD = { id: 'rec-1', mediaId: 'book-1', matchCandidates: [] }

const CANDIDATES = [
	{ provider: 'COMIC_VINE', externalId: 'a', confidence: 0.9, metadata: { title: 'First' } },
	{ provider: 'COMIC_VINE', externalId: 'b', confidence: 0.5, metadata: { title: 'Second' } },
]

beforeEach(() => {
	mockExecute.mockReset()
	mockMutateAsync.mockReset()
	useMatchReviewStore.setState({ isOpen: false, records: [], currentCandidateIndex: 0 })

	// The dialog loads its context (book name, providers, parsed seed) before it will render
	// the search panel, then reads the fetch record back once a candidate is picked.
	mockExecute.mockImplementation((document: unknown) => {
		const query = String(document)
		if (query.includes('ProviderMatchMediaContext')) {
			return Promise.resolve({
				mediaById: { id: 'book-1', name: 'file.cbz', resolvedName: 'A Book' },
			})
		}
		if (query.includes('ProviderMatchProviders')) {
			return Promise.resolve({
				metadataProviderConfigs: [{ enabled: true, position: 0, providerType: 'COMIC_VINE' }],
			})
		}
		if (query.includes('ProviderMatchParse')) {
			return Promise.resolve({ parseComicFilename: { series: 'A Book', number: '1', year: 2024 } })
		}
		if (query.includes('ProviderMatchRecord')) {
			return Promise.resolve({ metadataFetchRecord: RECORD })
		}
		return Promise.resolve({})
	})
	mockMutateAsync.mockResolvedValue({ fetchMediaMetadata: CANDIDATES })
})

const renderDialog = () =>
	render(<ProviderMatchDialog kind="media" id="book-1" open onOpenChange={jest.fn()} />)

const searchAndSelect = async (which: number) => {
	fireEvent.click(await screen.findByRole('button', { name: /^Search$/ }))
	const selects = await screen.findAllByRole('button', { name: 'Select' })
	fireEvent.click(selects[which] as HTMLElement)
}

describe('ProviderMatchDialog', () => {
	it('opens the field review instead of applying the whole candidate', async () => {
		renderDialog()
		await searchAndSelect(0)

		await waitFor(() => expect(useMatchReviewStore.getState().isOpen).toBe(true))
		expect(useMatchReviewStore.getState().records).toEqual([RECORD])
	})

	/**
	 * The accept mutation re-runs the search server-side and applies whichever candidate sits
	 * at the given index, so the review has to open on the one that was clicked.
	 */
	it('opens the review positioned on the candidate that was picked', async () => {
		renderDialog()
		await searchAndSelect(1)

		await waitFor(() => expect(useMatchReviewStore.getState().isOpen).toBe(true))
		expect(useMatchReviewStore.getState().currentCandidateIndex).toBe(1)
	})

	it('writes nothing when a candidate is selected', async () => {
		renderDialog()
		await searchAndSelect(0)

		await waitFor(() => expect(useMatchReviewStore.getState().isOpen).toBe(true))
		// The only mutation run is the search itself; nothing accepted it.
		expect(mockMutateAsync).toHaveBeenCalledTimes(1)
	})
})
