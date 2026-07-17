import { cva, VariantProps } from 'class-variance-authority'
import { forwardRef } from 'react'

import { cn } from '../utils'
import { BUTTON_BASE_CLASSES, BUTTON_ROUNDED_VARIANTS, BUTTON_VARIANTS } from './Button'

/**
 * Every `size` below sits under the 44px/48dp touch minimum, which is the right call for a
 * pointer: an icon button next to a mouse should be compact. On a touch-primary device it is not,
 * so `hitArea="touch"` grows the control to 44px there and only there -- the icon and the desktop
 * footprint are untouched.
 *
 * This grows the button's real box rather than overlaying a larger invisible hit area, because
 * icon buttons are routinely spaced only 4-6px apart; an invisible 44px overlay would spill onto
 * its neighbours and swallow their taps.
 */
export const ICON_BUTTON_HIT_AREA_VARIANTS = {
	default: '',
	touch: 'pointer-coarse:size-11',
}

const iconButtonVariants = cva(BUTTON_BASE_CLASSES, {
	defaultVariants: {
		hitArea: 'default',
		rounded: 'default',
		size: 'sm',
		variant: 'default',
	},
	variants: {
		hitArea: ICON_BUTTON_HIT_AREA_VARIANTS,
		rounded: BUTTON_ROUNDED_VARIANTS,
		size: {
			lg: 'size-10',
			md: 'size-9',
			sm: 'size-8',
			xs: "size-6 [&_svg:not([class*='size-'])]:size-3",
			xxs: "size-5 [&_svg:not([class*='size-'])]:size-3",
		},
		variant: BUTTON_VARIANTS,
	},
})

export type IconButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> &
	VariantProps<typeof iconButtonVariants> & {
		primaryFocus?: boolean
	}

const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
	({ className, variant, size, rounded, hitArea, primaryFocus = true, ...props }, ref) => {
		return (
			<button
				className={cn(
					iconButtonVariants({ className, hitArea, rounded, size, variant }),
					{
						'cursor-not-allowed': props.disabled,
						'focus:ring-ring': primaryFocus,
					},
					className,
				)}
				ref={ref}
				type="button"
				{...props}
			/>
		)
	},
)
IconButton.displayName = 'IconButton'

export { IconButton, iconButtonVariants }
