import { useGraphQL, useSDK } from '@longbox/client'
import { ButtonOrLink, Heading, ScrollArea, Text } from '@longbox/components'
import { graphql, SmartListsInput } from '@longbox/graphql'
import { useLocaleContext } from '@longbox/i18n'
import pluralize from 'pluralize'

import { SceneContainer } from '@/components/container'
import { Search } from '@/components/filters'
import { useURLKeywordSearch } from '@/components/filters/useFilterScene'
import GenericEmptyState from '@/components/GenericEmptyState'
import paths from '@/paths'

import SmartListCard from './SmartListCard'

// TODO(cleanup): this scene lowkey ugly

const LOCALE_BASE_KEY = `userSmartListsScene`
const withLocaleKey = (key: string) => `${LOCALE_BASE_KEY}.${key}`

const query = graphql(`
	query SmartListsWithSearch($input: SmartListsInput!) {
		smartLists(input: $input) {
			id
			creatorId
			description
			defaultGrouping
			filters
			joiner
			name
			visibility
			...SmartListCard
		}
	}
`)

export default function UserSmartListsScene() {
	const { t } = useLocaleContext()
	// The URL is the source of truth, matching every other browse surface, so a
	// filtered list is shareable and survives a back-navigation. `Search` owns
	// the debounce.
	const { search, setSearch } = useURLKeywordSearch()

	const { sdk } = useSDK()
	const {
		data: { smartLists: lists } = {},
		isLoading,
		isRefetching,
	} = useGraphQL(query, [sdk.cacheKeys.smartLists, search], {
		input: {
			search: search || undefined,
		} as SmartListsInput,
	})

	if (isLoading) {
		return null
	}

	const smartLists = lists ?? []

	const renderLists = () => {
		if (!smartLists.length) {
			return (
				<GenericEmptyState
					containerClassName="justify-start items-start pt-0 pl-1"
					contentClassName="text-left"
					title={t(withLocaleKey('list.emptyState.heading'))}
					subtitle={
						search
							? t(withLocaleKey('list.emptyState.noMatchesMessage'))
							: t(withLocaleKey('list.emptyState.noListsMessage'))
					}
				/>
			)
		}

		// TODO: prolly don't scrollarea on mobile... just scroll on the page
		return (
			<ScrollArea className="pr-3 md:w-2/3 lg:max-w-xl w-full">
				<div className="space-y-2 flex-col">
					{smartLists.map((list) => (
						<SmartListCard key={list.id} data={list} />
					))}
				</div>
			</ScrollArea>
		)
	}

	// TODO: move header to a layout for the smart list router
	// TODO: can't decide if I like the border-b
	return (
		<>
			<header className="h-32 gap-y-2 px-4 flex w-full flex-col justify-center border-b border-border">
				<div>
					<Heading size="lg" bold>
						Smart lists
					</Heading>
					<Text>Your favorite searches and filters saved for easy access</Text>
				</div>

				<Text variant="muted" size="sm">
					You have access to {smartLists.length} smart {pluralize('list', smartLists.length)}
				</Text>
			</header>

			<SceneContainer className="relative h-full overflow-hidden">
				<div className="top-0 min-h-10 py-2 backdrop-blur-sm sticky z-10 bg-background">
					<div className="gap-x-2 pr-3 md:w-2/3 lg:max-w-xl flex w-full flex-row items-center justify-between">
						<Search
							initialValue={search}
							placeholder={t(withLocaleKey('searchPlaceholder'))}
							onChange={setSearch}
							isLoading={isRefetching}
						/>

						<ButtonOrLink href={paths.smartListCreate()} variant="ghost">
							{t(withLocaleKey('buttons.createSmartList'))}
						</ButtonOrLink>
					</div>
				</div>

				{renderLists()}
			</SceneContainer>
		</>
	)
}
