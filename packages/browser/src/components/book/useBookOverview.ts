import { PREFETCH_STALE_TIME, useSDK, useSuspenseGraphQL } from '@longbox/client'
import { graphql } from '@longbox/graphql'
import { useQueryClient } from '@tanstack/react-query'

const query = graphql(`
	query BookOverviewScene($id: ID!) {
		mediaById(id: $id) {
			id
			...BookCard
			...BookFileInformation
			resolvedName
			extension
			seriesId
			pages
			size
			metadata {
				links
				summary
				ageRating
				genres
				language
				publisher
				writers
				year
				...MediaMetadataEditor
			}
			tags {
				id
				name
			}
			readHistory {
				completedAt
			}
		}
	}
`)

export const usePrefetchBook = () => {
	const { sdk } = useSDK()
	const client = useQueryClient()
	return (id: string) =>
		client.prefetchQuery({
			queryKey: sdk.cacheKey('bookOverview', [id]),
			queryFn: async () => {
				const response = await sdk.execute(query, { id })
				return response
			},
			staleTime: PREFETCH_STALE_TIME,
		})
}

export const useBookOverview = (id: string) => {
	const { sdk } = useSDK()
	return useSuspenseGraphQL(query, sdk.cacheKey('bookOverview', [id]), {
		id,
	})
}
