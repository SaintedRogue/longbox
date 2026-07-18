import { useSuspenseGraphQL } from '@longbox/client'
import { Link } from '@longbox/components'
import { graphql } from '@longbox/graphql'
import { Suspense } from 'react'

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

	return (
		<Suspense>
			{library && (
				<Link to={paths.librarySeries(library?.id || '')} className="line-clamp-1">
					{library?.name}
				</Link>
			)}
		</Suspense>
	)
}
