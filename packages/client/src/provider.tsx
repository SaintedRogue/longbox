import { QueryClientProvider } from '@tanstack/react-query'
import { PropsWithChildren } from 'react'

import { queryClient } from './client'
import { ILongboxClientContext, LongboxClientContext, QueryClientContext } from './context'

export function LongboxClientContextProvider({
	children,
	...context
}: PropsWithChildren<ILongboxClientContext>) {
	return (
		<LongboxClientContext.Provider value={context}>
			<QueryClientContext.Provider value={queryClient}>
				<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
			</QueryClientContext.Provider>
		</LongboxClientContext.Provider>
	)
}
