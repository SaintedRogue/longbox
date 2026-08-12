# Omnibus shelf

A fourth tab beside Books, Series and Files listing a library's omnibuses as
books: a card is a book, and one click opens it.

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

Including the series name is what gives full coverage of a flat library, where the
folder carries the name and the files inside it are called `v01.cbz`. It is also
the one signal with a cost: a series named for an omnibus contributes _every_ book
in it, so a stray extra file in such a folder appears on the shelf too. That is the
right trade for this library, where an omnibus folder holds only its own volumes.

`format` is included even though nothing populates it yet. It already exists as a
column, it is the principled signal, and setting it by hand in the metadata
editor is the escape hatch for a book the name rule misses.

## Revision, 2026-08-12 — one card per book

The first build of this shipped a **collapsed shelf**: one card per omnibus _set_,
badged with a volume count, volumes expanding in place. It was wrong in practice
and has been replaced.

Two things were wrong with it. The expansion panel put a click between the reader
and the book they were looking at, to show a volume count nobody needed — the
stated goal was to _minimise_ clicks. And the panel rendered `BookCard`s in an
unconstrained flex row, so each cover ballooned to the full page width.

The shelf is now a flat list of books: **a card is a book, and one click opens
it.** Everything below describes that design; the set-grouping machinery
(`group_sets`, `SetKey`, `strip_volume_tokens`, the `omnibusSets` query and the
`OmnibusSet` object) is deleted rather than left dormant.

Note what this changed about the earlier reasoning. Grouping had to happen on the
server _only_ to keep volume badges honest across a page boundary. With no sets
there are no badges, so paginating books is now correct — and the approach that was
rejected as "quietly wrong" becomes the right one. The reversal is the point: the
objection was specific to collapsed cards, not general.

## Architecture

A filter, not a bespoke query. `core/src/omnibus.rs` exposes
`qualifying_condition()`, and `MediaFilterInput` gains `isOmnibus: Boolean`
alongside the `isStandalone` it already had — same shape: derived rather than
stored, negated when `false`.

That means the ordinary `media` query serves the shelf, so sorting, the table
view, the grid size slider, the alphabet strip and pagination all work without
being written a second time, and keep working as that scene improves.

The rule still lives in `core` rather than in the GraphQL crate so a future
scan-time detector can reuse it — `core` holds the scan jobs, and
`crates/graphql` depends on `longbox_core`, never the reverse.

There is no in-memory grouping any more, so the `MAX_QUALIFYING_BOOKS` ceiling and
the `truncated` flag are gone with it. Pagination happens in SQL, which has no such
bound.

## Frontend

`LibraryBooksScene` takes three optional props, all defaulting to current
behaviour, so the Books tab is untouched:

| Prop           | Purpose                                                               |
| -------------- | --------------------------------------------------------------------- |
| `presetFilter` | AND-ed into every query the scene makes                               |
| `variant`      | Separates cached pages, saved layout and remembered scroll position   |
| `emptyState`   | Its own words — "do you have any books?" is wrong for a filtered view |

`LibraryOmnibusScene` is then a wrapper that renders it with
`{ isOmnibus: true }`. The tab, the route and the i18n key are unchanged from the
first build.

## Edge cases

- **Every volume qualifies on its own.** A five-volume set is five cards. When only
  the folder carries the word, all five qualify through the series clause.
- **Soft-deleted books** are excluded; `deleted_at is null` is applied by the
  media query already.
- **A library with no omnibuses** gets the shelf's own empty-state copy naming the
  four signals, not the Books tab's "do you have any books in your library?".

## Testing

Six tests in `core/src/omnibus.rs`. Two are pure name matching; four run against a
real migrated schema, because the condition filters on `media_metadata` columns
reachable only through a join and on a `series` subquery — a mistake there is a
runtime error no string-level test would catch. One of the four deliberately uses
`find_for_user` rather than the bare `find`, since every real caller does, and its
extra library-exclusion and series-metadata joins are where an ambiguous-column
error would surface.

Those tests caught, on first run, that `series.library_id` is an enforced foreign
key (so a series needs a real `library`, which needs a mandatory `library_config`)
and that `media.size`, `pages` and `status` are NOT NULL without defaults.

## Out of scope

- **Excluding** a book the name rule wrongly caught. Including one already works by
  setting `format` in the metadata editor; excluding needs a new flag, worth adding
  once a real false positive turns up.
- Provider-populated `format`. That would mean widening `ExternalMediaMetadata`,
  which the metadata-provider brief ruled out; it needs raising on its own terms.
- Promoting detection into the scan pipeline as `book_group` rows. Deferred, not
  precluded — that is why the rule lives in `core` behind a named function.
