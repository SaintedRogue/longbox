/**
 * Guards the lazy-locale contract in @longbox/i18n: only en-US is compiled into the bundle, and
 * every other locale is a dynamically imported chunk. That makes translation availability a
 * *rendering* concern -- the UI has to keep showing the en-US fallback (never a raw key, never a
 * blank screen) until the chunk lands, then re-render with it applied.
 *
 * These live in @longbox/browser rather than @longbox/i18n because this is the workspace wired
 * for jest + jsdom + testing-library.
 */
import {
	type AllowedLocale,
	changeLocale,
	hasLocaleResources,
	i18n,
	loadLocaleResources,
	LocaleProvider,
	useLocaleContext,
} from '@longbox/i18n'
import { render, screen, waitFor } from '@testing-library/react'

// A key every locale translates. Values are asserted by reading them back out of i18next rather
// than hardcoding strings, so a Crowdin sync can't break these tests.
const KEY = 'authScene.claimHeading'

const translationFor = (locale: AllowedLocale) => i18n.getResource(locale, locale, KEY) as string

function Probe() {
	const { t } = useLocaleContext()
	return <span data-testid="probe">{t(KEY)}</span>
}

describe('lazy locale loading', () => {
	beforeEach(async () => {
		await i18n.changeLanguage('en-US')
	})

	it('bundles en-US so the fallback is available with no async gap', () => {
		expect(hasLocaleResources('en-US')).toBe(true)
		expect(typeof translationFor('en-US')).toBe('string')
		expect(i18n.getFixedT(null, 'en-US')(KEY)).toBe(translationFor('en-US'))
	})

	it('does not register a locale until it is asked for, then resolves it through i18next', async () => {
		expect(hasLocaleResources('fr-FR')).toBe(false)

		await loadLocaleResources('fr-FR')

		expect(hasLocaleResources('fr-FR')).toBe(true)
		expect(typeof translationFor('fr-FR')).toBe('string')
		expect(translationFor('fr-FR')).not.toBe(translationFor('en-US'))
	})

	it('de-dupes concurrent loads of the same locale', async () => {
		const first = loadLocaleResources('sv-SE')
		const second = loadLocaleResources('sv-SE')

		expect(second).toBe(first)

		await first
		expect(hasLocaleResources('sv-SE')).toBe(true)
	})

	it('resolves (rather than throws) for a locale with no chunk', async () => {
		await expect(loadLocaleResources('xx-XX' as AllowedLocale)).resolves.toBeUndefined()
	})

	it('keeps serving the fallback until the chunk lands, then switches language', async () => {
		const pending = changeLocale('de-DE')

		// Language must not flip before the resources exist -- otherwise every key renders raw.
		expect(i18n.language).not.toBe('de-DE')
		expect(i18n.getFixedT(null, 'de-DE')(KEY)).toBe(translationFor('en-US'))

		await pending

		expect(i18n.language).toBe('de-DE')
		expect(i18n.getFixedT(null, 'de-DE')(KEY)).toBe(translationFor('de-DE'))
	})

	it('switches synchronously once a locale is already loaded', async () => {
		await loadLocaleResources('nl-NL')
		await i18n.changeLanguage('en-US')

		changeLocale('nl-NL')

		expect(i18n.language).toBe('nl-NL')
	})
})

describe('LocaleProvider', () => {
	beforeEach(async () => {
		await i18n.changeLanguage('en-US')
	})

	it('renders the en-US fallback first and re-renders once the locale resolves', async () => {
		render(
			<LocaleProvider locale="it-IT">
				<Probe />
			</LocaleProvider>,
		)

		// Never a blank screen (no Suspense fallback) and never a raw key.
		expect(screen.getByTestId('probe')).toHaveTextContent(translationFor('en-US'))

		await waitFor(() =>
			expect(screen.getByTestId('probe')).toHaveTextContent(translationFor('it-IT')),
		)
		expect(document.documentElement.lang).toBe('it-IT')
	})

	it('loads and applies a new locale when the user changes it', async () => {
		const { rerender } = render(
			<LocaleProvider locale="en-US">
				<Probe />
			</LocaleProvider>,
		)

		expect(screen.getByTestId('probe')).toHaveTextContent(translationFor('en-US'))

		rerender(
			<LocaleProvider locale="ja-JP">
				<Probe />
			</LocaleProvider>,
		)

		await waitFor(() =>
			expect(screen.getByTestId('probe')).toHaveTextContent(translationFor('ja-JP')),
		)
		expect(document.documentElement.lang).toBe('ja-JP')
	})
})
