# Longbox Investigation — Phase 1 Findings

Three research spikes conducted before any feature work, per the project plan:

1. [Navigation / UX audit](#1-navigation--ux-audit) of the web UI's routing and shell
2. [Open metadata mapping](#2-open-metadata-mapping) — what exists for ComicInfo.xml and what external-source enrichment needs
3. [PWA capability audit](#3-pwa-capability-audit) — current state and gaps for a PWA-first client

Plus [section 0](#0-multi-client-leftovers-flagged-not-removed): candidates flagged (but not removed) during the Phase 0.5 desktop/expo removal.

All file references are to the repo state at the Phase 0.5 removal commit.

---

## 0. Multi-client leftovers flagged, not removed

These surfaced during the Phase 0.5 audit as existing mainly to support multi-client distribution. They were **kept** because they are (or may be) load-bearing for OPDS/API clients other than our own web app. Revisit deliberately, not as cleanup.

| Candidate                                                                                                                            | Location                                                                                                                                                                                                             | Why kept                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| JWT access/refresh token auth flow (`generate_token` login param, `/api/v2/auth/refresh-token`, `JwtTokenPair`)                      | `apps/server/src/routers/api/v2/auth.rs`, `apps/server/src/config/jwt.rs`, `packages/sdk/src/controllers/auth-api.ts`                                                                                                | Standard bearer-token path for non-session API/OPDS/programmatic clients, not just native apps                                                                                                                                                              |
| OIDC `redirect_uri` deep-link support (doc example `stump://auth/callback`, token-in-redirect flow)                                  | `apps/server/src/routers/api/v2/oidc.rs:79-81, 363-370`                                                                                                                                                              | Generic optional param on the OIDC flow; only the doc example is native-specific. Candidate to restrict/remove once we're sure no non-web client needs it                                                                                                   |
| `platform` prop threading + `Platform` type (`'browser' \| 'macOS' \| ...`) and all `isDesktop` conditionals (now permanently false) | `packages/client/src/context.ts:94`, `packages/browser/src/stores/app.ts`, `LoginOrClaimScene.tsx` "go to servers" branch, `SettingsNavigation.tsx`, `SettingsSideBar.tsx`, `paths.ts`, `SettingsNavigationItem.tsx` | Inert dead branches on web; removing is churn with no behavior change. Worth excising in a dedicated cleanup once nav work touches these files anyway                                                                                                       |
| `authMethod` prop plumbing (`'session' \| 'token'`) on `StumpWebClient`/`SDKProvider`                                                | `packages/client/src/sdk/SDKProvider.tsx`, `apps/web/src/App.tsx`                                                                                                                                                    | Web always uses `session`, but token mode is the API surface other clients use via the SDK                                                                                                                                                                  |
| KoReader/Kobo sync token paths (bearer alternative for OPDS v1.2)                                                                    | `apps/server/src/middleware/auth.rs:192`, `apps/server/src/routers/koreader/`                                                                                                                                        | Serves third-party reader devices — explicitly a kept feature                                                                                                                                                                                               |
| Multiple installation methods / release binary matrix (macOS/Windows server binaries)                                                | `.github/workflows/release_binary.yml`                                                                                                                                                                               | Server distribution, not client distribution — but the matrix may be broader than Longbox needs                                                                                                                                                             |
| Upstream docs site links (`stumpapp.dev`) and Crowdin project references in README/docs                                              | `README.md`, `docs/`                                                                                                                                                                                                 | Still point at upstream Stump docs/translation project; needs a branding/docs decision, not deletion                                                                                                                                                        |
| README claim (now removed) that Spacedrive AGPL icons were used "in web and mobile applications"                                     | was `README.md` Attribution                                                                                                                                                                                          | Audit could not locate any Spacedrive/AGPL assets in current source (`packages/browser`, `apps/web`); claim appears stale upstream. Attribution section was rewritten at removal; if AGPL icons ever resurface in `packages/components`, re-add attribution |

---

## 1. Navigation / UX audit

Analysis performed with the `ui-ux-pro-max` navigation guidelines (persistent-nav, back-behavior, back-stack-integrity, breadcrumb-web, state-preservation, modal-vs-navigation).

### Verdict

The persistent shell **already exists** and survives most navigation. The real problems:

- **(a)** the entity hierarchy (library → series → book) is flattened into sibling top-level routers, so drill-down discards parent context;
- **(b)** there is no breadcrumb or in-app back affordance in the web shell at all;
- **(c)** readers remove 100% of navigation, and the only exit goes _forward_ to book overview rather than back to where you came from;
- **(d)** scroll position is never restored.

The route architecture makes a breadcrumb/overlay fix moderately cheap. Two things actively fight a deeper fix: descendant `<Routes>` (no data router) and a plugin-managed scroll container.

### 1.1 Actual routing structure

React Router DOM **v6.30.3**, classic declarative API — **not** the data router: `apps/web/src/App.tsx:13` mounts `<BrowserRouter>`; `packages/browser/src/AppRouter.tsx:39-53` uses `<Routes>`/`<Route>` with element props. No `createBrowserRouter`, no loaders, no `<ScrollRestoration>` anywhere. Code-splitting is per-scene `lazy()`.

The top level delegates to six _separate_ descendant `<Routes>` trees via splat paths — there is no single route manifest:

```
AppRouter.tsx:40-52
/                        <AppLayout>            (persistent shell)
├── ""                   HomeScene
├── libraries/*          LibraryRouter
├── series/*             SeriesRouter
├── books/*              BookRouter
├── clubs/*              BookClubRouter
├── smart-lists/*        SmartListRouter
└── settings/*           SettingsRouter
/auth                    LoginOrClaimScene      (NO shell)
/server-connection-error                        (NO shell)
*                        FourOhFour             (NO shell)
```

Sub-trees:

- **LibraryRouter** (`scenes/library/LibraryRouter.tsx:27-45`): `""` → LibrarySearchScene; `:id/*` → **LibraryLayout** (per-library header + Series/Books/Files tabs) wrapping `series`, `books`, `files`, `settings/*`.
- **SeriesRouter** (`scenes/series/SeriesRouter.tsx:24-36`): `""` → SeriesSearchScene; `:id/*` → **SeriesLayout** wrapping `books` (default), `files`, `settings`.
- **BookRouter** (`scenes/book/BookRouter.tsx:17-39`): `/` → BookSearchScene; `:id` → BookOverviewScene (**flat, no layout wrapper**); `:id/manage`; three reader routes (`:id/epub-reader`, `:id/pdf-reader`, `:id/reader`).
- **SettingsRouter**, **SmartListRouter**, **BookClubRouter**: same pattern — list scene + `:id/*` layout.

Shell persistence:

| Layer                                                | Persists across                                                                      | File                        |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------ | --------------------------- |
| `AppLayout` (SideBar/TopBar/MobileTopBar + `<main>`) | everything except `/auth`, `/server-connection-error`, `/404`; self-hides in readers | `AppLayout.tsx:208-260`     |
| `LibraryLayout`                                      | only `/libraries/:id/*`                                                              | `LibraryLayout.tsx:112-137` |
| `SeriesLayout`                                       | only `/series/:id/*`                                                                 | `SeriesLayout.tsx:90-106`   |
| `SettingsLayout`                                     | only `/settings/*`                                                                   | `SettingsLayout.tsx:52-84`  |

Every cross-entity hop (library → series, series → book, anything → reader) crosses sibling routers, so the intermediate entity layout unmounts. The app shell (sidebar) survives these hops — only entity context (library header, tabs, active state) is lost.

### 1.2 Current navigation affordances

- **Sidebar** (`components/navigation/sidebar/SideBar.tsx`): user-configurable sections — Home, "Explore" → `/books`, a Libraries accordion listing every library (unpaginated), Smart Lists, Book Clubs. Active state is prefix-matching (`LibrarySideBarSection.tsx`: `location.pathname.startsWith(paths.librarySeries(id))`), so **the sidebar shows no active library when you're on `/series/:id` or `/books/:id`** even though you're logically inside one.
- **Topbar** only when `primaryNavigationMode === 'TOPBAR'` (`AppLayout.tsx:99-102, 141`). Mobile always gets `MobileTopBar` (hamburger → sidebar-in-a-sheet + logo→home). A "home base" link technically always exists (except readers), but there is **no location indicator anywhere in the shell**.
- **Back/forward buttons exist but are desktop-app-only**: `mobile/NavigationButtons.tsx:7-43` (history chevrons + `cmd+[`/`]` hotkeys, self-described `FIXME: this is pretty buggy`) is rendered only from `SideBar.tsx:81-92`, which returns `null` when `platform === 'browser'`. **The web UI has zero in-app back affordance.**
- **Breadcrumbs**: a `Breadcrumbs` component exists (`packages/components/src/breadcrumbs/Breadcrumbs.tsx`) but is used in exactly two leaf scenes (`BookManagementScene.tsx:97`, `UsersScene`). Partial substitutes: book overview renders library/series badges (`BookLibrarySeriesLinks.tsx:34-55` — a de-facto breadcrumb); series header hides "Go to library" inside the `⋯` overflow dropdown (`SeriesHeader.tsx:79-89`).
- **Scroll restoration: none.** Scrolling happens inside `<main id="main">` (`AppLayout.tsx:235-248`), optionally wrapped by an overlayscrollbars viewport (`:61-94`), so browser-native restoration can't help. `BookOverviewScene.tsx:41-45` manually hunts `[data-artificial-scroll="true"]` to force scroll-to-top. Back to a paginated grid lands at the right `?page=` but scroll offset 0.
- **Search**: no global search or command palette (the only `SearchCommand` is in-book EPUB text search). Search is three separate scenes (`/books`, `/libraries`, `/series`) plus per-list debounced `?search=` inputs (`components/filters/Search.tsx`, `useFilterScene.ts:66-96`).

### 1.3 Exactly when the shell disappears

`AppLayout.tsx:131-141`: a regex on the pathname (`/\/book(s?)\/.+\/(.*-?reader)/`) hides MobileTopBar, TopBar, and SideBar for the three reader routes. Also shell-less: `/auth` (correct), `/server-connection-error`, and `/404` — which has **no way home except typing a URL**, and every sub-router reaches it via `<Navigate to="/404">` (e.g. `SeriesRouter.tsx:35`), destroying the offending URL.

Reader escape hatch: only the reader chrome's overview link (`ReaderHeader.tsx:38-44`, `EpubReaderHeader.tsx:30`), both hardcoded `Link to={paths.bookOverview(id)}` — a _forward_ navigation. Entering the reader from Home's "Continue Reading" rail exits you to `/books/:id`, not Home; each session pollutes browser-back with reader→overview entries.

### 1.4 Concrete before/after examples

**(a) Library → Series loses the library.**
Before: at `/libraries/:id/series`, `SeriesCard` links to `paths.seriesOverview(id)` (`components/series/SeriesCard.tsx:83`) → `/series/:id/books`, served by the sibling `SeriesRouter` — `LibraryLayout` (header, stats, tabs) unmounts. The only ways back to _that library_ are the overflow-menu "Go to library" (fresh navigation, page/filter state gone) or browser-back.
After (cheap): `SeriesLayout` already fetches `library { id name }` (`SeriesLayout.tsx:19-22`) — surface `Libraries / {library} / {series}` in the header using the existing `Breadcrumbs` component (pattern proven at `BookManagementScene.tsx:97`).
After (structural): nested routes `/libraries/:libraryId/series/:seriesId/*` rendering `SeriesLayout` inside `LibraryLayout`'s `<Outlet>`, keeping `/series/:id` as a canonical redirect.

**(b) Series → Book loses the series.**
Before: `BookCard` → `paths.bookOverview(id)` (`components/book/BookCard.tsx:124`) → `/books/:id` (flat route). The read-order context ("book 4 of 12 in series X, page 3 of the grid") evaporates. The pseudo-breadcrumb badges link back **without page/filter params** (`BookLibrarySeriesLinks.tsx:37,48`), landing on page 1 unfiltered — and they re-fetch the series (`:7-18`) purely to rebuild context the source page already had.
After: promote the badges to a real breadcrumb, and/or open book detail as a peek overlay over the still-mounted grid (§1.5). `BooksAfterCursor` ("next in series", `BookOverviewScene.tsx:71`) is existing evidence the design knows this context is missing.

**(c) Reader exit ignores origin.**
Before: exit hardcoded to `paths.bookOverview(id)`.
After: pass origin via `navigate(to, { state: { from: location } })` — the codebase already uses this exact idiom for auth redirects (`AppLayout.tsx:197`) — and make the reader close button `navigate(-1)`-with-fallback. Two-file fix, zero routing changes.

**(d) Sidebar active-state as breadcrumb anchor.** Derive the owning library from layout query data and highlight it on `/series/:id` and `/books/:id`. No route change.

**(e) 404 dead end.** Give `FourOhFour` a home link; stop `<Navigate to="/404">` from discarding the bad URL.

### 1.5 Detail views better as overlays — and what exists to build on

The house style already puts entity _info_ in sheets while lists stay mounted:

Existing overlay inventory: `Sheet`/`SheetPrimitive`, `Drawer`, `Dialog`/`ConfirmationModal` (all in `packages/components`); `EntityOverviewSheet` (`components/sharedLayout/`), `SeriesOverviewSheet` (wired at `SeriesHeader.tsx:173-179`), `LibraryOverviewSheet`, `URLFilterDrawer` + `FilterSlideOver`, `MobileSheet`, reader `SettingsDialog`, `EmailBookDialog`.

Candidates to convert:

1. **Book detail as peek overlay** (highest value): open `BookOverviewScene` content in a Sheet/Drawer over the still-mounted grid; keep `/books/:id` as the deep-link full page (React Router v6 background-location modal-route pattern).
2. **Metadata editing**: `MediaMetadataEditor` is inlined into the overview page (`BookOverviewScene.tsx:73-76`); as an editing surface it belongs in a sheet/dialog with dirty-state confirm.
3. **`/books/:id/manage`** (thumbnail/tags): a full route + breadcrumbs for two widgets — natural drawer.

Counter-recommendation: readers and the library/series scenes themselves should _stay_ routes; only "peek" surfaces become overlays.

### 1.6 State preservation matrix

| State                                    | Mechanism                                                                         | Survives navigation?                                                            |
| ---------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Page, pageSize, filters, search, sort    | URL params (`useFilterScene.ts:27-166`)                                           | Yes via history back; **no** via any in-app link (cards/badges carry no params) |
| Grid-vs-table layout, table sort/columns | zustand persisted, keyed `series-global`/`books-global` (`stores/layout.ts:8-40`) | Yes, cross-session                                                              |
| Reader prefs / app-level state           | zustand persisted (`stores/reader.ts`, `stores/app.ts`)                           | Yes                                                                             |
| **Scroll position**                      | nothing                                                                           | **Lost, always**                                                                |
| Reader page progress                     | URL `?page=` + server sync                                                        | Yes                                                                             |

URL is the source of truth for browse state (good — back _would_ work), but scroll loss plus context-free forward links make back navigation feel broken anyway.

### 1.7 Cost assessment

**Cheap (works with the grain):** persistent shell already wraps every content route; layout queries already fetch parent references (data-driven breadcrumbs need no new API); `Breadcrumbs` component exists and is proven; overlay primitives + five shipped sheet implementations; browse state already URL-encoded; reader exit-to-origin is a two-file fix.

**Expensive / actively fights it:**

1. **No data router** — no `<ScrollRestoration>`, no loaders. Proper scroll restoration means migrating to `createBrowserRouter` (collides with #2) or a hand-rolled scroll cache keyed by `location.key`.
2. **Six descendant `<Routes>` trees behind splats** — no central route manifest, so route-aware shell features (per-route breadcrumb config, background-location modal routes, `useMatches`) require consolidating the routers first. This is _the_ structural tax.
3. **Regex/string path-matching couples the shell to path shapes**: `AppLayout.tsx:55, :115, :136`; `LibraryLayout.tsx:88`; `SeriesHeader.tsx:99,107`. Any route reshuffle silently breaks these.
4. **Flattened entity hierarchy in URLs**: `/libraries/:id`, `/series/:id`, `/books/:id` are peers — URL-derived breadcrumbs are impossible; must be data-driven (or restructure with canonical redirects).
5. **Custom scroll machinery**: overlayscrollbars replaces the viewport conditionally on a user preference; any restoration solution must handle both the native `#main` and the plugin viewport.
6. **Two shell modes** (sidebar vs topbar preference) double the surface for any new persistent nav element.

**Recommended cheapest-first sequence:** (1) breadcrumb row in entity headers fed by existing layout queries + enable `NavigationButtons` for `platform === 'browser'` (fixing its FIXME); (2) reader exit via `location.state.from`; (3) back-links that carry `?page/filters` or use `navigate(-1)`; (4) book-overview peek sheet with `/books/:id` kept as deep link; (5) only then router consolidation → data router → real `ScrollRestoration`.

---

## 2. Open metadata mapping

### Headline

Upstream already built most of the hard part: a complete provider-integration framework (trait → encrypted config → rate-limit/retry → background fetch job → match scoring → field-level merge with locks → review UI) landed in Feb 2026 — **but with exactly one working provider (Hardcover, a book/manga site) and zero comic providers.** `LibraryType::Comic` currently matches no provider at all, so the post-scan enrichment hook never fires for comic libraries. A ComicVine/Metron/GCD layer is mostly "add providers + widen the types," not greenfield.

### 2.1 ComicInfo.xml parsing today

- Discovered in ZIP/CBZ (`core/src/filesystem/media/format/zip.rs:109-117, 161-167`) and RAR/CBR (`rar.rs:141, 206`); deserialized by `metadata_from_buf` (`core/src/filesystem/media/utils.rs:13-29`) via quick-xml into `ProcessedMediaMetadata` (`core/src/filesystem/media/metadata.rs:26-219`), which doubles as the ComicInfo schema via `#[serde(alias = "PascalCase")]`. Parse failure logs and silently drops metadata (file still ingested).
- **Read**: Format, Title/TitleSort, Series/SeriesGroup, StoryArc(+Number), Number, Volume, Summary/Notes, AgeRating (normalized 0–18), Genre/Tags, Language, Year/Month/Day, all seven creator roles (Writer/Penciller/Inker/Colorist/Letterer/CoverArtist/Editor), Publisher, Web→`links`, Characters/Teams, PageCount. List fields flatten to `", "`-joined TEXT columns on `media_metadata` (`into_active_model`, `metadata.rs:222-263`); Tags become first-class `Tag` entities.
- **Ignored** (defined by the Anansi schema, no alias in the struct): `Count`, `AlternateSeries/Number/Count`, `Imprint`, **`LanguageISO`** (only the non-standard `Language` alias is read — real ComicInfo files lose their language), `BlackAndWhite`, `Manga`, `ScanInformation`, `Review`, `CommunityRating`, `MainCharacterOrTeam`, `Locations`, `Pages` (per-page objects incl. FrontCover), and the v2.1 additions **`GTIN`** and `Translator`.
- Telling detail: the test fixture (`utils.rs:76`) is a real ComicTagger file whose `<Notes>` contains `[Issue ID 517895]` and whose `<Web>` is a ComicVine URL — this flows verbatim into `notes`/`links` but the embedded ComicVine ID is never parsed.

### 2.2 Read-only vs write-back

**Strictly read-only.** No code serializes metadata back to XML or writes into archives — the only archive writing is CBR→CBZ / PDF conversion (`core/src/filesystem/archive.rs:11-82`). The metadata-edit GraphQL mutations write to the DB only.

### 2.3 Metadata flow and storage

- **Media**: scanner → per-format `FileProcessor::process()` → `MediaBuilder` (`builder.rs:102-144`) → `media_metadata` row (1:1 with `media`; entity `crates/models/src/entity/media_metadata.rs:23-114`). Also six ebook identifier columns (`identifier_amazon/calibre/google/isbn/mobi_asin/uuid`).
- **Series**: Mylar-style `series.json` → `ProcessedSeriesMetadata` (`core/src/filesystem/series/metadata.rs:13-98`) → `series_metadata` (title, publisher, imprint, `comicid` — documented as "ComicVine comicid", a legacy Mylar convention — year, volume, booktype, age_rating, collects JSON, status…).
- **EPUB**: sidecar `.opf` > OPF root > epub-rs map, incl. Calibre-style keys (`format/epub.rs:93-128`, `metadata.rs:267-403`). **PDF**: trailer InfoDict, title/genre/date/writers only (`format/pdf.rs:89-94`).

### 2.4 The existing provider framework (`crates/integrations/metadata`, ~2,400 lines)

- **Trait** `MetadataProvider` (`provider.rs:14-65`): `search_series/search_media`, `fetch_series_metadata/fetch_media_metadata(external_id)`, default scoring via `MatchScorer`. `fetch_cover_url` exists only as commented-out code.
- **Factory** string-matches `"HARDCOVER"` only (`lib.rs:24-34`); models enum has a single variant with `supported_library_types() = [Book, Manga, LightNovel]` (`crates/models/src/shared/enums.rs:467-492`). `providers/anilist.rs` is a dead, unexported stub.
- **Types are book-shaped**: `ExternalMediaMetadata` (`types/metadata.rs:34-91`) has isbn/writers/artists/cover_url but **no story arcs, characters, teams, penciller/inker/editor, imprint, or variant covers**. `SearchQuery` is `{title, author, isbn, year, limit}` (`types/query.rs:2-8`) — and the fetch job populates only `title` (`fetch_job.rs:467, 645`).
- **Merge engine**: `MergeStrategy` (FillGaps/PreferExternal/…), `AutoApplyConfig` with confidence threshold, `FieldMerger` honoring per-field locks; `MetadataField` enumerates ~45 fields including `Cover` — though no cover download/apply path exists.
- **Infra**: governor rate limiter (**per-second quotas only**, `rate_limit.rs:20`), reqwest-middleware exponential backoff on 429/5xx (`client.rs:10-33`), encrypted API tokens (`metadata_provider_config.rs`), `metadata_fetch_records` with candidate JSON.
- **Wiring**: post-scan enrichment hook (`library_scan_job.rs:358-380`, fires iff an enabled provider overlaps the library type); manual trigger; full GraphQL surface (provider CRUD, fetch/accept/reject/lock mutations); complete match-review UI (`packages/browser/src/scenes/settings/server/metadataIntegrations/`, `components/metadata/metadataMatching/`) with confidence badges and per-field actions. Hardcover is hard-coded as the only choice in `providers/constants.ts:4`.
- **External-ID storage**: `metadata_source` + `metadata_external_id` + `locked_fields` on both metadata tables (migration `m20260207_000000_metadata_provider_integration.rs`). **One provider identity per row** — no cross-provider ID map; legacy `series_metadata.comicid` is not reconciled with the new columns. No `comicvine_id`/`metron_id`/`gcd_id` columns.

### 2.5 External sources

|             | ComicVine                                                                                                          | Metron                                                                                                               | GCD                                                                                                                                          |
| ----------- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| API         | REST, JSON/XML; volumes/issues/characters/teams/people/story_arcs + search                                         | Django REST, Swagger at metron.cloud/docs; If-Modified-Since + `modified_gt` incremental sync                        | Nascent, **explicitly unstable** DRF API; canonical access = bi-weekly MySQL/SQLite dumps                                                    |
| Auth        | free API key (query param)                                                                                         | HTTP **Basic** (account user+pass, not a key)                                                                        | account Basic/Session; anonymous "will likely be turned off"                                                                                 |
| Rate limits | 200 req/resource/hour + velocity detection                                                                         | **20/min burst + 5,000/day**, `X-RateLimit-*` headers to honor                                                       | unpublished hourly; dumps preferred                                                                                                          |
| License/ToS | **non-commercial, no redistribution of data**, attribution, key revocable → bring-your-own-key client feature only | data **CC BY-SA 4.0** — friendliest; attribution + share-alike, redistribution OK                                    | data **CC BY-SA 4.0**; cover images publisher-copyrighted, **not in dumps**, not licensed                                                    |
| Data        | volumes, issues, credits (role strings), arcs, characters, teams, covers + unnamed variant images                  | structured creator+role credits, arcs, characters, teams, universes, **structured variant covers**, prices, ISBN/UPC | deepest print indexing: per-story credits, variant issues as first-class rows, reprint linkage, international coverage; no arc/team entities |
| Cross-refs  | stable numeric id; `4000-<id>` URL slug                                                                            | **carries `cv_id` and `gcd_id` and filters by them** (~92% GCD coverage) — the natural cross-reference hub           | own ids only                                                                                                                                 |

**ComicInfo external-ID conventions**: no dedicated provider-ID element exists in the Anansi schema. ComicTagger writes `[Issue ID N]` into `Notes` and the ComicVine URL into `Web`; Kavita/Komga read `Web` (matching/links) and v2.1 `GTIN`→ISBN. Metron also stewards the competing **MetronInfo.xml** with first-class `<ID source="…">` elements. **No Rust client crates exist for any of the three** (checked crates.io July 2026); reference implementations: Mokkari (official Metron client, local quota enforcement), Simyan (ComicVine), ComicTagger talkers (incl. gcd-talker operating offline against a user-downloaded GCD dump), komf (treats ComicVine matching as mismatch-prone — a caution).

### 2.6 Gap summary — what a mapping layer needs

Reuse, don't rebuild: the trait/factory/config/rate-limit/job/scoring/merge/review-UI pipeline end to end, plus the post-scan hook and the `metadata_source`/`metadata_external_id` columns.

Gaps to close:

1. **No comic provider** — and adding one touches four hard-coded registries: factory (`lib.rs:24-34`), models enum + `supported_library_types()` (`enums.rs:467-492`), and browser `providers/constants.ts`.
2. **`SearchQuery` too narrow** for issue matching — needs series name, issue number, publisher, volume/year, and an optional known external ID to skip search entirely; fetch job must populate more than `title`.
3. **`ExternalMediaMetadata` lacks comic fields** (arcs, characters, teams, penciller/inker/editor, imprint, variant covers, multi-URL links) even though DB columns and `MetadataField` variants already exist for most.
4. **External-ID seeding from files is discarded**: parse ComicTagger's `[Issue ID N]` from `Notes` and provider URLs from `Web` at scan time — the highest-precision matching signal available, and Metron's `cv_id`/`gcd_id` filters turn it into a direct lookup.
5. **Single provider identity per row**; a cross-provider ID map (and reconciling legacy `series_metadata.comicid`) is needed for multi-source enrichment.
6. **ComicInfo parser gaps**: `LanguageISO`, v2.1 `GTIN`/`Translator`, `Count`/`Imprint`/`Manga`/`BlackAndWhite`/`CommunityRating`, `Pages`.
7. **Rate limiter** needs per-minute/per-hour/per-day quotas + `X-RateLimit-*` header handling (currently per-second only).
8. **Auth model** assumes a single API token; Metron needs Basic (user+pass), GCD needs account auth or none.
9. **No offline/dump provider concept** — GCD is realistically a bi-weekly SQLite import (gcd_talker precedent).
10. **No cover ingestion** — `fetch_cover_url` commented out; `cover_url` fetched into candidates but never downloaded/applied.
11. **No write-back** — interop with ComicTagger/Kavita/Komga via ComicInfo `Web`/`Notes`/`GTIN` would require an archive write path that doesn't exist (explicitly out of scope for now).
12. **Licensing posture**: ComicVine = user-supplied key, client-side only, no redistribution; Metron/GCD = CC BY-SA 4.0 with attribution (server may cache/redistribute share-alike); GCD covers excluded.

---

## 3. PWA capability audit

### 3.1 What exists today

**vite-plugin-pwa config** (`apps/web/vite.config.ts:46-91`), plugin v1.2.0:

| Option                                  | Value                                                    |
| --------------------------------------- | -------------------------------------------------------- |
| Mode                                    | `generateSW` (no `strategies` key)                       |
| `injectRegister`                        | `null` — manual registration                             |
| `registerType`                          | `autoUpdate`                                             |
| `devOptions.enabled`                    | `false` — SW never runs in dev                           |
| `workbox.navigateFallbackDenylist`      | `/api`, `/opds`, `/kobo`, `/koreader` (navigations only) |
| `workbox.maximumFileSizeToCacheInBytes` | 6 MB (precache-only limit)                               |
| **Runtime caching**                     | **None** — the SW is precache + navigation-fallback only |

Built output (`apps/web/dist/sw.js`): **399 precache entries** — 382 `.js` (incl. every locale chunk), 12 `.css`, 3 manifest icons, `index.html`, webmanifest; ~21 MB JS. **Zero `.woff2`/`.gif`/`.svg`/`.ico`** — the preloaded Inter font (`index.html:97-103`), splash gif, and fallback SVGs are _not_ precached, so even the app shell is degraded offline.

Registration (`apps/web/src/index.tsx:3,7-28`): `registerSW()` PROD-only, deferred to `requestIdleCallback`. **No `onNeedRefresh`/`onOfflineReady` callbacks anywhere** — no update-available UX; autoUpdate silently `skipWaiting`s, which can strand an open tab whose old lazy chunks were purged mid-session (382 lazy chunks make this a real hazard).

Server side is already correct: `/sw.js` served `Cache-Control: no-cache`, hashed `/assets` immutable + precompressed, `index.html` no-cache (`apps/server/src/routers/spa.rs:22-65`).

### 3.2 Manifest completeness

Built manifest passes Chrome's minimum installability bar (`id`, `name`, `start_url`, `scope`, `display: standalone`, 192+512 icons). Problems:

- **Broken apple-touch-icon**: `index.html:71` references `/assets/favicon-180x180-apple-touch-icon.png`; the actual file is `favicon-apple-touch-icon-180x180.png` — a 404. All three apple links also use invalid `rel="apple-touch-icon image_src"` and a bogus `purpose` attribute on `<link>` (`index.html:69-87`).
- No dedicated maskable icon — the 512 declares combined `purpose: "any maskable"` (`vite.config.ts:86`), so one bitmap serves both and gets cropped in Android's maskable circle. No monochrome icon.
- **No iOS splash** (`apple-touch-startup-image`) — white flash on launch; the in-DOM `stump-splash.gif` isn't precached either, so it's blank offline.
- Missing: `description` (empty), `orientation`, `screenshots`, `shortcuts` (e.g. Continue Reading), `categories`, `share_target`. `background_color: #ffffff` clashes with the dark `theme_color`/UI (white flash on Android).
- Upstream knows: `// TODO(pwa): Add more manifest definitions` (`vite.config.ts:65`).

### 3.3 Offline story: app-shell only

**No client storage for content exists anywhere** — grep for `indexedDB|caches.|localforage|dexie|navigator.storage|BackgroundSync` across browser/web/client packages hits only the SW registration.

- **Comic reader**: pages are plain URL loads — `ImageBasedReader.tsx:129-132` builds `sdk.media.bookPageURL(...)` (`/api/v2/media/{id}/page/{page}`), rendered as raw `<img>` under session auth. Preloading is `new Image()` HTTP-cache warm-up (`hooks/usePreloadPage.ts:30-39`). Nothing survives a reload offline.
- **EPUB**: epub.js downloads the **entire file** from `sdk.media.downloadURL(id)` (`EpubJsReader.tsx:388-398`); the per-resource streaming endpoint in the SDK is unused by the web reader. One cacheable GET per book — convenient for offline, but nothing caches it today.
- react-query is `retry: false` (`packages/client/src/client.ts:9`) with no persister — offline = instant query failure; `useSuspenseGraphQL` hard-fails.
- The user-facing "Download" is an `<a download>` to the OS filesystem (`BookActionMenu.tsx:263-266`) — not usable by the reader.

### 3.4 Reading progress sync

- Transport: GraphQL over `POST /api/graphql` with session cookie. Image reader fires `updateMediaProgress` per page turn with page + elapsed-seconds delta (`BookReaderScene.tsx:84-136`); EPUB fires `updateEpubProgress` with cfi/percentage (`EpubJsReader.tsx:154-160, 231-248`).
- **Failed updates are silently dropped**: `onError` is `console.error` only (`BookReaderScene.tsx:109-111`); EPUB reader has no error handler at all. No retry/queue/offline logic exists.
- A Background Sync approach must intercept `POST /api/graphql` and discriminate by operation name — awkward for a Workbox `BackgroundSyncPlugin`. An **app-level outbox** (IndexedDB queue flushed on `online`/SW `sync`) around `useGraphQLMutation` is the cleaner interception point. Replays are safe: elapsed deltas are additive, page/cfi is last-write-wins.

### 3.5 SW-caching conflicts and risks

- OPDS/Kobo/KoReader: only _navigations_ are denylisted; with no runtime caching, API fetches bypass SW caches today — safe. Any future `runtimeCaching` must exclude these routes explicitly or Kobo sync state could go stale.
- Auth: runtime-cached session responses would outlive logout — a logout hook must purge caches.
- **Ranged requests**: `/api/v2/media/{id}/file` supports Range via tower `ServeFile` (`apps/server/src/utils/serve_media.rs:42-46`); Workbox plain strategies mishandle 206s — epub caching needs `workbox-range-requests` or full-200-only caching. The endpoint also forces `Content-Disposition: attachment` (`:52-57`).
- The 6 MB limit is precache-only; the real constraint for stored issues is Cache API quota — full CBZ/EPUBs are 50–500 MB and **nothing calls `navigator.storage.persist()`**, so browsers may evict everything under pressure.
- Vestigial `cdn.jsdelivr.net` preconnect hints in `index.html:95-96` with zero code references — remove.

### 3.6 What Tauri/Expo owned that the PWA must now own

| Native capability                            | Was                                                                                                             | Web equivalent today                                                                              |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Offline downloads + offline reading          | Expo `app/offline/[fileId]/read.tsx`, `lib/downloadQueue/manager.ts`, `db/downloads.ts` (~1,600 lines, deleted) | **Nothing** — needs IndexedDB catalog + Cache API/OPFS blob store + `navigator.storage.persist()` |
| Credential storage / saved multi-server list | Tauri secure store + saved servers                                                                              | Session cookie auth suffices single-server; multi-server switching is gone                        |
| App icons / splash                           | Tauri icns/ico set, Expo native assets                                                                          | Manifest icons exist but flawed (§3.2); iOS splash missing                                        |
| Discord rich presence                        | Tauri                                                                                                           | Deliberately dropped                                                                              |
| Deep links / custom scheme                   | `stump://` schemes                                                                                              | URL routing suffices; no `share_target`/Web Share usage                                           |
| Badging / notifications                      | Expo scaffolding                                                                                                | None (`setAppBadge`/Notification unused)                                                          |

### 3.7 Practical gap list

**(a) Installability**: fix the 404'd apple-touch-icon filename + invalid `rel` attrs; dedicated maskable 192/512 icons + monochrome; manifest `description`/`screenshots`/`shortcuts`/`orientation`; dark `background_color`; optional `beforeinstallprompt` UX.

**(b) Offline access to downloaded issues**: build the storage layer (IndexedDB catalog + Cache API/OPFS blobs — a web rebuild of the deleted Expo downloadQueue design); "Download for offline" = `cache.addAll` of page URLs (comics) or the single epub GET, SW serves cache-first for those URLs (handle Range); `navigator.storage.persist()` + quota surfacing + logout purge; offline metadata snapshot for downloaded books (persisted query cache or explicit IndexedDB metadata); extend `workbox.globPatterns` to precache fonts/splash so the shell itself is whole offline.

**(c) Background progress sync**: IndexedDB outbox for the two progress mutations, flushed on `online`/SW `sync`; replace silent `onError`; timestamped last-write-wins.

**(d) Icons/splash**: single source-of-truth icon set (current assets are a mix of `favicon-*`/`stump-logo-*` legacy names, incl. a 373 KB `favicon.png` used as the page-error fallback); generate iOS startup images (pwa-asset-generator step); replace `stump-splash.gif` branding; add update-available toast (`useRegisterSW` + `onNeedRefresh`) or a chunk-load-error → reload handler.

---

## Appendix: post-Wave-2 hardening backlog

- **At-rest key management (inherited, Medium):** `server_config.encryption_key` lives in the same SQLite DB as the ciphertexts it protects (`metadata_provider_config.encrypted_api_token`), and is held in memory as a plaintext String. Strong primitive (AES-256-GCM + Argon2 via simple_crypt), weak key location. Now carries a reusable Metron `username:password`, not just scoped API tokens. Fix direction: derive/load the key from an env var or server-side secret outside the DB. Flagged by the Stream E security audit (July 2026).
- Response body-size cap on provider HTTP clients (Info): `response.json()` has no explicit size bound; low practical risk, cheap hardening.
- `stump-logo` cleanup complete; remaining upstream-facing surfaces: crowdin.yml (upstream translation project config, unused by Longbox).
