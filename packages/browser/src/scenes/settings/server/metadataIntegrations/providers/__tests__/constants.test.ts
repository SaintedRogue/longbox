import { MetadataProvider } from '@longbox/graphql'

import {
	availableProviders,
	isComicProvider,
	isUnofficialProvider,
	PROVIDER_LABELS,
	PROVIDERS,
} from '../constants'

describe('provider constants', () => {
	it('labels every provider the schema defines', () => {
		// Guards the `Record<MetadataProvider, string>` maps against a new enum variant
		// shipping with a raw SCREAMING_SNAKE name in the UI.
		for (const provider of PROVIDERS) {
			expect(PROVIDER_LABELS[provider]).toBeTruthy()
			expect(PROVIDER_LABELS[provider]).not.toEqual(provider)
		}
	})

	describe('unofficial providers', () => {
		it('classifies LOCG as unofficial and the rest as official', () => {
			expect(isUnofficialProvider(MetadataProvider.Locg)).toBe(true)
			expect(isUnofficialProvider(MetadataProvider.Metron)).toBe(false)
			expect(isUnofficialProvider(MetadataProvider.ComicVine)).toBe(false)
			expect(isUnofficialProvider(MetadataProvider.Hardcover)).toBe(false)
		})

		it('omits unofficial providers entirely until acknowledged', () => {
			// Absent, not disabled: an operator who has not read the disclosure should
			// not see LOCG offered at all.
			const offered = availableProviders(false)
			expect(offered).not.toContain(MetadataProvider.Locg)
			expect(offered).toContain(MetadataProvider.Metron)
			expect(offered).toContain(MetadataProvider.ComicVine)
			expect(offered).toContain(MetadataProvider.Hardcover)
		})

		it('offers them once acknowledged', () => {
			expect(availableProviders(true)).toEqual(PROVIDERS)
			expect(availableProviders(true)).toContain(MetadataProvider.Locg)
		})

		it('never hides an official provider', () => {
			const hidden = PROVIDERS.filter((p) => !availableProviders(false).includes(p))
			expect(hidden.every(isUnofficialProvider)).toBe(true)
		})
	})

	it('treats LOCG as a comic provider', () => {
		// LOCG only covers comics, matching `supported_library_types` on the backend.
		expect(isComicProvider(MetadataProvider.Locg)).toBe(true)
		expect(isComicProvider(MetadataProvider.Hardcover)).toBe(false)
	})
})
