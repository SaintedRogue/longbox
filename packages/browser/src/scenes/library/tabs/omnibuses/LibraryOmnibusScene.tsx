import LibraryBooksScene from '../books/LibraryBooksScene'

/**
 * The library's omnibuses, as books.
 *
 * This is the Books tab with one filter applied, and that is the whole design. An earlier
 * version grouped volumes into sets behind a card you clicked to expand — which put a click
 * between you and the book you were looking at, for the sake of a volume count nobody
 * needed. A card is a book, and one click opens it.
 *
 * Reusing the books scene rather than rebuilding a grid means sorting, the table view, the
 * grid size slider, the alphabet strip and pagination all work here for free, and keep
 * working as that scene improves.
 */
export default function LibraryOmnibusScene() {
	return (
		<LibraryBooksScene
			variant="omnibuses"
			presetFilter={{ isOmnibus: true }}
			emptyState={{
				title: "It doesn't look like there are any omnibuses here",
				subtitle:
					'A book lands on this shelf when its name, its title, its format, or its series says omnibus.',
			}}
		/>
	)
}
