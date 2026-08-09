# Standalone Books & Virtual Grouping — Design

**Date:** 2026-08-09
**Status:** Draft (awaiting user review)
**Author:** Michael Ahrendt (with Claude)

## Problem

Longbox derives series from the directory tree. `walk_library` walks with
`min_depth(0)` deliberately — the comment at
`core/src/filesystem/scanner/walk.rs:104-106` says it exists so the library root
itself can become a series when media sit loose in it — and
`SeriesBuilder::build` then sets `name = path.file_name()` unconditionally
(`core/src/filesystem/series/builder.rs:33-38,51`).

For a library mounted at `/data`, the result is a series literally named `data`.
Series membership is folder-bound and re-derived on **every** scan; no metadata
code path ever writes `media.series_id`.

### Measured production state (2026-08-09)

Library "Comics", path `/data`, `library_pattern = SERIES_BASED`,
`library_type = MIXED`.

| Metric                     | Value         |
| -------------------------- | ------------- |
| Total books                | 609           |
| Total series               | 242           |
| Books in the `data` bucket | **139** (23%) |

Metadata coverage across those 139 books:

| Signal                            | Count |
| --------------------------------- | ----- |
| No `media_metadata` row at all    | 65    |
| Non-empty `media_metadata.series` | 73    |
| Publisher                         | 72    |
| Title                             | 40    |
| Issue number                      | 20    |
| Volume                            | 18    |
| Series group                      | 13    |

Grouping them by `media_metadata.series`, falling back to filename prefix:

```
groups of 2+ books ......   8 groups  (24 books)
would-be 1-book series ... 115 groups (115 books)
```

**Naive metadata grouping is a regression**, not a fix: it would trade one junk
series for 115 singleton series, taking the library from 242 series to ~357.

The metadata is also internally inconsistent. `Fantastic Four Epic Collection`
exists as its own value for 6 books, but the same real collection also appears
as `Fantastic Four Epic Collection: Annihilus Revealed`, `: At War With
Atlantis`, `: The Name Is Doom`, `10: Counter-Earth Must Die`, and others —
roughly 15 distinct values, because the volume subtitle is baked into the series
field.

Most of the 139 are genuinely standalone works (`The Complete Maus`, `Batman -
Arkham Asylum 15th Anniversary Edition`, `Fantastic Four - Full Circle`).
Longbox has no way to express "this book is not part of a series", so the `data`
bucket is the pressure valve leaking.

### Why the existing organizer does not solve this

The loose-file organizer (`core/src/filesystem/organizer/*`, PRs #10–#16) is
merged and deployed — all three migrations are applied in prod. It does not help
here:

| Signal                         | Prod value                                    |
| ------------------------------ | --------------------------------------------- |
| `auto_organize_loose_files`    | `0` (off)                                     |
| `organize_catchall_subfolders` | `0` (off)                                     |
| `organize_plan_record` rows    | `0`                                           |
| `organize_loose_files` jobs    | 2 COMPLETED (1 file moved each), **3 FAILED** |
| Longest failed run             | **917 seconds**                               |

Both `COMIC_VINE` and `METRON` are enabled with stored keys, but Metron
IP-bans this host (see the `metron-ip-ban` memory) and provider fetches run

> 120s. The organizer's provider-confirmed design does not survive 139 files.

It also physically moves files, which the user has explicitly ruled out.

## Goal

1. Stop presenting the library-root bucket as a series anywhere a user browses.
2. Make **standalone books** a first-class, visible concept.
3. Group the genuinely-related loose books by metadata, computed **entirely
   offline**, with manual corrections that survive rescan.
4. Never move a file on disk. Never modify the scanner.

## Non-goals

- Moving or renaming files. The physical organizer remains available, untouched,
  as an orthogonal opt-in path.
- Modifying `walk.rs`, `series/builder.rs`, `media/builder.rs`, or any scan
  behavior. The `data` series row keeps being created and reconciled exactly as
  today.
- Deleting the bucket series row. It is the load-bearing link from all 139 books
  to their library.
- Automatic grouping on scan. Explicitly rejected — see Decision 6.
- Provider-confirmed matching. Offline only.

## Key decisions

1. **`media.series_id` is never nulled.** Every loose book keeps pointing at the
   bucket series forever. This is not a compromise; it is what makes the whole
   design cheap and safe. See "The nullable-FK trap" below.

2. **Standalone is derived, not stored.** A book is standalone iff its series is
   the library's loose-file bucket and it has no virtual group. No new column on
   `media` for it, nothing to backfill, nothing that can drift.

3. **The bucket is identified structurally: `series.path == library.path`.** No
   new column, no name matching, no job to maintain it. It falls out of the
   walker's existing behavior and is automatically correct after every future
   scan. `SeriesBuilder` receives the same `path` string the walker was given, so
   the comparison is byte-exact.

4. **Bucket exclusion is applied per call site, not centrally.** There is no
   single chokepoint that works. See "The two `find_for_user`s" below.

5. **Phase 1 ships with zero migrations.** Standalone books are pure resolver and
   UI work on existing columns. Deploying is a binary + web dist push.

6. **Phase 2 grouping is manual-trigger, synchronous, and offline.** A mutation,
   not a `LongboxJob`. At most ~139 rows of pure string work per library, no
   network, no queue. This is a direct response to the 917s-then-FAILED organize
   job: nothing in this path can block on a provider.

7. **Manual corrections are protected by a `pinned` flag**, mirroring the
   `locked_fields` idiom already used for the same problem in
   `crates/models/src/entity/media_metadata.rs` and `series_metadata.rs`.

### The nullable-FK trap

`media.series_id` is `Option<String>` (`crates/models/src/entity/media.rs:70-72`)
and the doc comment says _"While this is nullable, it is expected that all media
will belong to a series."_ The query layer took that expectation as a hard
invariant. Setting it to `NULL` would be a significant, security-relevant change:

- `Media::find_for_user` runs `apply_series_metadata_join`, which does
  `query.inner_join(series::Entity)` (`media.rs:151-159`). A null `series_id`
  makes the book **invisible to every user-scoped query** — Books tab, search,
  on-deck, keep-reading, OPDS, Kobo sync.
- `media` has **no `library_id` column**. Library scoping is derived entirely
  from `series.library_id` via `apply_library_hidden_filter` (`media.rs:161-165`).
  Loosening to a LEFT JOIN is not enough: the predicate becomes `NULL NOT IN
(subquery)`, which is `NULL` in SQL, so the row is still dropped. Making it
  pass requires an explicit `OR series.library_id IS NULL`, at which point
  standalone books **bypass library exclusions entirely**.
- `Media.series` is **non-null in the SDL** (`crates/graphql/schema.graphql:57`),
  and five resolvers in `crates/graphql/src/object/media.rs` (lines 107, 120,
  144, 164, 275) do `.ok_or("Series ID not set")?`. GraphQL non-null error
  propagation would nullify the parent object.
- `library_config` is reached through the series (`object/media.rs:164`), so a
  detached book would have no reading-direction/mode defaults.
- `crates/graphql/src/mutation/metadata_provider.rs:177` calls `.unwrap()` on
  `series_id` and would panic.

Keeping `series_id` populated avoids all of this. Nothing in the access-control
path changes.

### The two `find_for_user`s

`crates/models/src/entity/series.rs` defines **two** scoping functions:
`Entity::find_for_user` (line 65) and `ModelWithMetadata::find_for_user`
(line 174, plus `find_by_id_for_user` at 179). Call sites in
`crates/graphql/src/query/series.rs`:

| Line | Query                    | Uses                               | Filter? |
| ---- | ------------------------ | ---------------------------------- | ------- |
| 47   | `series(...)` — the grid | `ModelWithMetadata::find_for_user` | **yes** |
| 121  | `seriesById(...)`        | `ModelWithMetadata::find_for_user` | **no**  |
| 166  | `numberOfSeries`         | `Entity::find_for_user`            | **yes** |
| 179  | `recentlyAddedSeries`    | `ModelWithMetadata::find_for_user` | **yes** |

No single function covers the grid without also covering `seriesById`:

- Filtering `Entity::find_for_user` touches only `numberOfSeries` — the `data`
  card would **stay on the grid**, leaving the headline symptom unfixed.
- Filtering `ModelWithMetadata::find_for_user` hides the grid card but also nulls
  `seriesById`, which `packages/browser/src/scenes/book/BookLibrarySeriesLinks.tsx`
  uses to render the library badge — the **library breadcrumb would disappear**
  from every book page.

Therefore: filter at lines 47, 166, and 179; leave 121 alone.

`SeriesLoader` (`crates/graphql/src/loader/series.rs:32-35`) uses a raw
`ModelWithMetadata::find()` and bypasses both gates. This is what keeps
`Media.series` resolvable for bucket books regardless of the listing filters, so
the non-null SDL field stays safe.

## Architecture — Phase 1: standalone books (no migration)

### Rust

**`crates/models/src/entity/series.rs`** — add next to `find_for_user` (~line 65):

```rust
/// Ids of series that are a library's own loose-file bucket — the row the
/// scanner creates at the library's own path when media sit directly in it
/// (see walk_library's min_depth(0), core/src/filesystem/scanner/walk.rs:104-106).
/// Structural: a series whose path equals its own library's path.
pub fn loose_root_ids_subquery() -> SelectStatement
```

Mirrors the precedented sea_query pattern at
`crates/graphql/src/filter/series.rs:150-165` (`library_type_id_subquery`). Add a
SQL-string unit test alongside the existing ones at `series.rs:292-376`.

**`crates/graphql/src/query/series.rs`** — apply
`.filter(series::Column::Id.not_in_subquery(series::Entity::loose_root_ids_subquery()))`
at lines 47, 166, and 179. Add an equivalent `NOT EXISTS` clause to the raw
`series_alphabet` SQL (~lines 137-149). **Leave line 121 (`series_by_id`)
untouched.**

**`crates/graphql/src/object/stats.rs:51`** — add the same `NOT EXISTS` to the
raw `series_count` subquery so the library card stat matches `numberOfSeries`.

**`crates/graphql/src/loader/loose_root.rs`** (new) — `LooseRootLoader`, keyed by
`series_id`, returning `bool`. Follows the "only insert `true`" idiom of
`crates/graphql/src/loader/favorite.rs:23-65`. Register in `loader/mod.rs` and in
`add_data_loaders` (`crates/graphql/src/schema.rs:43`).

**`crates/graphql/src/object/series.rs`** — add `is_loose_root` to the
`#[ComplexObject]` block, next to `is_favorite`.

**`crates/graphql/src/object/media.rs`** — add `is_standalone` next to `series()`
(~line 104):

```rust
async fn is_standalone(&self, ctx: &Context<'_>) -> Result<bool> {
    let Some(series_id) = self.model.series_id.clone() else { return Ok(true) };
    let loader = ctx.data::<DataLoader<LooseRootLoader>>()?;
    Ok(loader.load_one(series_id).await?.unwrap_or(false))
}
```

Then `cargo dump-schema` and `yarn workspace @longbox/graphql codegen`, both
committed.

### Web

| File                                                | Change                                                                   |
| --------------------------------------------------- | ------------------------------------------------------------------------ |
| `scenes/library/tabs/series/LibrarySeriesScene.tsx` | **none** — server-filtered                                               |
| `scenes/library/tabs/books/LibraryBooksScene.tsx`   | **none** — already lists all books                                       |
| `scenes/book/BookLibrarySeriesLinks.tsx`            | select `isLooseRoot`; gate the series badge only, keep the library badge |
| `scenes/book/settings/BookManagementScene.tsx`      | select `isLooseRoot`; drop the middle breadcrumb segment                 |
| `components/book/useBookOverview.ts`                | select `isStandalone`                                                    |
| `scenes/book/BookOverviewContent.tsx:62`            | gate `<BooksAfterCursor />` on `!media.isStandalone`                     |

The last one matters more than it looks. `BooksAfterCursor` queries
`mediaById.nextInSeries` (`scenes/book/BooksAfterCursor.tsx:16-18`), which
filters on `media.series_id` (`crates/graphql/src/object/media.rs:304-366`).
Today **every one of the 139 loose books shows a "Next in series" rail of
unrelated books** drawn from the bucket.

`scenes/home/OnDeck.tsx` needs no change: `showOfY` is gated on
`series.metadata.totalIssues != null`, and the bucket has no `series_metadata`.

## Architecture — Phase 2: virtual grouping (2 migrations)

### Data model

A new `book_groups` table, **not** a synthetic `series` row. `series.path` is a
load-bearing filesystem-truth invariant used by the walker's own reconciliation
(`walk.rs:157`) and by the organizer's `resolve_series` (`organizer/apply.rs:73-142`).
A non-disk path there would be flagged `Missing` on the next scan and cascade to
its media (`library_scan_job.rs:533-615`).

**`book_groups`**: `id`, `library_id` (FK → `libraries.id`, `ON DELETE CASCADE`),
`name`, `source` (`metadata` | `filename` | `manual`), `source_key` (nullable —
the normalized key auto-detection used, for idempotent re-runs), `created_at`,
`updated_at`. Index on `(library_id, source_key)`. No `path`. No thumbnail
columns — `BookGroup.thumbnail` proxies to its first member.

**`media`** gains `book_group_id` (nullable text) and `book_group_locked`
(boolean, default false). No DB-level FK on `book_group_id`: every FK in this
codebase's migration history is declared at `CREATE TABLE` time, and SQLite's
`ALTER TABLE` does not cleanly add an enforced one. Referential integrity is
enforced in the mutation layer — `deleteBookGroup` nulls its members in the same
transaction.

### Grouping algorithm (offline, pure)

New module `core/src/filesystem/grouping/` (sibling to `organizer/`, which is not
modified).

**Signal priority per book:**

1. `media_metadata.series` if non-empty — covers 73/139.
2. Else `parse_comic_filename(stem).series`
   (`crates/integrations/metadata/src/filename.rs:31`) — covers the 65 with no
   metadata row.
3. Else no group candidate. **Do not fall back to a bare filename prefix** — the
   measurement above shows that path produces 115 singletons and makes browsing
   worse.

**Canonicalization:**

```rust
const COLLECTION_FORMAT_MARKERS: &[&str] = &[
    "modern era epic collection", "epic collection", "omnibus", "compendium",
    "masterworks", "complete collection", "gallery edition", "artist's edition",
    "treasury edition", "box set",
]; // longest-first, to avoid partial-phrase overlaps

fn canonicalize(raw: &str) -> (String /* base_key */, bool /* is_collection */) {
    let normalized = normalize_series_key(raw); // reused verbatim
    match find_marker(&normalized) {
        // truncate right after the marker: drops a trailing volume number,
        // colon subtitle, or dash subtitle in one rule
        Some(m) => (truncate_after(&normalized, m), true),
        None    => (series_family_key(&normalized), false),
    }
}
```

**Grouping key = `(base_key, is_collection ? None : year)`.**

Dropping year for collected editions is load-bearing, not a detail. Measured
against prod:

| metadata series                            | years present      | `(title, year)` outcome    |
| ------------------------------------------ | ------------------ | -------------------------- |
| `Saga of the Swamp Thing` (4)              | 2009×2, 2010, 2011 | splits 3 ways → 2 orphaned |
| `Fantastic Four Epic Collection` (6)       | 2014×1, NULL×5     | 2014 volume orphaned       |
| `Fantastic Four by J. Hickman Omnibus` (2) | 2022×1, NULL×1     | **group vanishes**         |
| `Spawn` (2)                                | 2019×1, NULL×1     | **group vanishes**         |

Keying on `(title, year)` destroys 4 of the 6 real multi-book clusters. The cause
is a semantic collision: the organizer's `group_candidates`
(`organizer/confirm.rs:113-134`) uses year correctly, because it parses _issue_
filenames like `Batman (2011) 001` where the year is a **volume designation**,
constant across a run. But `media_metadata.year` on a _collected edition_ is the
**publication year of that individual volume** — `Epic Collection v08` is 2022,
`v09` is 2023. Same field name, opposite behavior.

Gating on the marker vocabulary preserves both cases: `Batman` has no marker, so
it keys as `(batman, year)` and 2011 stays distinct from 2016; `Fantastic Four
Epic Collection…` always has one, so year is dropped and every subtitle variant
collapses to a single cluster.

Marker coverage in prod is substantial — this is not a tail case:

```
(none) ............... 92
epic collection ...... 22
omnibus .............. 13
complete collection .. 12
                       ---
markers total ......... 47 of 139  (34%)
```

**Minimum group size is 2.** A cluster with one member is not materialized; its
book stays standalone. This is the rule that converts the measured 8/24/115 split
into 8 real collections and ~115 standalone books.

`series_family_key` is reused **only** on the non-marker branch. Its own doc
comment (`organizer/confirm.rs:47-53`) warns it is _"deliberately NOT used for
real grouping … only for the 'should I even touch this folder?' check"_, because
it folds edition adjectives that must stay distinct. Using it as the fallback
family key is a narrower use than the marker path and is accepted deliberately;
if it proves too aggressive, the fallback becomes plain `normalize_series_key`.

### GraphQL

New `object/book_group.rs`, `query/book_group.rs`, `mutation/book_group.rs`,
following the `organize.rs` triplet's shape. Registered in `ContentQueries`
(`query/mod.rs`) and `ContentMutations` (`mutation/mod.rs`).

- `bookGroups(libraryId: ID!): [BookGroup!]!` — deliberately unpaginated; ~8
  groups per library by construction.
- `BookGroup { id, name, source, members, memberCount, thumbnail }`
- `detectBookGroups(libraryId: ID!): DetectBookGroupsResult!` — synchronous,
  offline, idempotent.
- `assignBookGroup(mediaId: ID!, bookGroupId: ID)` — sets `book_group_id` and
  `book_group_locked = true`. A `null` group means "force standalone".
- `createBookGroup`, `renameBookGroup`, `deleteBookGroup`.
- `MediaFilterInput` gains `bookGroupId` and `isStandalone`.

All guarded with `PermissionGuard::one(UserPermission::ScanLibrary)`, matching
the organizer mutations (`mutation/organize.rs:19,41`).

### Manual correction and rescan survival

Every user action writes `book_group_id` **and** sets `book_group_locked = true`
in the same mutation, including when the result is `null`. `detectBookGroups`
only ever considers rows where `book_group_locked = false`.

Survival across rescan requires no special-case logic: the scanner
(`core/src/filesystem/scanner/*`, `core/src/filesystem/media/builder.rs`) never
reads or writes these columns — it does not know they exist. `walk_series`
matches existing media by exact path (`walk.rs:436-451`), so an ordinary rescan
preserves the row and everything attached to it.

This directly answers the organizer spec's objection that DB-only grouping is
_"perpetually one rescan away from being undone"_
(`docs/superpowers/specs/2026-07-19-loose-file-organizer-design.md:41-46`). That
objection holds for grouping expressed as `series` rows with fabricated paths —
which is precisely why this design does not do that.

## Testing

| Layer                      | Tests                                                                                                                                                                                                                                              |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `grouping/canonicalize.rs` | marker truncation collapses all three Epic Collection forms; `Batman` 2011 vs 2016 stay distinct; metadata beats filename; singletons dropped; a fixture encoding the measured 139-book shape asserting **8 groups / 24 members / 115 standalone** |
| `loose_root_ids_subquery`  | SQL-string test in the style of `series.rs:292-376`                                                                                                                                                                                                |
| `detectBookGroups`         | idempotent across repeated runs; locked rows never reassigned; emptied groups pruned                                                                                                                                                               |
| GraphQL                    | resolver tests for `isStandalone` / `isLooseRoot`; filter SQL-shape assertions                                                                                                                                                                     |
| Web                        | jest on the gating helpers only                                                                                                                                                                                                                    |
| Scan regression            | the 16 scanner/series tests must be untouched and green — no scan file is modified                                                                                                                                                                 |

CI gates, all applicable: `cargo fmt --all -- --check`, `cargo clippy -- -D
warnings`, `cargo dump-schema -- --check`, `cargo test`, `yarn lint`, `yarn
test`. Use the `ci-preflight` skill before pushing.

## Build sequence

1. **Phase 1 Rust** — subquery helper, three call-site filters, `series_alphabet`
   SQL, `stats.rs`, `LooseRootLoader`, two resolvers, SDL + codegen.
2. **Phase 1 web** — four files.
   _Deployable. No migration. Fixes the headline symptom._
3. **Phase 2 migrations** — `book_groups` table, two `media` columns. Additive.
4. **Phase 2 algorithm** — `grouping/` module with the full test suite. No wiring.
5. **Phase 2 GraphQL** — object/query/mutation triplet, filters, SDL + codegen.
6. **Phase 2 web** — Groups tab, `BookGroupCard`, group-detail view, an "Add to
   group" affordance, and a detect CTA in `OrganizerScene.tsx`.

Each phase ships and reverts independently.

## Verification against production

Pre-deploy, read-only:

```sql
SELECT s.id, s.name, s.path, l.path AS library_path
FROM series s JOIN libraries l ON l.id = s.library_id
WHERE s.path = l.path;
-- expect exactly 1 row: name='data', path='/data'

SELECT COUNT(*) FROM media WHERE series_id = (
  SELECT s.id FROM series s JOIN libraries l ON l.id = s.library_id
  WHERE s.path = l.path
);
-- expect 139
```

Post Phase 1:

1. `numberOfSeries` → **241** (was 242)
2. The `data` card is gone from the series grid
3. `seriesAlphabet` — the "D" bucket drops by 1
4. Any of the 139 books: breadcrumb reads `Comics / <title>`, no "Next in series" rail
5. The Books tab still returns all **609** books — proving nothing was hidden
6. `sum(isStandalone)` over the library → **139**

Post Phase 2, after `detectBookGroups`:

7. `bookGroups` → **8** groups covering **24** books
8. `sum(isStandalone)` → **115**
9. Re-running `detectBookGroups` changes nothing (idempotence)
10. Pin a book to a different group, rescan, confirm it stayed

Regression check: `book_count` and `media_disk_usage` unchanged at 609 books and
the same byte total.

## Known gaps, accepted

1. **`onDeck` cross-contamination.** The hand-written CTE at
   `crates/graphql/src/query/media.rs:459-574` partitions "next unread" by
   `m.series_id`. Once a book in the bucket has been read, an unrelated loose
   book can surface as on-deck. Second-order, and the CTE is delicate; deferred
   rather than silently ignored.
2. **Raw-SQL surfaces still counting the bucket.** Beyond `stats.rs:51` (fixed in
   Phase 1): `object/library.rs:214,276`, `object/series.rs:130`,
   `query/library.rs:233,254`. Each needs an independent audit pass —
   `grep -rn 'FROM series\|FROM "series"' crates/graphql` — before calling this
   complete.
3. **Missing-entities / Clean Library flow** could still surface the bucket row if
   it is ever flagged `Missing`. Low probability; not addressed in v1.
4. **`SeriesLoader` applies no user scoping** (`loader/series.rs:32-35`), so
   `Media.series` resolves across library exclusions. Pre-existing, not
   introduced here, worth a separate look.
5. **Canonicalization is heuristic.** The marker list will need tuning against
   real-world titles, exactly as `series_family_key`'s `SUFFIXES` list has. The
   ≥2 threshold and the pin mechanism bound the damage to a two-click fix that
   then sticks.

## Deliberately not built

- Auto-grouping on scan — this is the pattern that produced the 917s FAILED job.
- Pagination for `bookGroups` — ~8 groups per library by construction.
- A DB-level FK on `media.book_group_id` — SQLite `ALTER TABLE` limitation,
  consistent with existing migration precedent.
- Making `Media.series` nullable — breaking SDL change for a case that never
  occurs; `isStandalone` delivers the same information additively.
- Any change to the physical organizer. It remains available and orthogonal.
