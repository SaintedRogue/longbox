import { useGraphQLMutation } from '@longbox/client'
import { extractErrorMessage, graphql } from '@longbox/graphql'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

const followSeriesMutation = graphql(`
	mutation UseFollowSeries($id: ID!, $isFollowing: Boolean!) {
		followSeries(id: $id, isFollowing: $isFollowing)
	}
`)

/**
 * Every query a follow changes. Kept in one place because a follow is read in four
 * different shapes — the id list, both calendar views, and the updates feed — and a caller
 * that forgets one leaves the user looking at a stale answer to the thing they just did.
 */
const AFFECTED_QUERY_KEYS = [
	'followedSeriesIds',
	'releaseCalendar',
	'upcomingReleases',
	'updatesFeed',
]

/**
 * Follow or unfollow a series — Longbox's subscription primitive.
 *
 * Shared rather than reimplemented per call site: what a follow *means* is "put this on my
 * pull list", and the set of things that have to be refreshed as a result is a property of
 * that meaning, not of whichever screen happened to trigger it.
 */
export function useFollowSeries() {
	const client = useQueryClient()

	const { mutate, isPending } = useGraphQLMutation(followSeriesMutation, {
		onSuccess: () => {
			for (const key of AFFECTED_QUERY_KEYS) {
				client.invalidateQueries({ queryKey: [key], exact: false })
			}
		},
		onError: (error) => {
			console.error(error)
			toast.error('Could not update your pull list', {
				description: extractErrorMessage(error),
			})
		},
	})

	return {
		setFollowing: (id: string, isFollowing: boolean) => mutate({ id, isFollowing }),
		isPending,
	}
}
