import i18n, { Resource, ResourceKey } from 'i18next'
import { initReactI18next } from 'react-i18next'

import enUS from './locales/en-US.json'

export const LOCALES = [
	'af-ZA',
	'ar-SA',
	'ca-ES',
	'cs-CZ',
	'da-DK',
	'de-DE',
	'el-GR',
	'en-GB',
	'en-US',
	'es-ES',
	'fa-IR',
	'fi-FI',
	'fr-FR',
	'he-IL',
	'hu-HU',
	'it-IT',
	'ja-JP',
	'ko-KR',
	'nl-NL',
	'no-NO',
	'pl-PL',
	'pt-BR',
	'pt-PT',
	'ro-RO',
	'ru-RU',
	'sr-SP',
	'sv-SE',
	'tr-TR',
	'uk-UA',
	'vi-VN',
	'zh-CN',
	'zh-TW',
] as const

export type AllowedLocale = (typeof LOCALES)[number]

/**
 * Every locale except en-US, which is compiled into the main bundle. en-US is the
 * `fallbackLng`/`fallbackNS`, so it has to be available synchronously on the very first render —
 * anything else would flash raw translation keys before the resources land.
 */
type LazyLocale = Exclude<AllowedLocale, 'en-US'>

/**
 * Loaders for every locale that is *not* bundled. Each `import()` is its own Vite chunk, so a
 * user downloads exactly one translation file (the one they picked) instead of all 32 — the
 * locale JSON is ~100kB apiece, i.e. ~3.3MB of the main bundle before this was split out.
 *
 * This mirrors `dateFnsLocaleLoaders` in ./dateFnsLocale.ts: an explicit record rather than a
 * templated `import(\`./locales/${locale}.json\`)`, so the set of chunks is statically known and
 * a typo is a type error.
 */
const localeResourceLoaders: Record<LazyLocale, () => Promise<{ default: ResourceKey }>> = {
	'af-ZA': () => import('./locales/af-ZA.json'),
	'ar-SA': () => import('./locales/ar-SA.json'),
	'ca-ES': () => import('./locales/ca-ES.json'),
	'cs-CZ': () => import('./locales/cs-CZ.json'),
	'da-DK': () => import('./locales/da-DK.json'),
	'de-DE': () => import('./locales/de-DE.json'),
	'el-GR': () => import('./locales/el-GR.json'),
	'en-GB': () => import('./locales/en-GB.json'),
	'es-ES': () => import('./locales/es-ES.json'),
	'fa-IR': () => import('./locales/fa-IR.json'),
	'fi-FI': () => import('./locales/fi-FI.json'),
	'fr-FR': () => import('./locales/fr-FR.json'),
	'he-IL': () => import('./locales/he-IL.json'),
	'hu-HU': () => import('./locales/hu-HU.json'),
	'it-IT': () => import('./locales/it-IT.json'),
	'ja-JP': () => import('./locales/ja-JP.json'),
	'ko-KR': () => import('./locales/ko-KR.json'),
	'nl-NL': () => import('./locales/nl-NL.json'),
	'no-NO': () => import('./locales/no-NO.json'),
	'pl-PL': () => import('./locales/pl-PL.json'),
	'pt-BR': () => import('./locales/pt-BR.json'),
	'pt-PT': () => import('./locales/pt-PT.json'),
	'ro-RO': () => import('./locales/ro-RO.json'),
	'ru-RU': () => import('./locales/ru-RU.json'),
	'sr-SP': () => import('./locales/sr-SP.json'),
	'sv-SE': () => import('./locales/sv-SE.json'),
	'tr-TR': () => import('./locales/tr-TR.json'),
	'uk-UA': () => import('./locales/uk-UA.json'),
	'vi-VN': () => import('./locales/vi-VN.json'),
	'zh-CN': () => import('./locales/zh-CN.json'),
	'zh-TW': () => import('./locales/zh-TW.json'),
}

/**
 * The resources i18next is initialized with. Note the shape: the locale is used as *both* the
 * language and the namespace, which is what `useTranslation(locale)` in ./LocaleProvider.tsx
 * relies on. Lazily-loaded locales are registered under the same shape via `addResourceBundle`,
 * and i18next mutates this object in place as they arrive (it keeps the reference).
 */
export const resources: Resource = {
	'en-US': {
		'en-US': enUS,
		sentenceCase: sentenceCase(enUS),
	},
}

export type Translation = (typeof resources)['en-US']['en-US']

i18n.use(initReactI18next).init({
	fallbackLng: 'en-US',
	fallbackNS: 'en-US',
	interpolation: {
		escapeValue: false, // not needed for react as it escapes by default
	},
	parseMissingKeyHandler,
	resources,
})

export { i18n }

/**
 * Whether the translations for a locale are already registered with i18next — true for the
 * bundled locale, and for any lazy locale that has finished loading.
 */
export function hasLocaleResources(locale: AllowedLocale): boolean {
	return i18n.hasResourceBundle(locale, locale)
}

const inFlightLocaleLoads = new Map<AllowedLocale, Promise<void>>()

/**
 * Load (and register) the translations for a locale. Resolves immediately for the bundled locale
 * and for anything already loaded, de-dupes concurrent loads, and never rejects: a failed chunk
 * fetch leaves i18next on the en-US fallback rather than tearing down the app.
 */
export function loadLocaleResources(locale: AllowedLocale): Promise<void> {
	if (hasLocaleResources(locale)) {
		return Promise.resolve()
	}

	const inFlight = inFlightLocaleLoads.get(locale)
	if (inFlight) {
		return inFlight
	}

	const loader = localeResourceLoaders[locale as LazyLocale]
	// An unknown locale (e.g. a stale value persisted in the user store) has no chunk to load. Let
	// it through: i18next resolves it against `fallbackLng` just as it did before.
	if (!loader) {
		return Promise.resolve()
	}

	const load = loader()
		.then((module) => {
			// The module namespace under a CJS interop (jest) carries the JSON on `default` too,
			// but be defensive — a missing `default` would silently blank the UI.
			const translation: ResourceKey = module.default ?? (module as unknown as ResourceKey)
			i18n.addResourceBundle(locale, locale, translation, true, true)
			// en-GB historically also shipped a `sentenceCase` namespace alongside en-US. Keep it,
			// derived at load time now that the JSON itself is lazy.
			if (locale === 'en-GB') {
				i18n.addResourceBundle(
					locale,
					'sentenceCase',
					sentenceCase(translation as RecursiveResource),
					true,
					true,
				)
			}
		})
		.catch((error) => {
			console.error(`Failed to load translations for ${locale}`, error)
		})
		.finally(() => {
			inFlightLocaleLoads.delete(locale)
		})

	inFlightLocaleLoads.set(locale, load)

	return load
}

/**
 * Switch i18next to a locale, loading its chunk first when needed.
 *
 * The language is flipped *after* the resources are registered, on purpose: react-i18next only
 * re-renders on `languageChanged` (not on store `added` events), so doing it in this order means
 * consumers keep rendering the en-US fallback until the real translations are in hand, then
 * re-render once with them applied. Flipping first would flash untranslated keys.
 */
export function changeLocale(locale: AllowedLocale): Promise<unknown> {
	if (hasLocaleResources(locale)) {
		return i18n.changeLanguage(locale)
	}

	return loadLocaleResources(locale).then(() => i18n.changeLanguage(locale))
}

function parseMissingKeyHandler(missingKey: string) {
	try {
		const translation = (missingKey ?? '')
			.split('.')
			.filter(Boolean)
			// @ts-expect-error: This is a complicated type, but we know it will work
			.reduce((previous, current) => previous?.[current], resources['en-US']['en-US'])

		if (typeof translation === 'string') {
			return translation
		}

		return missingKey
	} catch (error) {
		console.error('Failed to parse missing key', error)
		return missingKey
	}
}

type RecursiveResource = string | RecursiveResource[] | { [key: string]: RecursiveResource }

function sentenceCase(obj: RecursiveResource): ResourceKey {
	const preservedWords = new Set(['Longbox', 'OPDS', 'URL', 'URLs', 'PDF'])

	if (typeof obj === 'string') {
		let isFirstMatch = true
		return obj.replace(/\{\{.*?\}\}|\S+/g, (match) => {
			let result
			if (match.startsWith('{{')) {
				result = match
			} else if (preservedWords.has(match)) {
				result = match
			} else if (isFirstMatch === true) {
				result = match
			} else {
				result = match.toLowerCase()
			}

			isFirstMatch = false
			return result
		})
	}

	if (Array.isArray(obj)) {
		return obj.map(sentenceCase)
	}

	if (typeof obj === 'object' && obj !== null) {
		return Object.fromEntries(Object.entries(obj).map(([key, value]) => [key, sentenceCase(value)]))
	}

	return obj
}
