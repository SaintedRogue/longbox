import { BookPreferences, ReaderSettings, ReaderStore } from '@longbox/client'
import { PickSelect } from '@longbox/components'
import { BookReaderSceneQuery, ReadingImageScaleFit } from '@longbox/graphql'
import { useCallback, useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'

import { ImageReaderBookRef } from '@/components/readers/imageBased/context'
import { useIsMobile } from '@/hooks'
import { useReaderStore } from '@/stores'

type Params = {
	book: ImageReaderBookRef
}

type Return = Omit<
	ReaderStore,
	'bookPreferences' | 'setBookPreferences' | 'clearStore' | 'bookTimers' | 'setBookTimer'
> & {
	bookPreferences: BookPreferences
	setBookPreferences: (preferences: Partial<BookPreferences>) => void
}

export function useBookPreferences({ book }: Params): Return {
	const {
		bookPreferences: allPreferences,
		setBookPreferences: storedSetBookPreferences,
		settings,
		setSettings,
	} = useReaderStore(
		useShallow((state) => ({
			bookPreferences: state.bookPreferences,
			setBookPreferences: state.setBookPreferences,
			setSettings: state.setSettings,
			settings: state.settings,
		})),
	)

	const storedBookPreferences = useMemo(() => allPreferences[book.id], [allPreferences, book.id])

	/**
	 * The library configuration, used for picking default reader settings. This realistically
	 * should never be null once the query resolves
	 */
	const libraryConfig = useMemo(() => book.libraryConfig, [book])
	const libraryDefaults = useMemo(() => defaultsFromLibraryConfig(libraryConfig), [libraryConfig])

	const isMobile = useIsMobile()

	const bookPreferences = useMemo(() => {
		const preferences = buildPreferences(storedBookPreferences ?? {}, settings, libraryDefaults)
		// On phone-sized viewports, always fit pages to width. Every other scaling mode sizes the
		// page to the viewport *height*, which makes a portrait comic wider than a narrow screen and
		// slices the sides off. Width is the only mode that keeps a whole page on-screen on mobile,
		// so we override here rather than trusting the (desktop-oriented) library/user default.
		if (isMobile) {
			return {
				...preferences,
				imageScaling: { ...preferences.imageScaling, scaleToFit: ReadingImageScaleFit.Width },
			}
		}
		return preferences
	}, [storedBookPreferences, libraryDefaults, settings, isMobile])

	const setBookPreferences = useCallback(
		(preferences: Partial<typeof bookPreferences>) => {
			storedSetBookPreferences(book.id, {
				...bookPreferences,
				...preferences,
			})
		},
		[book.id, storedSetBookPreferences, bookPreferences],
	)

	return {
		bookPreferences,
		setBookPreferences,
		setSettings,
		settings,
	}
}

const defaultsFromLibraryConfig = (
	libraryConfig?: PickSelect<NonNullable<BookReaderSceneQuery['mediaById']>, 'libraryConfig'>,
): Partial<BookPreferences> => ({
	brightness: 1,
	// imageScaling: {
	// 	scaleToFit: libraryConfig?.defaultReadingImageScaleFit || ReadingImageScaleFit.Height,
	// },
	imageScaling: libraryConfig?.defaultReadingImageScaleFit
		? {
				scaleToFit: libraryConfig?.defaultReadingImageScaleFit as ReadingImageScaleFit,
			}
		: undefined,
	readingDirection: libraryConfig?.defaultReadingDir,
	readingMode: libraryConfig?.defaultReadingMode,
})

const settingsAsBookPreferences = (settings: ReaderSettings): BookPreferences => ({
	animatedReader: settings.animatedReader,
	brightness: settings.brightness,
	imageScaling: settings.imageScaling,
	readingDirection: settings.readingDirection,
	readingMode: settings.readingMode,
	tapSidesToNavigate: settings.tapSidesToNavigate,
	swipeToNavigate: settings.swipeToNavigate,
	fontSize: settings.fontSize,
	lineHeight: settings.lineHeight,
	trackElapsedTime: settings.trackElapsedTime,
	doublePageBehavior: settings.doublePageBehavior,
	fontFamily: settings.fontFamily,
	secondPageSeparate: settings.secondPageSeparate,
	panzoomWithoutCtrl: settings.panzoomWithoutCtrl,
})

const buildPreferences = (
	preferences: Partial<BookPreferences>,
	settings: ReaderSettings,
	libraryDefaults: Partial<BookPreferences>,
): BookPreferences => ({
	...settingsAsBookPreferences(settings),
	...libraryDefaults,
	...preferences,
})
