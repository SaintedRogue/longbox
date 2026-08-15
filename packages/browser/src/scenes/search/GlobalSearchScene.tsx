import { useGraphQL } from '@longbox/client'
import { Heading, Text } from '@longbox/components'
import { graphql } from '@longbox/graphql'
import { Helmet } from 'react-helmet'
import { useDebouncedValue } from 'rooks'

import { BookCard } from '@/components/book'
import { DynamicCardGrid } from '@/components/container'
import { Search } from '@/components/filters'
import { useURLKeywordSearch } from '@/components/filters/useFilterScene'
import GenericEmptyState from '@/components/GenericEmptyState'
import LibraryCard from '@/components/library/LibraryCard'
import { LibrarySeriesCard } from '@/components/series'
import { Link } from '@/context'
import { usePaths } from '@/paths'
import CharacterCard from '@/scenes/character/CharacterCard'

/**
 * One request with all five groups rather than five hooks.
 *
 * The trade-off is coarse loading -- every group reveals together instead of
 * streaming in as each resolver finishes. For a capped preview that is normally
 * fast, one skeleton beats five independent spinners.
 */
const query = graphql(`
	query GlobalSearch($query: String!, $limitPerType: Int!) {
		searchAll(query: $query, limitPerType: $limitPerType) {
			media {
				totalCount
				nodes {
					id
					...BookCard
				}
			}
			series {
				totalCount
				nodes {
					id
					resolvedName
					...SeriesGridCard
				}
			}
			libraries {
				totalCount
				nodes {
					id
					...LibraryCard
				}
			}
			characters {
				totalCount
				nodes {
					name
					...CharacterCard
				}
			}
			authors {
				totalCount
				nodes {
					name
				}
			}
		}
	}
`)

const LIMIT_PER_TYPE = 6

type GroupProps = {
	title: string
	totalCount: number
	shownCount: number
	/**
	 * Where "show all" goes. Expanding a group is a navigation to that type's own
	 * browse route with the same term, not pagination here -- which is what keeps
	 * expanding one group from refetching the other four.
	 */
	href?: string
	children: React.ReactNode
}

function SearchGroup({ title, totalCount, shownCount, href, children }: GroupProps) {
	const remaining = totalCount - shownCount

	return (
		<section className="pb-6">
			<div className="gap-x-3 pb-2 flex items-baseline justify-between">
				<Heading size="sm">
					{title} <Text variant="muted">({totalCount})</Text>
				</Heading>

				{href && remaining > 0 && (
					<Link to={href} className="text-sm text-muted-foreground hover:text-foreground">
						Show all {totalCount}
					</Link>
				)}
			</div>

			{children}
		</section>
	)
}

export default function GlobalSearchScene() {
	const paths = usePaths()
	const { search, setSearch } = useURLKeywordSearch()
	// The URL updates as you type (Search is already debounced), but debouncing
	// again here keeps a paste-then-edit from firing a request per keystroke.
	const [debouncedSearch] = useDebouncedValue(search, 300)

	const { data, isLoading } = useGraphQL(
		query,
		['globalSearch', debouncedSearch],
		{
			query: debouncedSearch,
			limitPerType: LIMIT_PER_TYPE,
		},
		{
			enabled: !!debouncedSearch,
		},
	)

	const results = data?.searchAll
	const withTerm = (path: string) => `${path}?search=${encodeURIComponent(debouncedSearch)}`

	const hasAnyResult =
		!!results &&
		[results.media, results.series, results.libraries, results.characters, results.authors].some(
			(group) => group.nodes.length > 0,
		)

	const renderResults = () => {
		if (!debouncedSearch) {
			return (
				<GenericEmptyState
					title="Search everything"
					subtitle="Find books, series, libraries, characters and authors in one place"
				/>
			)
		}

		if (isLoading || !results) {
			return null
		}

		if (!hasAnyResult) {
			return (
				<GenericEmptyState
					title={`No results for "${debouncedSearch}"`}
					subtitle="Try a different term, or check whether the library has been scanned"
				/>
			)
		}

		return (
			<>
				{/* Groups with no hits render nothing at all rather than five empty boxes. */}
				{results.media.nodes.length > 0 && (
					<SearchGroup
						title="Books"
						totalCount={results.media.totalCount}
						shownCount={results.media.nodes.length}
						href={withTerm(paths.bookSearch())}
					>
						<DynamicCardGrid
							count={results.media.nodes.length}
							renderItem={(index) => (
								<BookCard
									key={results.media.nodes[index]!.id}
									fragment={results.media.nodes[index]!}
								/>
							)}
						/>
					</SearchGroup>
				)}

				{results.series.nodes.length > 0 && (
					<SearchGroup
						title="Series"
						totalCount={results.series.totalCount}
						shownCount={results.series.nodes.length}
						href={withTerm(paths.series())}
					>
						<DynamicCardGrid
							count={results.series.nodes.length}
							renderItem={(index) => (
								<LibrarySeriesCard
									key={results.series.nodes[index]!.id}
									fragment={results.series.nodes[index]!}
								/>
							)}
						/>
					</SearchGroup>
				)}

				{results.libraries.nodes.length > 0 && (
					<SearchGroup
						title="Libraries"
						totalCount={results.libraries.totalCount}
						shownCount={results.libraries.nodes.length}
						href={withTerm(paths.libraries())}
					>
						<DynamicCardGrid
							count={results.libraries.nodes.length}
							renderItem={(index) => (
								<LibraryCard
									key={results.libraries.nodes[index]!.id}
									fragment={results.libraries.nodes[index]!}
								/>
							)}
						/>
					</SearchGroup>
				)}

				{results.characters.nodes.length > 0 && (
					<SearchGroup
						title="Characters"
						totalCount={results.characters.totalCount}
						shownCount={results.characters.nodes.length}
						href={withTerm(paths.characters())}
					>
						<DynamicCardGrid
							count={results.characters.nodes.length}
							renderItem={(index) => (
								<CharacterCard
									key={results.characters.nodes[index]!.name}
									fragment={results.characters.nodes[index]!}
								/>
							)}
						/>
					</SearchGroup>
				)}

				{/* Authors have no browse route of their own yet, so this group is
				    preview-only -- no "show all" link to offer. */}
				{results.authors.nodes.length > 0 && (
					<SearchGroup
						title="Authors"
						totalCount={results.authors.totalCount}
						shownCount={results.authors.nodes.length}
					>
						<div className="gap-2 flex flex-wrap">
							{results.authors.nodes.map((author) => (
								<span
									key={author.name}
									className="px-3 py-1 text-sm rounded-md bg-muted text-muted-foreground"
								>
									{author.name}
								</span>
							))}
						</div>
					</SearchGroup>
				)}
			</>
		)
	}

	return (
		<div className="pb-4 md:pb-0 flex flex-1 flex-col">
			<Helmet>
				<title>Longbox | Search</title>
			</Helmet>

			<div className="gap-4 p-4 flex items-center justify-between">
				<Search
					initialValue={search}
					placeholder="Search everything"
					onChange={setSearch}
					isLoading={isLoading}
				/>
			</div>

			<div className="px-4 flex flex-1 flex-col">{renderResults()}</div>
		</div>
	)
}
