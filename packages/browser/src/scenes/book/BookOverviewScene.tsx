import { useEffect } from 'react'
import { Helmet } from 'react-helmet'
import { useParams } from 'react-router'

import { useBookOverview } from '@/components/book'
import { SceneContainer } from '@/components/container'

import BookOverviewContent from './BookOverviewContent'

export default function BookOverviewScene() {
	const { id } = useParams()
	const {
		data: { mediaById: media },
	} = useBookOverview(id || '')

	if (!media) {
		throw new Error('Book not found')
	}

	useEffect(() => {
		const el =
			document.querySelector('[data-artificial-scroll="true"]') || document.getElementById('main')
		el?.scrollTo({ top: 0, behavior: 'smooth' })
	}, [id])

	return (
		<SceneContainer className="gap-4">
			<Helmet>
				<title>Longbox | {media.resolvedName}</title>
			</Helmet>

			<BookOverviewContent id={id || ''} variant="page" />
		</SceneContainer>
	)
}
