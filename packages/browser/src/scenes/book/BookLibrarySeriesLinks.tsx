import { useSDK, useSuspenseGraphQL } from '@longbox/client'
import { Badge, Link, Text } from '@longbox/components'
import { graphql } from '@longbox/graphql'

import { useBrowseReturnPath } from '@/hooks/useBrowseHistory'
import { browseSceneKey } from '@/stores/browseHistory'

import paths from '../../paths'

const seriesQuery = graphql(`
	query BookLibrarySeriesLinks($id: ID!) {
		seriesById(id: $id) {
			id
			resolvedName
			library {
				id
				name
			}
		}
	}
`)

type Props = {
	seriesId?: string
}

export default function BookLibrarySeriesLinks({ seriesId }: Props) {
	const { sdk } = useSDK()
	const {
		data: { seriesById: series },
	} = useSuspenseGraphQL(seriesQuery, sdk.cacheKey('seriesLinks', [seriesId]), {
		id: seriesId || '',
	})

	const library = series?.library

	// Resolved from the browse-history store rather than `location.state.from`, which used to
	// drive these links and could not work: it compared path prefixes, and
	// `paths.librarySeries(id)` is the bare `/libraries/x` while the referrer is
	// `/libraries/x/series?page=5`, so the two never matched and every link fell through to
	// page 1. The store also survives the multi-hop route here -- grid, book, reader, back to
	// book -- by which point `state.from` no longer names the grid at all.
	const libraryReturnPath = useBrowseReturnPath(
		browseSceneKey.library(library?.id ?? ''),
		library ? paths.librarySeries(library.id) : '',
	)
	const seriesReturnPath = useBrowseReturnPath(
		browseSceneKey.series(series?.id ?? ''),
		series ? paths.seriesOverview(series.id) : '',
	)

	return (
		<div className="gap-1.5 flex items-center">
			{library && (
				<Link to={libraryReturnPath} underline={false}>
					<Badge size="sm" rounded="full" className="cursor-pointer">
						{library.name}
					</Badge>
				</Link>
			)}
			{series && (
				<>
					<Text size="sm" variant="muted">
						/
					</Text>
					<Link to={seriesReturnPath} underline={false}>
						<Badge variant="primary" size="sm" rounded="full" className="cursor-pointer">
							{series.resolvedName}
						</Badge>
					</Link>
				</>
			)}
		</div>
	)
}
