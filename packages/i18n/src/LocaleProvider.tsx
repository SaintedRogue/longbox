import { Suspense, useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import { AllowedLocale, changeLocale } from './config'
import { getDefaultLocale, LocaleContext } from './context'
import { initDateFnsLocale } from './dateFnsLocale'

type Props = {
	children: React.ReactNode
	locale?: AllowedLocale
}

export default function LocaleProvider({ locale = getDefaultLocale(), children }: Props) {
	const { t } = useTranslation(locale, { useSuspense: false })

	useEffect(() => {
		// Only en-US is bundled; every other locale is a lazily imported chunk. `changeLocale`
		// waits for that chunk before flipping i18next's language, so children keep rendering the
		// en-US fallback until the real translations land instead of flashing raw keys. No
		// Suspense boundary is involved -- the app must never blank out over a locale swap.
		changeLocale(locale)
		initDateFnsLocale(locale)
		// locale provider is used in web and expo, the latter
		// not having a document
		if ('document' in globalThis) {
			document.documentElement.lang = locale
		}
	}, [locale])

	return (
		<Suspense>
			<LocaleContext.Provider
				value={{
					locale,
					t,
				}}
			>
				{children}
			</LocaleContext.Provider>
		</Suspense>
	)
}
