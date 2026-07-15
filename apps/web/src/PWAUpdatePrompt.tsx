import { useEffect } from 'react'
import { toast } from 'sonner'
import { useRegisterSW } from 'virtual:pwa-register/react'

export default function PWAUpdatePrompt() {
	const {
		needRefresh: [needRefresh],
		updateServiceWorker,
	} = useRegisterSW()

	useEffect(() => {
		if (!needRefresh) return

		toast('A new version of Longbox is available', {
			id: 'pwa-update',
			duration: Infinity,
			action: {
				label: 'Reload',
				onClick: () => updateServiceWorker(true),
			},
		})
	}, [needRefresh, updateServiceWorker])

	return null
}
