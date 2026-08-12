import { useGraphQL, useSDK } from '@longbox/client'
import { Text } from '@longbox/components'
import { graphql, OmnibusSetOrderBy } from '@longbox/graphql'
import { Fragment, Suspense, useCallback, useState } from 'react'
import { Helmet } from 'react-helmet'

import { BookCard } from '@/components/book'
import { DynamicCardGrid } from '@/components/container'
import { useURLPageParams } from '@/components/filters/useFilterScene'
import GenericEmptyState from '@/components/GenericEmptyState'
import Pagination from '@/components/Pagination'

import { useLibraryContext } from '../../context'
import OmnibusCard from './OmnibusCard'

const query = graphql(`
	query LibraryOmnibusScene(
		$libraryId: ID!
		$orderBy: OmnibusSetOrderBy!
		$pagination: Pagination!
	) {
		omnibusSets(libraryId: $libraryId, orderBy: $orderBy, pagination: $pagination) {
			nodes {
				key
				title
				volumeCount
				truncated
				volumes {
					id
					thumbnail {
						url
						metadata {
							averageColor
							colors {
								color
								percentage
							}
							thumbhash
						}
					}
					...BookCard
				}
			}
			pageInfo {
				__typename
				... on OffsetPaginationInfo {
					currentPage
					totalPages
				}
			}
		}
	}
`)

export default function LibraryOmnibusSceneContainer() {
	return (
		<Suspense fallback={null}>
			<LibraryOmnibusScene />
		</Suspense>
	)
}

/**
 * A shelf of the library's omnibus sets.
 *
 * This exists because neither of the other tabs can show you your omnibuses. The Series tab
 * shows each set as a folder you have to click into, and the Books tab mixes omnibus volumes
 * in with every individual issue. Here a set is one card, and its volumes open underneath it.
 *
 * Sets arrive already grouped and already paginated from the server, which is what keeps the
 * volume counts truthful — see `omnibusSets`. Nothing on this page regroups anything.
 */
function LibraryOmnibusScene() {
	const { library } = useLibraryContext()
	const { sdk } = useSDK()
	const { page, pageSize, setPage } = useURLPageParams()

	// Which sets are open. A `Set` in state rather than a ref: the react compiler is enabled
	// here and a ref mutated during render is exactly the pattern it rejects.
	const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())

	const toggle = useCallback((key: string) => {
		setExpanded((current) => {
			const next = new Set(current)
			if (!next.delete(key)) {
				next.add(key)
			}
			return next
		})
	}, [])

	const { data, isLoading } = useGraphQL(
		query,
		sdk.cacheKey('omnibusSets', [library.id, page, pageSize]),
		{
			libraryId: library.id,
			orderBy: OmnibusSetOrderBy.Title,
			pagination: { offset: { page, pageSize } },
		},
	)

	const sets = data?.omnibusSets.nodes ?? []
	const pageInfo = data?.omnibusSets.pageInfo
	const totalPages = pageInfo?.__typename === 'OffsetPaginationInfo' ? pageInfo.totalPages : 1
	const currentPage = pageInfo?.__typename === 'OffsetPaginationInfo' ? pageInfo.currentPage : page

	if (!sets.length && !isLoading) {
		return (
			<div className="px-4 pt-4 flex flex-1">
				<div className="col-span-full grid flex-1 place-self-center">
					<GenericEmptyState
						title="No omnibuses here"
						subtitle="A book lands on this shelf when its name, its title, its format, or its series says omnibus."
					/>
				</div>
			</div>
		)
	}

	return (
		<div className="gap-2 px-4 pt-4 flex flex-1 flex-col">
			<Helmet>
				<title>Longbox | {library.name} omnibuses</title>
			</Helmet>

			{sets.some((set) => set.truncated) && (
				<Text size="sm" className="text-warning">
					This library has more omnibuses than the shelf can group at once, so what follows is only
					part of it.
				</Text>
			)}

			<DynamicCardGrid
				count={sets.length}
				renderItem={(index) => {
					const set = sets[index]
					if (!set) return null

					const isExpanded = expanded.has(set.key)

					return (
						// The panel is a sibling grid item spanning every column, so it opens on the
						// row below its own card and pushes the rest of the shelf down -- rather than
						// appearing at the bottom of the page, detached from what was clicked.
						<Fragment key={set.key}>
							<OmnibusCard set={set} isExpanded={isExpanded} onToggle={() => toggle(set.key)} />
							{isExpanded && (
								<div className="gap-2 mb-2 p-3 bg-background-surface col-span-full flex flex-wrap rounded-lg">
									{set.volumes.map((volume) => (
										<BookCard key={volume.id} fragment={volume} />
									))}
								</div>
							)}
						</Fragment>
					)
				}}
			/>

			{totalPages > 1 && (
				<Pagination pages={totalPages} currentPage={currentPage} onChangePage={setPage} />
			)}
		</div>
	)
}
