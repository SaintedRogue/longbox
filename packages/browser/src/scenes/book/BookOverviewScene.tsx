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

	// Declared before the `throw` below so the hook list is unconditional -- an early return
	// above a hook is a Rules of React violation the compiler cannot see through.
	useEffect(() => {
		const el =
			document.querySelector('[data-artificial-scroll="true"]') || document.getElementById('main')
		el?.scrollTo({ top: 0, behavior: 'smooth' })
	}, [id])

	if (!media) {
		throw new Error('Book not found')
	}

	return (
		<SceneContainer className="gap-4">
			<Helmet>
				<title>Longbox | {media.resolvedName}</title>
			</Helmet>

			{/*
			 * Keyed by book id so a book-to-book navigation mounts a *fresh* subtree. Every book
			 * matches the same `/books/:id` route, so without this React reconciles one long-lived
			 * instance and any mount-only state carries over -- the metadata table keeps rendering
			 * the book you came from, and the hero cover keeps the previous book's load state. This
			 * mirrors the same fix already applied to the reader (see BookReaderScene.tsx).
			 */}
			<BookOverviewContent key={media.id} id={media.id} />
		</SceneContainer>
	)
}
