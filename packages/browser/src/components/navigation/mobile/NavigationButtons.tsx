import { IconButton, ToolTip } from '@longbox/components'
import { useLocaleContext } from '@longbox/i18n'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useCallback } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { useNavigate } from 'react-router-dom'

export default function NavigationButtons() {
	const navigate = useNavigate()
	const { t } = useLocaleContext()

	const navigateForward = useCallback(() => {
		navigate(1)
	}, [navigate])

	const navigateBackward = useCallback(() => {
		navigate(-1)
	}, [navigate])

	// FIXME: this is pretty buggy, but it works for now.
	// TODO: platform specific keybinds
	useHotkeys('ctrl+], cmd+],ctrl+[, cmd+[', (e) => {
		e.preventDefault()
		if (e.key === ']') {
			navigateForward()
		} else if (e.key === '[') {
			navigateBackward()
		}
	})

	return (
		<div className="m-0 gap-1 md:flex hidden items-center">
			<ToolTip content={t('sidebar.buttons.goBack')} size="xs">
				<IconButton
					variant="ghost"
					size="sm"
					onClick={navigateBackward}
					aria-label={t('sidebar.buttons.goBack')}
				>
					<ChevronLeft size="0.75rem" />
				</IconButton>
			</ToolTip>

			<ToolTip content={t('sidebar.buttons.goForward')} size="xs">
				<IconButton
					variant="ghost"
					size="sm"
					onClick={navigateForward}
					aria-label={t('sidebar.buttons.goForward')}
				>
					<ChevronRight size="0.75rem" />
				</IconButton>
			</ToolTip>
		</div>
	)
}
