import { useGraphQL } from '@longbox/client'
import { graphql, MetadataProvider } from '@longbox/graphql'

const mediaMetadataQuery = graphql(`
	query MediaExternalMetadata($provider: MetadataProvider!, $externalId: String!) {
		mediaExternalMetadata(provider: $provider, externalId: $externalId) {
			title
			summary
			pageCount
			seriesName
			seriesExternalId
			number
			numberRaw
			day
			month
			year
			genres
			tags
			isbn
			isbn13
			writers
			artists
			colorists
			letterers
			coverArtists
			pencillers
			inkers
			editors
			characters
			teams
			storyArc
			imprint
			publisher
			coverUrl
			providerUrl
		}
	}
`)

const seriesMetadataQuery = graphql(`
	query SeriesExternalMetadata($provider: MetadataProvider!, $externalId: String!) {
		seriesExternalMetadata(provider: $provider, externalId: $externalId) {
			title
			summary
			status
			year
			endYear
			genres
			tags
			ageRating
			authors
			artists
			publisher
			coverUrl
			volumeCount
		}
	}
`)

/**
 * The full metadata for the candidate under review.
 *
 * Some providers' search endpoints are list views — League of Comic Geeks has no API, so
 * a search result is a card carrying a title, publisher, cover and date. The summary,
 * page count, ISBN, credits and characters exist only on the item's own page, so a grid
 * built from the search result alone shows a column of dashes.
 *
 * Fetching that page per candidate *during* the search would spend three requests to
 * display one, and on a whole-library match would add hours against the provider's rate
 * limit. So it happens here instead: once, for the candidate a person actually selected.
 *
 * `enabled` is what keeps that promise — callers pass `false` for providers whose search
 * results are already complete, so those pay nothing.
 */
export function useCandidateMetadata({
	provider,
	externalId,
	isMedia,
	enabled,
}: {
	provider?: MetadataProvider | null
	externalId?: string | null
	isMedia: boolean
	enabled: boolean
}) {
	const canQuery = enabled && !!provider && !!externalId

	const mediaResult = useGraphQL(
		mediaMetadataQuery,
		['mediaExternalMetadata', provider ?? '', externalId ?? ''],
		{ provider: provider as MetadataProvider, externalId: externalId ?? '' },
		{ enabled: canQuery && isMedia, retry: false },
	)
	const seriesResult = useGraphQL(
		seriesMetadataQuery,
		['seriesExternalMetadata', provider ?? '', externalId ?? ''],
		{ provider: provider as MetadataProvider, externalId: externalId ?? '' },
		{ enabled: canQuery && !isMedia, retry: false },
	)

	const result = isMedia ? mediaResult : seriesResult
	const metadata = isMedia
		? mediaResult.data?.mediaExternalMetadata
		: seriesResult.data?.seriesExternalMetadata

	return {
		/** `null` until it arrives, or if the fetch failed — callers fall back to the card. */
		metadata: (metadata ?? null) as Record<string, unknown> | null,
		isLoading: canQuery && result.isLoading,
		/** A failure is not fatal: the search result is still a valid match to accept. */
		didFail: !!result.error,
	}
}
