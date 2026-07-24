import { useSuspenseGraphQL } from '@longbox/client'
import { Badge, Heading } from '@longbox/components'
import { graphql } from '@longbox/graphql'
import pluralize from 'pluralize'
import { useEffect } from 'react'
import { Helmet } from 'react-helmet'
import { useNavigate, useParams } from 'react-router'

import BookCard from '@/components/book/BookCard'
import { DynamicCardGrid } from '@/components/container'
import GenericEmptyState from '@/components/GenericEmptyState'

const query = graphql(`
	query CharacterDetailScene($name: String!) {
		characterByName(name: $name) {
			name
			bookCount
			books {
				id
				...BookCard
				...BookMetadata
			}
		}
	}
`)

export default function CharacterDetailScene() {
	const navigate = useNavigate()
	const { name: rawName } = useParams<{ name: string }>()
	const name = decodeURIComponent(rawName || '')

	const {
		data: { characterByName: character },
	} = useSuspenseGraphQL(query, ['characterByName', name], { name })

	useEffect(() => {
		if (!character) {
			navigate('/404')
		}
	}, [character, navigate])

	if (!character) return null

	const books = character.books

	return (
		<div className="pb-4 md:pb-0 flex flex-1 flex-col">
			<Helmet>
				<title>Longbox | {character.name}</title>
			</Helmet>

			<div className="gap-2 p-4 flex flex-wrap items-center">
				<Heading size="lg">{character.name}</Heading>
				{character.bookCount != null && (
					<Badge variant="secondary" rounded="full">
						{character.bookCount} {pluralize('book', character.bookCount)}
					</Badge>
				)}
			</div>

			<div className="px-4 flex flex-1">
				{!!books.length && (
					<DynamicCardGrid
						count={books.length}
						renderItem={(index) => <BookCard key={books[index]!.id} fragment={books[index]!} />}
					/>
				)}
				{!books.length && (
					<div className="col-span-full grid flex-1 place-self-center">
						<GenericEmptyState
							title="No books found"
							subtitle={`No books tagged with "${character.name}" were found`}
						/>
					</div>
				)}
			</div>
		</div>
	)
}
