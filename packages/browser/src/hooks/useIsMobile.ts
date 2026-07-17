import { useMediaMatch } from 'rooks'

/**
 * The viewport width at or below which the app treats the device as mobile. This is the same
 * threshold Tailwind's `md` breakpoint uses to swap between the desktop and mobile navigation
 * shells, so JS-driven and CSS-driven responsive decisions stay in agreement.
 */
export const MOBILE_BREAKPOINT_QUERY = '(max-width: 768px)'

/**
 * Whether the viewport is currently mobile-sized. Shared so the 768px literal lives in exactly one
 * place rather than being retyped at every call site, where it would be one typo away from a
 * breakpoint that disagrees with the rest of the app.
 */
export function useIsMobile(): boolean {
	return useMediaMatch(MOBILE_BREAKPOINT_QUERY)
}
