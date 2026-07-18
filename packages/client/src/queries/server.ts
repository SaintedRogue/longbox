import { useQuery, useSuspenseQuery } from '@tanstack/react-query'

import { useSDK } from '../sdk'

export function useLongboxVersion() {
	const { sdk } = useSDK()
	const { data: version } = useQuery({
		queryKey: [sdk.server.keys.version],
		queryFn: () => sdk.server.version(),
	})

	return version
}

export function useOidcConfig() {
	const { sdk } = useSDK()
	const { data } = useSuspenseQuery({
		queryKey: [sdk.auth.keys.getOidcConfig],
		queryFn: () => sdk.auth.getOidcConfig(),
	})
	return data
}
