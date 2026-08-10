# Search Coverage & Folder Hierarchy — Design

**Date:** 2026-08-10
**Status:** Draft (awaiting user review)
**Author:** Michael Ahrendt (with Claude)

## Problem

The question that started this: _"are we searching all possible content, and is
the nested-folder logic fully implemented?"_

The scanner is fine. Search is not.

### The scanner correctly indexes arbitrarily deep nesting

`walk_library` (`core/src/filesystem/scanner/walk.rs:96-134`) runs `WalkDir` with
`max_depth: None` and `min_depth(0)` for `SeriesBased` libraries — the default.
Every directory at **any** depth that directly contains a supported file becomes
a series. A book at `/lib/Marvel/Hulk/Vol 1/issue.cbz` is indexed and attached to
a series named `Vol 1`.

The depth logic is a deliberate inversion worth recording, because it is easy to
"fix" into a double-counting bug:

| Pattern           | `walk_library` max_depth | `walk_series` max_depth |
| ----------------- | ------------------------ | ----------------------- |
| `SeriesBased`     | `None` (unbounded)       | `Some(1)`               |
| `CollectionBased` | `Some(1)`                | `None` (unbounded)      |

Source: `library_scan_job.rs:221` and `library_scan_job.rs:699-702`. Series-based
walks _wide_ to find series and _shallow_ to fill them; collection-based does the
reverse. That complementarity is what stops a file being claimed by two series.

**No content is lost during scanning.** The failure is one layer up.

### The keyword search covers 3 fields out of ~33

`packages/browser/src/components/filters/useFilterScene.ts:110-129` is the entire
keyword search for books:

```ts
;[
	{ name: { contains: search } },
	{ metadata: { summary: { contains: search } } },
	{ metadata: { title: { contains: search } } },
]
```

`media.name` is the filename minus extension. So the searchable surface is
filename, summary, and metadata title — and nothing else.

Not searched, despite existing as filter fields on the backend: `publisher`,
`characters`, `teams`, `writers`, `pencillers`, `colorists`, `inkers`,
`letterers`, `coverArtists`, `editors`, `genres`, `links`, `year`/`month`/`day`,
`ageRating`, `tags`, `path`, `status`, `size`, `extension`, `pages`,
`readingStatus`, and the entire `series`/`seriesMetadata` nested filter.

Not even reachable as filters, despite being columns on `media_metadata`:
`story_arc`, `story_arc_number`, `number` (issue #), `series_group`, `notes`,
`format`, `title_sort`, `page_count`, `language`, `identifier_*`, `comicvine_id`,
`metron_id`, `translators`.

`SeriesMetadataFilterInput` separately omits `writers`, `characters`, and
`genres` — those are also `#[graphql(skip)]`'d off the object type.

### Folder structure is unrepresented

There is no Folder entity. Hierarchy exists only as absolute path strings on
`series.path` and `media.path`.

Directories that contain only subdirectories — `Marvel/`, `Publisher/`, the
grouping layers of a well-organised collection — produce **zero rows**.
`dir_has_media` (`core/src/filesystem/common.rs:241-265`) resolves directories
to `ContentType::UNKNOWN`, so `is_default_ignored()` returns true for them and
they never qualify as series.

`SeriesBuilder::build` sets `name = path.file_name()`
(`core/src/filesystem/series/builder.rs`), so `/lib/Marvel/Hulk` and
`/lib/DC/Hulk` are two distinct rows **both literally named "Hulk"**, with
nothing in the UI distinguishing them.

`relativeLibraryPath` exists, but only as a resolver-computed field
(`crates/graphql/src/object/media.rs:399`) that re-queries the owning library and
strips a prefix, per book. The concept was needed enough to build for display and
never promoted into the data model where it could be indexed or filtered.

### Global search is routed but unbuilt

```tsx
// packages/browser/src/scenes/seriesSearch/SeriesSearchScene.tsx — entire file
import { UnderConstruction } from '@/components/unimplemented'
export default function LibraryListScene() {
	return <UnderConstruction />
}
```

Both `/series` (`SeriesRouter.tsx:25`) and `/libraries` (`LibraryRouter.tsx:29`)
render this. Both files are still misnamed `LibraryListScene` from a copy-paste.

Only `/books` is genuinely cross-library. There is no fan-out search — no surface
anywhere returns mixed entity types. `authors(search:)` has full backend support
and zero consumers. `libraries(search:)` likewise.

### Three defects found along the way

1. **Access-control leak.** `fetch_all_authors`
   (`crates/graphql/src/query/author.rs:18-53`) takes only `conn` — no
   `AuthUser`, no `find_for_user`. It leaks writer names from hidden libraries
   and age-restricted content. The parallel `characters` path does this correctly
   _and has tests for it_ (`character.rs:453-560`).

2. **LIKE wildcard injection.** SeaORM's `.contains()` does
   `format!("%{}%", s)` with no escaping. Searching `50%` builds `%50%%`, which
   collapses to `%50%` and matches "500 Page Special". Affects every search path
   including OPDS.

3. **No tokenisation.** `batman year one` must appear verbatim in a single
   column.

### Duplicated, drifted implementations

"What counts as a search match" is implemented four times, differently:

| Site                             | State | Operator   | Fields                        |
| -------------------------------- | ----- | ---------- | ----------------------------- |
| `filters/useFilterScene.ts`      | URL   | `contains` | name, title, summary          |
| `components/book/BookSearch.tsx` | local | `like`     | name, title (hand-wrapped)    |
| `opds/v1_2.rs`                   | —     | `contains` | name, title, summary, writers |
| `opds/v2_0.rs`                   | —     | `contains` | differs again                 |

`BookSearch.tsx` hand-wraps `%${value}%` _and_ passes it to `like`, so a `%` a
user types breaks the pattern outright.

## Goals

1. Widen keyword search well beyond three fields.
2. A unified global search across books, series, libraries, characters, authors.
3. Folder hierarchy as a first-class, navigable, searchable concept.
4. Build the missing `/series` and `/libraries` browse routes.
5. Fix the three defects.

Explicitly **not** a goal: full-text search. The decision is to stay on SQLite
`LIKE`. No FTS5, no tantivy, no external engine. Rationale: this is
personal-library scale, and an FTS5 shadow table would need syncing on every
scan and every metadata write — real ongoing complexity for recall gains that
tiered field coverage largely delivers anyway.

## Key decisions

### D1. Search moves server-side, as a resolver argument

`search: Option<String>` becomes a sibling argument to `filter`/`orderBy` on
`media` and `series`, matching the shape `libraries()` **already uses**
(`crates/graphql/src/query/library.rs:41-63`).

This is extending an existing convention, not inventing one. `media`/`series` are
the outliers today.

Three reasons this beats the current client-side `_or` array:

- LIKE escaping is only correct if one place owns it. The frontend has no
  business knowing SQLite's `ESCAPE` semantics.
- It collapses the four drifted implementations above into one. `apps/server`
  already depends on the `graphql` crate (`apps/server/Cargo.toml:29`) and
  `filter` is `pub mod` off its root, so OPDS can call the same builders with no
  new plumbing.
- It keeps `filter` meaning what it should: precise structured predicates, not a
  smeared keyword blob.

### D2. Multi-term = AND across terms, OR across fields

`batman year one` splits on whitespace. Every term must match _something_;
different terms may match different fields. So a book whose metadata title is
"Year One" and whose characters field contains "Batman" matches — which single-
phrase matching cannot do.

### D3. Two tiers of field coverage

**Tier 1** — always in the keyword fan-out:

| Entity            | Fields                                                                                                 |
| ----------------- | ------------------------------------------------------------------------------------------------------ |
| `media`           | `name`                                                                                                 |
| `media_metadata`  | `title`, `summary`, `publisher`, `series`, `writers`, `characters`, `story_arc`, `number` (numeric eq) |
| tags              | via the existing `media_tag_name_subquery`                                                             |
| `series`          | `name`                                                                                                 |
| `series_metadata` | `title`, `summary`, `publisher`, `imprint`, `writers`, `characters`                                    |
| `library`         | `name`, `path`, `description`                                                                          |

**Tier 2** — explicit `filter:` only: `genres`, `colorists`, `pencillers`,
`letterers`, `cover_artists`, `inkers`, `editors`, `teams`, `translators`,
`links`, `notes`, `identifier_*`, `language`, `format`, `title_sort`,
`series_group`, `comicvine_id`, `metron_id`.

Tier 2 is excluded for **precision, not performance** — searching "red" should
not match every book with a colorist named Red. On cost: these fields all live on
`media_metadata`, which `find_for_user` already left-joins into every `media`
query, so widening from 3 to ~9 predicates adds no join and touches no additional
table. `LIKE '%x%'` is non-sargable regardless of column count, so field count is
not the dominant lever.

`number` and `story_arc_number` get **equality, not LIKE**. They are stored as
`TEXT` (`m20250807_202824_init.rs:3454`) so `LIKE` "works", but substring-matching
"1" would match issues #10, #11, #21.

### D4. `media`/`series` `path` is excluded from the keyword search

Deliberately, and this is a reversal of the obvious choice.

Matching against absolute paths means a library mounted at `/mnt/comics` returns
_every series in it_ for a "comics" search, because the mount segment is baked
into every row. The prefix length varies per library, so it cannot be stripped in
a single set-based SQL predicate.

`library.path` is the exception and **stays searchable**, preserving today's
behaviour (`query/library.rs:56-61`). A library _is_ its path, so a match returns
one row rather than fanning out across every descendant — the failure mode above
is specific to rows that merely _inherit_ a prefix.

Phase 3 solves this properly: `library_folders.name` stores **leaf segments
only**, so folder-name search gets exact matching with that failure mode
structurally unreachable. Adding path search now would be strictly worse and then
redundant.

The same trap applies to the already-existing `SeriesFilterInput.path: Contains`
field — it is sitting in the schema looking like the right tool for folder
search, and it is not.

### D5. Unified search is a grouped object, not a union

`searchAll` returns one field per entity type, each with its own `nodes` and
`total_count` — rather than `search(): [SearchResult!]!` over a
`Media | Series | Library | Author | Character` union.

Pagination is the reason. `characters` and `authors` build a `HashMap` and
paginate **in memory in Rust** (`character.rs:97-141`). Offset-paginating one
flat interleaved list across three DB-backed and two in-memory sources means
either materialising all five on every page request, or accepting unpredictable
interleaving.

Precedent both ways, and the grouped shape wins on the merits here:

- Unions are idiomatic in this schema when members are genuinely interchangeable
  in one flat list — `SmartListItemEntity`
  (`crates/graphql/src/object/smart_list_item.rs:5-9`) is a `Union` of
  `Box<Series>`/`Box<Library>`.
- But OPDS v2.0's `/search` handler (`opds/v2_0.rs:440-593`) **already** returns
  three groups, each with its own count and its own type-scoped "see more" link.
  That is the exact shape being proposed, already in production.

`limit_per_type` defaults to 5, capped at 20 by a validator. This is a preview
endpoint. "Show more books" navigates to the dedicated browse route with the same
search string — it does not paginate `searchAll` in place. That is what makes
"expand one type without refetching the others" free: expansion _is_ navigation.

### D6. Folders get a table, not a derivation

`library_folders(id, library_id, parent_id, name, path, depth)` plus an additive
nullable `series.folder_id`.

The decisive fact: **the scanner already computes this and throws it away.**
`walk_library`'s `partition_map` splits every directory into `valid_entries`
(becomes a series) and `ignored_entries`. The grouping folders sit in
`ignored_entries` next to `.git` dirs. Filtering out true ignore-rule hits leaves
exactly the rows needed. This is "stop discarding a byproduct", not "add a
subsystem".

Deriving from `series.path` at query time was the alternative. Rejected because:

- No stable identity — a folder cannot be a search result you can click, join,
  or later favourite.
- Folder-name search hits the D4 mount-point problem with no clean fix.
- Breadcrumbs come free from a `folder_id` parent chain anyway, so the table
  subsumes the derivation's use case rather than competing with it.

Because `library_folders` is a **new** table, both FKs can be declared inline at
`CREATE TABLE` time (`library_id` → libraries, self-referential `parent_id`),
unlike the `book_groups` precedent where `media.book_group_id` had to be an
unenforced ALTER. Only `series.folder_id` inherits that limitation.

## Phases

Ordered by value-per-risk. The migration is last on purpose.

### Phase 0 — search primitive + defects (no migration)

**Create**

- `crates/graphql/src/filter/keyword.rs` — `multi_term_condition(raw, term_fn)`,
  folding whitespace-split terms into `Condition::all()`.

**Modify**

- `crates/graphql/src/filter/mod.rs` — add `escape_like_fragment` (escapes `\`,
  `%`, `_`) and `like_contains` returning
  `LikeExpr::new(pattern).escape('\\')`. Rewrite the six wrapping arms of
  `apply_string_filter` (`Contains`, `Excludes`, `StartsWith`, `EndsWith`,
  `LikeAnyOf`, `LikeNoneOf`). **Leave `Like` alone** — that is the intentional
  power-user raw-pattern escape hatch. Update the two existing SQL-snapshot
  tests (they assert exact strings and will need ` ESCAPE '\'` appended).
- `crates/graphql/src/filter/{media,series,library}.rs` — per-entity
  `*_keyword_condition`, reusing `media_tag_name_subquery` for tags rather than
  adding a join.
- `crates/graphql/src/query/{media,series}.rs` — add the `search` argument.
- `crates/graphql/src/query/library.rs` — replace the inline `.contains()` OR.
- `crates/graphql/src/query/author.rs` — thread `AuthUser` through
  `fetch_all_authors`, rebase onto `media::ModelWithMetadata::find_for_user`.
- `apps/server/src/routers/opds/{v1_2,v2_0}.rs` — call the shared builders. **Do
  not rename** the `search`/`query` wire params despite the inconsistency; that
  breaks existing OPDS clients.

**Tests**

- Escaping: a SQL-snapshot assertion that `Contains("50%")` renders
  `LIKE '%50\%%' ESCAPE '\'`, plus a functional test inserting `"50% Off"` and
  `"500 Page Special"` and asserting only the former matches. A `_` case
  likewise.
- Authors: `test_authors_exclude_hidden_library` and
  `test_authors_exclude_over_age_restriction`, mirroring `character.rs:454-560`.

Then `cargo dump-schema` + `yarn workspace @longbox/graphql codegen`, both
committed.

### Phase 1 — frontend catch-up + missing routes

Point the UI at the `search` argument and delete
`useSearchMediaFilter`/`useSearchSeriesFilter` and `BookSearch.tsx`'s bespoke
`like` filter. Migrate `UserSmartListsScene` off local state to
`useURLKeywordSearch` (closing its own `// TODO: move filter to URL params`).

`BookSearchOverlay` keeps local state deliberately — it is a transient modal, and
putting its term in the URL would pollute history for an ephemeral picker. It
still moves to the shared `Search` component and the shared match semantics.

Extract a `SeriesGridCard` fragment from `LibrarySeriesCard` (currently
hard-typed to one query's shape, which is why it cannot be reused), then build
real `SeriesSearchScene` and `LibrarySearchScene` — copy-adapt from
`LibrarySeriesScene` and `CharactersScene` respectively. Fix the
`LibraryListScene` misnaming while touching both files.

Copy-adapt over a generic `<EntityBrowseScene>`: the three scenes diverge in
alphabet source, collections toggle, and filter form. A props API with six
optional slots would be harder to read than three focused scenes.

**Load-bearing constraint:** every new scene must preserve the URL conventions in
`useFilterScene.ts` — `{replace: true}` on all history writes, and the
`usePrevious` + `previous != null && previous !== search` page-reset guard, which
exists because `''` is not nullish and a naive guard snaps deep-linked `?page=5`
back to page 1. Tests in
`packages/browser/src/components/filters/__tests__/useFilterScene.test.tsx`.

### Phase 2 — unified global search

`crates/graphql/src/object/search.rs` — `SearchGroup<T>` using the same
generic-concrete pattern `PaginatedResponse<T>` already establishes
(`pagination.rs:292-313`), and `SearchAllResult`.

`crates/graphql/src/query/search.rs` — `search_all`, fanning out over five types.
Each branch **must** go through its existing `find_for_user`/`fetch_all_*`
scoping; this is a thin fan-out over already-correct paths, not a new
access-control surface. `fetch_all_authors`/`fetch_all_characters` need
`pub(crate)` visibility bumps.

Frontend: a `/search` route with grouped results, and `AppCommandPrompt` giving
the orphaned `CommandPrompt` its first real job as a static "jump to" launcher,
mounted once in `AppLayout` (it owns its own Cmd+K listener).

Making `CommandPrompt` itself an async remote search surface is an explicit
**non-goal**: `Command.Input` is uncontrolled today, so it would mean threading
controlled value/`shouldFilter={false}`/debounce/per-group states — rebuilding
`/search` inside a dialog.

### Phase 3 — folder hierarchy (migration)

**Migration** `m20260810_000000_add_library_folders.rs`, following
`m20260809_000000_add_book_groups.rs`'s shape: create table + indexes
(`(library_id)`, unique `(library_id, path)`, `(library_id, parent_id)`,
`(name)`), then `ALTER TABLE series ADD COLUMN folder_id TEXT` + its index.

**Scanner** — the single correct integration point is
`walk_library` → `LibraryScanTask::Init`. `SeriesScanJob` never discovers new
folders, and `LibraryWatcher` just re-enqueues a full scan.

- `walk.rs` — add `structural_directories: Vec<PathBuf>` to `WalkedLibrary`
  (already `#[derive(Default)]`), populated from `ignored_entries` minus true
  ignore-rule matches. Do not touch the existing partition or the
  `seen_directories`/`ignored_directories` counters.
- `utils.rs` — `sync_library_folders`: sort by depth ascending so parents resolve
  first, build an incremental `path -> folder_id` map (same shape as the existing
  `series_id_by_path` map), batch-upsert with `OnConflict` on
  `(library_id, path)`, chunked by `SQLITE_BIND_LIMIT`.
- `library_scan_job.rs` — thread through `InitTaskInput`, call unconditionally
  (an unchanged library still needs its folder rows refreshed), backfill
  `series.folder_id`, and prune stale folders in `finalize()` mirroring the
  `scanned_directory` sweep at lines 430-455.

Folder sync failures **log and continue**; they must never fail a scan. Same
posture as every other best-effort step in `finalize()`.

**Known edge case, worth one test:** a directory that is _both_ a series (has
loose files) and an ancestor (has media-bearing subdirectories) —
`/lib/Marvel/*.cbz` plus `/lib/Marvel/Hulk/`. `Marvel` becomes a series, never
enters `structural_directories`, so `Hulk.folder_id` is `None`. The breadcrumb
resolver falls back to a `series.path`-equality lookup — the same structural-
identity trick `loose_root_ids_subquery` already uses.

**Pre-existing behaviour, not a regression:** renaming an ancestor folder changes
every descendant's path, so those series go through the existing
missing-then-recreate cycle with new IDs. Folders do not make this worse; the
design just does not fix it.

**CollectionBased limitation, stated rather than glossed:** `series.path` never
goes below depth 1 in a collection library, so `library_folders` captures
"library → top-level folder" and no more. The real substructure lives only in
`media.path`. Surfacing that is a documented follow-up, and it is the same
follow-up under either design option — not a differentiator.

**Deploy hazard:** migrations are forward-only and an older binary hard-panics
against a migrated DB. The GHCR image must be pushed **before** any Unraid
update, or the server bricks.

## Verification

Per phase, before pushing: the `ci-preflight` skill
(`.claude/skills/ci-preflight/scripts/preflight.sh`) — `cargo fmt --all --check`,
`cargo clippy -- -D warnings`, `cargo dump-schema -- --check`, `cargo test`,
`yarn lint`, `yarn test`.

Schema drift and `clippy -D warnings` are the two gates that most often surprise;
any new GraphQL field means `cargo dump-schema` plus
`yarn workspace @longbox/graphql codegen`, both committed.

End-to-end for Phase 3 specifically: scan a real nested library, confirm
`library_folders` row count and depths match the on-disk tree, rename a directory
on disk, rescan, and confirm stale rows prune and new ones appear.
