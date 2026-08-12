import { useGraphQL } from '@longbox/client'
import { graphql } from '@longbox/graphql'

/**
 * One provider's answers for an entity.
 *
 * `payload` keys match the `candidateKey` on a field definition — the server translates
 * the stored snake_case into the camelCase the rest of the API uses, so a field is read
 * the same way whether it came from a live candidate or from the pool.
 */
export type EnrichmentSource = {
	provider: string
	externalId?: string | null
	providerUrl?: string | null
	state: string
	chosenBy?: string | null
	confidence?: number | null
	payload?: Record<string, unknown> | null
}

export type FieldProvenance = {
	field: string
	sourceProvider: string
	chosenBy: string
}

const mediaPoolQuery = graphql(`
	query MediaEnrichmentPool($id: ID!) {
		mediaEnrichmentPool(id: $id) {
			sources {
				provider
				externalId
				providerUrl
				state
				chosenBy
				confidence
				payload
			}
			fieldSources {
				field
				sourceProvider
				chosenBy
			}
		}
	}
`)

const seriesPoolQuery = graphql(`
	query SeriesEnrichmentPool($id: ID!) {
		seriesEnrichmentPool(id: $id) {
			sources {
				provider
				externalId
				providerUrl
				state
				chosenBy
				confidence
			}
			fieldSources {
				field
				sourceProvider
				chosenBy
			}
		}
	}
`)

/**
 * Every source that has answered for an entity, plus where each stored field came from.
 *
 * Not suspense-based: the review dialog is useful without it, so a slow or failed pool
 * query degrades to "no other sources offered" rather than blocking the review.
 */
export function useEnrichmentPool({
	id,
	isMedia,
	enabled = true,
}: {
	id?: string
	isMedia: boolean
	enabled?: boolean
}) {
	const mediaResult = useGraphQL(
		mediaPoolQuery,
		['mediaEnrichmentPool', id ?? ''],
		{ id: id ?? '' },
		{ enabled: enabled && isMedia && !!id },
	)
	const seriesResult = useGraphQL(
		seriesPoolQuery,
		['seriesEnrichmentPool', id ?? ''],
		{ id: id ?? '' },
		{ enabled: enabled && !isMedia && !!id },
	)

	const pool = isMedia
		? mediaResult.data?.mediaEnrichmentPool
		: seriesResult.data?.seriesEnrichmentPool

	return {
		sources: (pool?.sources ?? []) as EnrichmentSource[],
		fieldSources: (pool?.fieldSources ?? []) as FieldProvenance[],
		isLoading: isMedia ? mediaResult.isLoading : seriesResult.isLoading,
	}
}
