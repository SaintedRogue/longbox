# Omnibus shelf

A fourth tab beside Books, Series and Files that lists a library's omnibus sets:
one card per set, badged with its volume count, volumes expanding in place.

## Why

The library this is built for is 241 series, 210 of them omnibuses, and it is
flat on disk. Browsing omnibuses today means either the Series tab — where every
set is a folder you must click into — or the Books tab, where omnibus volumes are
mixed in with every individual issue. Neither shows you the omnibuses together.

## What counts as an omnibus

A book qualifies when **any** of the following says "omnibus", case-insensitively:

| Signal                  | Why it is in the rule                                                |
| ----------------------- | -------------------------------------------------------------------- |
| `media.name`            | Catches a file named for the omnibus regardless of its folder.       |
| `media_metadata.title`  | Catches a corrected title when the filename is unhelpful.            |
| `media_metadata.format` | The ComicInfo `Format` field — the correct home for this, long term. |
| `series.name`           | Catches volumes named `v01.cbz` inside a `Wolverine Omnibus` folder. |

Including the series name is what gives full coverage of a flat library, and it
does not cost correctness in the mixed case: a series named plain `Batman`
holding 100 issues plus one `Batman Omnibus Vol 1` yields a card badged `×1`,
because only that one book's own name matches.

`format` is included even though nothing populates it yet. It already exists as a
column, it is the principled signal, and setting it by hand in the metadata
editor is the escape hatch for a book the name rule misses.

## Architecture

Grouping happens **in the resolver**, and pagination is applied to the resulting
groups rather than to books. This is the decision the whole design rests on: if
books were paginated instead, a page boundary would split a five-volume set
across two pages, the volume badge would count only the volumes on the current
page, and the same set would appear as two cards.

### `core/src/omnibus.rs`

The rule lives in `core`, not in the GraphQL crate, so that a future scan-time
detector — the scan jobs are also in `core` — can reuse it without a move. The
module is small and almost entirely pure functions, which is also what makes it
testable without a database:

```rust
matches_omnibus_name(&str) -> bool
qualifying_condition(omnibus_series: &[String]) -> Condition
set_key(&ModelWithMetadata) -> SetKey        // Series(id) | Title(normalized)
normalize_set_title(&str) -> String          // strip extension + volume tokens
group_sets(Vec<ModelWithMetadata>, &HashMap<String, String>) -> Vec<OmnibusSetData>
```

`normalize_set_title` exists for loose files with no series row: it strips the
extension and trailing volume tokens (`v01`, `Vol. 1`, `#1`, `(2020)`) and
collapses whitespace, so `Wolverine Omnibus v01.cbz` and `Wolverine Omnibus
v02.cbz` land in one set.

### Query surface

```graphql
omnibusSets(
  libraryId: ID                  # omitted = every library the caller can see
  search: String
  orderBy: [OmnibusSetOrderBy!]  # TITLE | RECENTLY_ADDED
  pagination: Pagination
): PaginatedOmnibusSetResponse

type OmnibusSet {
  key: String!         # "series:<id>" or "title:<normalized>"
  title: String!
  seriesId: ID
  volumeCount: Int!
  volumes: [Media!]!   # inline, in natural order
  truncated: Boolean!
}
```

Volumes ride along inline rather than behind a second query. A set holds a
handful of books, so a page of 20 sets is on the order of 100 rows — and it makes
expanding a card pure client state, with no second request and no loading state.

Reusing the existing `Media` object means volumes carry covers, reading progress
and links already, and `BookCard` renders them unmodified.

`title` is the series name **verbatim**, noise and all
(`Wolverine Omnibus (Marvel, 2020-...) (01-05)`). That is what the Series tab
already displays; a cleanup heuristic would sometimes guess wrong and would make
the two tabs disagree about what a set is called.

### Resolver

1. Find in-scope series whose name matches, via a subquery — so scoping stays in
   one place.
2. Fetch qualifying books with `ModelWithMetadata::find_for_user(user)`. This is
   what confines the shelf to libraries the caller may see, and it is not
   optional.
3. Fetch the names of the distinct series that came back, for card titles.
4. Group, order, then paginate the groups. All three `Pagination` variants are
   supported; the cursor variant treats `after` as a set key and slices the
   ordered list after it.

**The bound, stated rather than hidden:** the book fetch is capped at
`MAX_QUALIFYING_BOOKS = 10_000`. At ~410 qualifying books this never engages. If
a library ever hits it, the resolver logs a warning and every returned set is
flagged `truncated: true`, so the UI can say the shelf is partial. A silent cap
would read as "this is your whole collection" when it is not.

## Frontend

| File                                        | Change                                                     |
| ------------------------------------------- | ---------------------------------------------------------- |
| `LibraryHeader.tsx`                         | Fourth tab, `to: 'omnibuses'`                              |
| `LibraryRouter.tsx`                         | One lazy route                                             |
| `tabs/omnibuses/LibraryOmnibusScene.tsx`    | `DynamicCardGrid` of cards, `GenericEmptyState` when empty |
| `tabs/omnibuses/OmnibusCard.tsx`            | Cover, `×N` badge, title; expands to `BookCard`s in place  |
| `packages/i18n/src/locales/en-{US,GB}.json` | `libraryHeader.tabs.omnibuses`                             |

Expansion state is a `useState<Set<string>>` of set keys, not a ref. The react
compiler is enabled in this repo and rejects the ref-as-state pattern; past bugs
here came from exactly that.

## Edge cases

- **Unknown `libraryId`** — an empty page, not an error. This is a browse
  surface, and a typo'd URL should look empty rather than broken.
- **A single-volume omnibus** — still gets a card, badged `×1`. It is a book that
  is genuinely in the collection, and hiding it would make the shelf undercount.
- **Soft-deleted books** — excluded; `deleted_at is null` is part of the
  condition, so a set whose every volume is deleted disappears.
- **A set with no cover-able first volume** — the card falls back to the same
  placeholder `BookCard` already uses.

## Testing

Everything valuable here is pure and needs no database:

- `matches_omnibus_name` — true positives and, importantly, non-matches.
- `normalize_set_title` — the filename shapes this library actually contains.
- `group_sets` — the three cases that matter: a five-volume series; a loose-file
  set with no series row; and the mixed `Batman`-plus-one-omnibus series, which
  must yield `×1`.
- Cursor slicing — `after` a key returns the following page, and an unknown key
  does not panic.

Plus one resolver-level test that a user without access to a library sees none of
its sets.

## Out of scope for v1

- **Excluding** a book the name rule wrongly caught. Including one already works
  by setting `format` in the metadata editor; excluding needs a new flag, which
  is worth adding once a real false positive turns up.
- A cross-library shelf UI. The `libraryId` argument is already optional, but no
  screen omits it.
- Provider-populated `format`. That would mean widening `ExternalMediaMetadata`,
  which the metadata-provider brief explicitly ruled out; it needs raising on its
  own terms.
- Promoting detection into the scan pipeline as `book_group` rows. Deferred, not
  precluded — that is why the rule lives in `core` behind named functions.
