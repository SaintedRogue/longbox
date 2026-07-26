import { useSuspenseGraphQL } from '@longbox/client'
import { Link } from '@longbox/components'
import { graphql } from '@longbox/graphql'
import { Suspense } from 'react'

import { useBrowseReturnPath } from '@/hooks/useBrowseHistory'
import { browseSceneKey } from '@/stores/browseHistory'

import paths from '../../paths'
const query = graphql(`
	query SeriesLibrayLink($id: ID!) {
		libraryById(id: $id) {
			id
			name
		}
	}
`)

type Props = {
	id: string
}
export default function SeriesLibraryLink({ id }: Props) {
	const {
		data: { libraryById: library },
	} = useSuspenseGraphQL(query, ['libraryOverview', id], {
		id: id || '',
	})

	// Going "up" to the library returns to the list you were browsing, not to its first page.
	const returnPath = useBrowseReturnPath(
		browseSceneKey.library(library?.id ?? ''),
		paths.librarySeries(library?.id || ''),
	)

	return (
		<Suspense>
			{library && (
				<Link to={returnPath} className="line-clamp-1">
					{library?.name}
				</Link>
			)}
		</Suspense>
	)
}
