# ComicVine provider + clean issue titles — design

**Date:** 2026-07-18
**Branch:** `feat/comicvine-provider`
**Status:** Approved to build autonomously (user delegated implementation; approval gate waived per explicit instruction "build it out how you think it fits… I don't want to manage you this run").

## Problem

A scanned comic shows its ugly filename as the display name — e.g.
`Absolute Batman 001 (2024) (digital) (Son of Ultron-Empire)` — because the book
has no metadata and the display falls back to `media.name` (filename-derived).

The GraphQL `media.resolvedName` resolver (`crates/graphql/src/object/media.rs:220`)
**already** prefers `media_metadata.title` and only falls back to `media.name` when
`title` is empty:

```rust
self.metadata.as_ref().and_then(|m| m.model.title.as_ref())
    .unwrap_or(&self.model.name).to_string()
```

So the fix is not a UI change — it's **populating a clean `title`** from a metadata
match. The user also wants a real comics provider (ComicVine) and, since ComicVine's
issue `name` is the _story_ title (usually null for single issues), the clean name
must be **composed** from series + issue number, audiobookshelf-style.

## Decisions (from the user)

| Question                       | Decision                                                                             |
| ------------------------------ | ------------------------------------------------------------------------------------ |
| Clean title format             | `{Series} #{number}` → e.g. **"Absolute Batman #1"** (no zero-pad, raw issue number) |
| Which providers clean the name | **Both ComicVine + Metron**, via the shared apply layer                              |
| Auto-apply                     | **Auto-apply high-confidence** matches during scan (per-provider, threshold-gated)   |
| Preferred provider             | Yes — a configurable provider precedence for tie-breaks                              |
| Diff view                      | Yes — an in-app current-vs-external metadata diff, placement my call                 |
| Live verify                    | Yes — `COMIC_VINE_API_KEY` from `longbox.env`, VPN egress                            |

## Scope

Five parts, built in value order so the highest-value core lands first.

### A. ComicVine provider (`crates/integrations/metadata`)

New `providers/comic_vine.rs`, modeled on `metron.rs`:

- **Auth:** single `api_key` query param (ComicVine token is just the key — no
  username). Every request also sends `format=json` and the mandatory non-browser
  User-Agent already supplied by `default_metadata_client()` (ComicVine 403s bare /
  browser UAs, same as Metron).
- **Base URL:** `https://comicvine.gamespot.com/api`; overridable for wiremock tests.
- **Envelope:** ComicVine signals errors in the _body_, not HTTP status:
  `{ status_code, error, results, number_of_total_results, limit, offset }`.
  `status_code == 1` is OK; `100` = invalid key; `107` = object/rate; `101` = not
  found. `get_json` inspects `status_code` and maps non-1 to the right
  `MetadataProviderError`.
- **Detail endpoints** use the resource-type-id prefix: issue = `/issue/4000-{id}/`,
  volume = `/volume/4050-{id}/`. `results` is an object on detail, an array on list.
- **search_media:** `cv_id` fast-path → `/issues/?filter=issue_number:{n},...` or
  `/search/?resources=issue&query=`; fetch each hit's detail; `score_search`.
  When the query already carries a ComicVine ID (`SearchQuery.comicvine_id`), a
  unique hit is confidence 1.0 (mirrors Metron).
- **fetch_media_metadata / fetch_series_metadata:** issue / volume detail → mapping.
- **validate_credentials:** cheap `GET /publishers/?limit=1`; `status_code 100 ⇒
InvalidCredentials`, `107 ⇒ RateLimited`, JSON-200 ⇒ Valid.
- **Rate limit:** ComicVine is 200/resource/hour + velocity detection. The existing
  `RateLimiter` is per-minute; use a conservative `per_minute(unwrap_or(3))`
  (~180/hr) default. (A proper per-hour limiter is out of scope — noted as follow-up.)
- **Mapping (`map_issue` / `map_volume`):** ComicVine returns `person_credits` roles
  as a **comma-joined string per person** (`"writer, cover"`), unlike Metron's array
  of role objects. So ComicVine needs its own splitter feeding the same role buckets
  (writer/penciller/inker/colorist/letterer/cover/editor, else `artists`). Map
  cover_date → (y,m,d), `volume` → series_name/series_external_id, image →
  cover_url, `site_detail_url` → provider_url, `character_credits`/`team_credits`/
  `story_arc_credits` → characters/teams/story_arc.
- **Tests:** wiremock unit tests mirroring `metron.rs` (envelope status handling,
  role splitting, detail mapping, validate paths) + an `#[ignore]` live smoke.

### B. Provider registration

- Add `ComicVine` to the model enum `MetadataProvider`
  (`crates/models/src/shared/enums.rs`); `supported_library_types → &[Comic]`.
  Serializes to `"COMIC_VINE"` (String column → **no DB migration**).
- Add a **canonical id mapping** on the enum:
  `provider_id(&self) -> &'static str` returning the _trait_ `id()` string
  (`"metron"`, `"hardcover"`, `"comicvine"`), plus
  `from_provider_id(&str) -> Option<Self>`. This is the fix for the auto-apply
  string-mismatch bug (see D).
- Add `"COMIC_VINE" => ComicVineClient::new(...)` to `create_provider`
  (`crates/integrations/metadata/src/lib.rs`) + `providers/mod.rs` export.

### C. Clean-title composition (shared apply layer)

- New helper `compose_comic_title(series_name, number_raw) -> Option<String>` →
  `Some("{series} #{number}")` when both present. Lives in `metadata_integrations`
  (single source of the product format).
- Preserve issue-number fidelity: add `number_raw: Option<String>` to
  `ExternalMediaMetadata`; providers populate it with the _raw_ issue-number string
  (ComicVine `issue_number`, Metron `detail.number`) so "1.MU"/"½" survive
  (the existing `number: Option<f32>` stays for scoring).
- In `apply_media_fields` (`core/src/filesystem/metadata/apply.rs`): when the match
  came from a **comic provider** (gate via `MetadataProvider::from_provider_id(
&candidate.provider)` → `supported_library_types() == [Comic]`) and
  `compose_comic_title` yields a value, use that composed string as the _external
  title_ fed to the Title merge — overriding the (usually empty) story title. Merge
  strategy still governs write (FillGaps fills empty title; matches the screenshot).
- Result: `media_metadata.title = "Absolute Batman #1"` → `resolvedName` shows it
  everywhere `resolvedName` is used (book header, cards).

### D. Auto-apply (high-confidence) + preferred provider

- **Fix the latent auto-apply bug:** `find_auto_apply_candidate`
  (`apply.rs:142`) compares `config.provider_type.to_string()` (`"METRON"`) to
  `candidate.provider` (`"metron"`) — never equal, so auto-apply never fires today.
  Switch to `config.provider_type.provider_id() == candidate.provider`. Un-breaks
  Metron/Hardcover too.
- **High-confidence:** keep the existing `enabled && confidence >= threshold` gate
  (`AutoApplyConfig`, default threshold 0.95). New ComicVine configs default
  `auto_apply = { enabled: true, threshold: 0.95, strategy: FillGaps }` so exact /
  near-exact matches (incl. cv_id = 1.0) clean up titles automatically on scan,
  while ambiguous matches wait for manual review.
- **Preferred provider:** add `position: i32` (default 0) to
  `metadata_provider_configs` via a SeaORM migration. Order providers by
  `(position, id)` in `fetch.rs`, and in `find_auto_apply_candidate` prefer the
  lowest-position provider among those meeting threshold (tie-break). The frontend
  "preferred provider" selector sets a provider to the top position.

### E. Metadata diff view

- Per-book current-vs-external comparison. Data already exists:
  `metadata_fetch_record.match_candidates` (the fetched candidates) +
  current `media_metadata`. Expose via GraphQL (a `metadataMatch`/diff field or
  reuse existing fetch-record query).
- **Placement:** the book **settings** area
  (`packages/browser/src/scenes/book/settings/`) as a "Metadata match" panel
  showing field-by-field current → proposed with per-field apply, plus which
  provider supplied it. (Deeper than the inline metadata editor, discoverable from
  the book's settings.) Exact wiring finalized during implementation after auditing
  any existing match-review UI.

## Non-goals

Manga/AniList, Google Books, a full per-hour rate limiter, bulk re-title of an
existing library beyond what a normal metadata fetch/apply already does.

## Testing

- Rust: wiremock unit tests for the ComicVine client; unit tests for
  `compose_comic_title` and the comic-gated apply; a test proving
  `find_auto_apply_candidate` now matches by `provider_id`.
- GraphQL schema drift: `cargo dump-schema` + `yarn workspace @longbox/graphql
codegen`, commit regenerated output.
- Frontend: jest for new components; `yarn lint`.
- Gates: `ci-preflight` (fmt / clippy -D warnings / schema / cargo test / yarn
  lint / yarn test).
- Live: a `comic_vine_lookup` example run against the real API with
  `COMIC_VINE_API_KEY` from `longbox.env` (VPN egress), confirming the Absolute
  Batman #1 mapping and composed title.

## Risks

- **ComicVine ID-prefix scheme** (4000-/4050-) is well-established but wasn't
  confirmable from the live docs page; validated against the real API in the live
  smoke before relying on it.
- **Auto-apply default on** for ComicVine changes behavior (titles auto-write).
  Mitigated by the high threshold + confined to comic libraries + user-visible in
  provider config.
- **position migration** touches an existing table — additive nullable/defaulted
  column, reversible.
