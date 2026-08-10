# Filename Parser + Image Polish Implementation Plan (Phase 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Manga/comic filename-parser upgrades (chapter tokens, negative issues, `N of M` guard, volume digit cap, year ranges) and image-serving polish (width-whitelisted thumbnail variants, no-store failure responses) — the Phase 3 tail of the approved spec.

**Architecture:** Parser changes are self-contained in `crates/integrations/metadata/src/filename.rs` (hand-rolled scanning, no regex). Image changes touch `apps/server` (query param + cache policy) and `core/src/filesystem/image` (variant generation/lookup). Spec item "SWR on covers" is **already shipped** (`DERIVED_IMAGE_CACHE_CONTROL` carries `stale-while-revalidate=604800` — apps/server/src/utils/http.rs:29-30); no change needed there.

**Tech Stack:** Rust only (no frontend changes; clients opt into `?width=` later).

## Global Constraints

- All prior gates (clippy `-D warnings`, fmt, schema drift, tests). No migrations in this phase.
- Parser stays regex-free and heuristic-only (never written back as fact).
- Width whitelist: `[160, 320, 480, 640]`; anything else is ignored (full-size served) — never an error, never an unbounded cache variant.
- Variant files: `{entity_id}@{width}.{ext}` beside the base thumbnail; downscale-only (`FitWithin` semantics — a 640 request against a 512 base serves 512).
- Failure responses must never be cacheable: new `ImageCachePolicy::Uncacheable` (`no-store`) for the raw-page fallback; `APIErrorResponse` gains `Cache-Control: no-store` on all >=400s.

---

### Task 1: Parser — year ranges + volume digit cap

**Files:** Modify `crates/integrations/metadata/src/filename.rs`

- [ ] Failing tests: `"X-Files (1994-1996) 003"` → year 1994; `"Gold Digger v2024 001 (2024)"` → series keeps nothing stripped by a bogus volume (v2024 is NOT a volume marker; `has_volume_token == false`); `"King Spawn v01"` unchanged.
- [ ] Implement: in `strip_bracketed_groups`, accept a group of exactly `dddd-dddd` (both 1900–2099) and capture the first year. In `is_volume_token` and the standalone `vol N` arm, require the digit run length `1..=3`.
- [ ] Tests pass; commit `feat(metadata): year-range capture + volume digit cap in filename parser`.

### Task 2: Parser — chapter tokens

**Files:** Modify `crates/integrations/metadata/src/filename.rs` (+ `ParsedComicName.has_chapter_token`), check `parseComicFilename` GraphQL exposure (`crates/graphql` — if `ParsedComicName` maps to an output object, add the field + dump-schema + codegen)

- [ ] Failing tests: `"One Piece ch. 1044"` → series "One Piece", number "1044", `has_chapter_token`; `"Berserk Chapter 364 (2021)"` → ("Berserk", "364", 2021); `"Kagurabachi ch077"` → ("Kagurabachi", "77"); `"Chainsaw Man 097"` stays chapter-less.
- [ ] Implement `strip_chapter_tokens` mirroring `strip_volume_tokens`: standalone `ch` / `ch.` / `chapter` / `chap` consume an optional following digit token (which becomes the number when no trailing number exists — thread via marker position: simplest is to REWRITE the marker+digits pair as a bare digits token so `split_series_and_number` finds it, and set the flag); glued forms `ch###`/`chapter###` (digits required; bare `c###` deliberately unsupported — false-positive prone). Trailing bare markers are trimmed from the series like `-`/`#`.
- [ ] Tests pass; commit `feat(metadata): chapter tokens in filename parser`.

### Task 3: Parser — negative issues + `N of M` tails

**Files:** Modify `crates/integrations/metadata/src/filename.rs`

- [ ] Failing tests: `"Zero Hour #-1 (1994)"` → number "-1"; `"Adventures of Superman -1"` → number "-1"; `"Kingdom Come 3 of 4 (1996)"` → ("Kingdom Come", "3", 1996); `"Batman - 1"` unchanged (spaced hyphen still separator).
- [ ] Implement: `parse_issue_number` accepts a leading `-` before digits (normalizing `-01` → `-1`). `split_series_and_number` first checks a trailing `<num> of <num>` triple and uses the first number, dropping all three tokens.
- [ ] Tests pass; commit `feat(metadata): negative issues and "N of M" tails in filename parser`.

### Task 4: `ImageCachePolicy::Uncacheable` + no-store on errors

**Files:** Modify `apps/server/src/utils/http.rs`, `apps/server/src/routers/api/v2/media.rs:106-112`, `apps/server/src/errors.rs:334-363`

- [ ] Failing tests (http.rs test module pattern at :334-360): `Uncacheable` renders `Cache-Control: no-store` and NO ETag (a no-store response must not invite revalidation); `APIErrorResponse` into_response for a 404 carries `no-store`.
- [ ] Implement the variant + constructor `ImageResponse::uncacheable(...)`; switch the media.rs raw-page fallback to it (the failure fallback must be retried next request, not cached for 10 minutes); add the header in `APIErrorResponse::into_response` for all error statuses.
- [ ] `cargo test -p longbox_server`; commit `fix(server): failure images and error responses are never cacheable`.

### Task 5: Width-whitelisted thumbnail variants

**Files:** Modify `apps/server/src/routers/api/v2/{media,series,library}.rs` (add `Query<ThumbnailParams>` with `width: Option<u32>`), `core/src/filesystem/image/thumbnail/{generate.rs,utils.rs}` (variant generate/lookup/cleanup), `core/src/filesystem/common.rs` (variant-aware `get_thumbnail`)

**Interfaces:**

- `pub const THUMBNAIL_VARIANT_WIDTHS: [u32; 4] = [160, 320, 480, 640];`
- `pub async fn get_or_generate_thumbnail_variant(thumbnails_dir, entity_id, width, base_bytes_provider) -> Result<(ContentType, Vec<u8>)>` — cache file `{id}@{w}.webp`; on miss, resize the BASE thumbnail bytes (FitWithin{w, u32::MAX} semantics via existing `resize_scaled`/`WebpProcessor`) and persist.
- Handlers: unwhitelisted or absent `width` → exactly today's behavior. Whitelisted → variant path, falling back to full bytes on any variant error (never fail a request over a variant).
- `remove_superseded_thumbnail` (generate.rs:113-168) additionally removes `{id}@*` files so a regenerated base invalidates its variants.

- [ ] Failing tests: variant file created on first request-shaped call and reused on second (core-level test around the new fn, no HTTP needed); unwhitelisted width is a no-op; superseded cleanup removes variants.
- [ ] Implement core fn + handler param threading (3 routes).
- [ ] `cargo test`; commit `feat(server): width-whitelisted thumbnail variants (?width=160|320|480|640)`.

### Task 6: Full gate + PR

- [ ] `ci-preflight` green; push `feat/parser-image-polish`; PR "feat: parser tokens + image polish" (note: no migrations this phase; SWR spec item already shipped pre-phase).

## Self-Review Notes

- Spec coverage: parser items → T1–T3; images (a) → T5, (b) → already shipped (documented above), (c) → T4. Frontend `?width=` adoption deliberately deferred (URL builders in sdk emit bare URLs; a follow-up can thread widths per grid context).
- Names consistent: `has_chapter_token`, `THUMBNAIL_VARIANT_WIDTHS`, `{id}@{w}.webp`, `ImageCachePolicy::Uncacheable`.
