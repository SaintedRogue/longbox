import { ButtonOrLink } from '@longbox/components'
import { useLocaleContext } from '@longbox/i18n'
import { useParams } from 'react-router'

import Container from '@/components/container/Container'
import GenericEmptyState from '@/components/GenericEmptyState'
import { ImageBasedReader } from '@/components/readers/imageBased'
import NativePDFViewer from '@/components/readers/pdf/NativePDFViewer'
import { useDownloadStore } from '@/offline/downloadStore'
import paths from '@/paths'
import { useReaderStore } from '@/stores'

import { synthesizeReaderBook } from './synthesizeReaderBook'

const LOCALE_BASE_KEY = 'downloadsScene'
const withLocaleKey = (key: string) => `${LOCALE_BASE_KEY}.${key}`

/**
 * The offline-aware reader entry point, `/downloads/:id/read` (see DownloadsRouter.tsx). Unlike the
 * normal `/books/:id/reader` route (BookReaderScene), this route never runs a `mediaById` GraphQL
 * query -- it reads the book straight out of the local, durable download catalog
 * (`useDownloadStore`'s `records` map, hydrated from IndexedDB at startup, see
 * offline/useDownloads.ts) and, for comics, synthesizes the object the existing image-based reader
 * expects (`synthesizeReaderBook`). This is what keeps a downloaded book readable with the server
 * fully stopped. The route works online too -- `/downloads` always links here (DownloadsScene).
 *
 * Format dispatch mirrors BookReaderScene's extension-based reader-kind decision, but keyed off the
 * DownloadRecord's `format` (derived at download time by `deriveDownloadFormat`, see
 * offline/downloadFormat.ts) instead of `book.extension`:
 * - comic (cbz/cbr) -> `<ImageBasedReader/>` with a synthesized book. The user's persisted reading
 *   settings (`useReaderStore(s => s.settings)`, available offline since the store is localStorage-
 *   persisted) are mapped into `synthesizeReaderBook`'s `prefs` so the offline reader renders in the
 *   user's preferred mode -- paged included -- rather than always forcing continuous scrolling.
 *   Page turns stay on this offline route: `ImageBasedReader` holds the current page in its own
 *   state and never navigates.
 * - pdf -> `<NativePDFViewer/>`, which only needs `{ id }` and already resolves offline (5.3).
 * - epub -> deferred per stream5-interfaces.md S3: `EpubJsReader` needs the server-parsed
 *   `epubById` (spine/toc/resources), which cannot be synthesized from a `DownloadRecord`. Shown as
 *   an "unavailable offline" message instead of crashing.
 *
 * Progress writes from `ImageBasedReader` already fall through to the Stream 1 outbox (see
 * BookReaderScene/progressOutbox) when the underlying mutation fails -- this scene does not wire an
 * `onProgress` handler, so no progress-mutation attempt is made from an offline read at all.
 */
export default function OfflineBookReaderScene() {
	const { id } = useParams()
	const record = useDownloadStore((state) => (id ? state.records[id] : undefined))
	const settings = useReaderStore((state) => state.settings)

	if (!record) {
		return <NotDownloaded />
	}

	if (record.format === 'cbz' || record.format === 'cbr') {
		const media = synthesizeReaderBook(record, {
			readingMode: settings.readingMode,
			imageScaleFit: settings.imageScaling.scaleToFit,
			readingDir: settings.readingDirection,
		})

		return <ImageBasedReader media={media} />
	}

	if (record.format === 'pdf') {
		return <NativePDFViewer id={record.bookId} />
	}

	return <EpubUnavailable />
}

function NotDownloaded() {
	const { t } = useLocaleContext()

	return (
		<Container className="gap-4 flex h-full flex-col items-center justify-center">
			<GenericEmptyState title={t(withLocaleKey('notDownloaded'))} />
			<ButtonOrLink href={paths.downloads()} variant="outline">
				{t('common.goBack')}
			</ButtonOrLink>
		</Container>
	)
}

function EpubUnavailable() {
	const { t } = useLocaleContext()

	return (
		<Container className="gap-4 flex h-full flex-col items-center justify-center">
			<GenericEmptyState title={t(withLocaleKey('epubUnavailableOffline'))} />
			<ButtonOrLink href={paths.downloads()} variant="outline">
				{t('common.goBack')}
			</ButtonOrLink>
		</Container>
	)
}
