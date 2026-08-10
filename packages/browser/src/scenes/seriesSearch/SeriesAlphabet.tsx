import { ALPHABET_STALE_TIME, useSDK, useSuspenseGraphQL } from '@longbox/client'
import { graphql } from '@longbox/graphql'
import { useQueryClient } from '@tanstack/react-query'
import { Suspense } from 'react'

import { Alphabet } from '@/components/filters'

/**
 * The cross-library counterpart to `LibrarySeriesAlphabet`, which is scoped to a
 * single library. Backed by the root `seriesAlphabet` query.
 */
const query = graphql(`
	query SeriesSearchAlphabet {
		seriesAlphabet
	}
`)

export const usePrefetchSeriesAlphabet = () => {
	const client = useQueryClient()
	const { sdk } = useSDK()

	return () =>
		client.prefetchQuery({
			queryKey: ['seriesSearchAlphabet'],
			queryFn: async () => {
				const response = await sdk.execute(query)
				return response
			},
			staleTime: ALPHABET_STALE_TIME,
		})
}

type Props = Omit<React.ComponentProps<typeof Alphabet>, 'alphabet'>

function SeriesAlphabet(props: Props) {
	const {
		data: { seriesAlphabet },
	} = useSuspenseGraphQL(query, ['seriesSearchAlphabet'], undefined, {
		staleTime: ALPHABET_STALE_TIME,
	})

	return <Alphabet alphabet={seriesAlphabet} {...props} />
}

export default function SeriesAlphabetContainer(props: Props) {
	return (
		<Suspense fallback={null}>
			<SeriesAlphabet {...props} />
		</Suspense>
	)
}
