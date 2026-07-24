import { Badge, Link, Text } from '@longbox/components'
import { FragmentType, graphql, useFragment } from '@longbox/graphql'
import pluralize from 'pluralize'
import { memo } from 'react'

import { usePaths } from '@/paths'

export const CharacterCardFragment = graphql(`
	fragment CharacterCard on Character {
		name
		bookCount
	}
`)

type Props = {
	fragment: FragmentType<typeof CharacterCardFragment>
}

const CharacterCard = memo(function CharacterCard({ fragment }: Props) {
	const data = useFragment(CharacterCardFragment, fragment)
	const paths = usePaths()

	return (
		<Link
			to={paths.character(data.name)}
			className="group gap-1 p-3 relative flex w-full flex-col items-start rounded-lg border border-transparent transition-colors hover:border-border hover:bg-muted/30"
			underline={false}
		>
			<Text size="sm" className="font-medium line-clamp-2 w-full">
				{data.name}
			</Text>
			{data.bookCount != null && (
				<Badge size="sm" variant="secondary">
					{data.bookCount} {pluralize('book', data.bookCount)}
				</Badge>
			)}
		</Link>
	)
})

export default CharacterCard
