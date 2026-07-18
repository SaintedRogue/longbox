import { ReadingImageScaleFit } from '@longbox/graphql'
import { renderHook } from '@testing-library/react'
import { useMediaMatch } from 'rooks'

import { ImageReaderBookRef } from '@/components/readers/imageBased/context'

import { useBookPreferences } from '../useBookPreferences'

// `useIsMobile` is a thin wrapper over rooks' `useMediaMatch`, so mocking the media query lets us
// flip the viewport between "phone" and "desktop" without a real DOM matchMedia.
jest.mock('rooks', () => ({ useMediaMatch: jest.fn() }))

// A self-contained reader store: no per-book overrides, global settings + library default both at
// HEIGHT ('HEIGHT' is the literal value of ReadingImageScaleFit.Height). This isolates the hook's
// own mobile override from any persisted preference. Values are inlined because a jest.mock factory
// may not reference out-of-scope imports.
jest.mock('@/stores', () => {
	const settings = {
		animatedReader: false,
		brightness: 1,
		doublePageBehavior: 'off',
		fontSize: 13,
		imageScaling: { scaleToFit: 'HEIGHT' },
		lineHeight: 1.5,
		readingDirection: 'LTR',
		readingMode: 'PAGED',
		secondPageSeparate: false,
		swipeToNavigate: true,
		tapSidesToNavigate: true,
		trackElapsedTime: true,
	}
	const state = {
		bookPreferences: {},
		setBookPreferences: jest.fn(),
		setSettings: jest.fn(),
		settings,
	}
	return { useReaderStore: (selector: (s: unknown) => unknown) => selector(state) }
})

const book = {
	id: 'book-1',
	libraryConfig: {
		defaultReadingDir: 'LTR',
		defaultReadingImageScaleFit: ReadingImageScaleFit.Height,
		defaultReadingMode: 'PAGED',
	},
} as unknown as ImageReaderBookRef

describe('useBookPreferences image scaling', () => {
	it('forces fit-to-width on mobile so portrait pages are not cropped sideways', () => {
		jest.mocked(useMediaMatch).mockReturnValue(true) // phone-sized viewport

		const { result } = renderHook(() => useBookPreferences({ book }))

		expect(result.current.bookPreferences.imageScaling.scaleToFit).toBe(ReadingImageScaleFit.Width)
	})

	it('keeps the configured scaling mode on desktop', () => {
		jest.mocked(useMediaMatch).mockReturnValue(false) // desktop viewport

		const { result } = renderHook(() => useBookPreferences({ book }))

		expect(result.current.bookPreferences.imageScaling.scaleToFit).toBe(ReadingImageScaleFit.Height)
	})
})
