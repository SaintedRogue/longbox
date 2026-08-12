# Pull request archive

Every pull request merged into Longbox, captured on 2026-08-12 before the
repository left the `stumpapp/stump` fork network.

Leaving a fork network deletes the fork's pull requests — commit history survives,
but the reasoning recorded in PR descriptions does not. This file is that reasoning.

Merge commits are listed so each entry can still be tied to the history.

**Numbering caveat:** the `#N` here are the original numbers, referenced by merge
commit messages. After detachment those numbers are free to be reused, so a future
`#49` will not be the one described below.

---

## #1 — fix: green the inherited Stump Checks CI (3 pre-existing failures)

- state: MERGED · merged 2026-07-17 · `f7783ae1`
- author: SaintedRogue

Pushing the Unraid/GHCR deployment work to \`main\` finally _ran_ the inherited \`Stump Checks CI\` (its Rust jobs had no self-hosted runner until now, so it had been dormant/\`action_required\`). It surfaced three **pre-existing** failures unrelated to the deployment — this PR fixes all three.

- **Rust checks** — \`setup-rust\` skipped system-deps on self-hosted runners (assumed pre-provisioned); ours isn't, so \`cargo clippy\` failed on \`openssl-sys\`. Install the C build deps (openssl/sqlite/pkg-config/cmake) on self-hosted Linux, matching the Dockerfile builder.
- **TypeScript lint** — \`eslint-plugin-react-hooks\` v7 errors on TanStack Table's \`useReactTable()\` (\`react-hooks/incompatible-library\`), used intentionally in 13 places. Turn that (unfixable) rule off. Verified locally: the previously-failing table files now pass \`eslint\`.
- **Docs build** — three links to \`/docs/apps/mobile\` (the removed Expo app) broke the prerender. Remove the obsolete install sentence + two OPDS-client rows.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

---

## #2 — Fix mobile: fit-to-width reading + cover loading behind a reverse proxy

- state: MERGED · merged 2026-07-17 · `b13c7e0c`
- author: SaintedRogue

Fixes two unrelated bugs surfaced when running Longbox on mobile behind NGINX Proxy Manager. Neither was in the recent mobile-optimization work.

## ① Blank covers / "pages won't load" (reverse-proxy config)

Cover/thumbnail/OPDS URLs are **server-generated absolute URLs** (GraphQL returns a fully-qualified `thumbnail` built from `ServiceContext.url()`, host resolved by `resolve_host` in `apps/server/src/middleware/host.rs`). With `trust_proxy_headers` off (the default), a proxied server ignores `X-Forwarded-Proto`, assumes a direct connection, and stamps its internal `:10801` port onto those URLs. The browser then can't reach `https://host:10801/…` through the proxy → `ERR_CONNECTION_REFUSED`, so **every cover shows blank** even though pages themselves load (reader page images are SDK-built same-origin, so they were unaffected).

- Ship `STUMP_TRUST_PROXY_HEADERS=true` by default in the Unraid template.
- Document the reverse-proxy setup (and when to turn it back off) in `deploy/unraid/README.md`.

## ② "Reading severely cut off" (mobile reader CSS)

The paged reader defaulted to fit-**height** with a hardcoded `100vh`. On a phone that renders a portrait page wider than the screen (~150px sliced off each side) and `100vh` hides the bottom behind the browser toolbar.

- `useBookPreferences`: coerce `imageScaling.scaleToFit` -> `Width` on mobile viewports.
- `PageSet` / `ContinuousScrollReader`: `100vh` -> `100dvh` (and `max-h-screen` -> `max-h-[100dvh]`).
- `ReaderSettings`: hide the image-scaling selector on mobile (no-op there now).
- New `useBookPreferences` test covering the mobile/desktop scaling branch.

## Verification

- Root cause confirmed with live network/DOM evidence on the deployed site (thumbnails 404 at `:10801`; GraphQL/reader pages fine same-origin).
- Reader fix confirmed by applying the exact new fit-to-width styles to the live page — the whole comic became visible where it was cropped.
- `tsc -b` clean (full `--force` rebuild), ESLint clean, 20 reader tests pass (incl. the new one), production `vite build` succeeds.

## Deploy note

`STUMP_TRUST_PROXY_HEADERS=true` also needs setting on the **already-running** container (Edit -> add Variable -> Apply) for the immediate cover fix; the reader change ships once this merges and CI rebuilds `:latest`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

---

## #3 — docs: rebuild README + docs in the Longbox Archivist voice

- state: MERGED · merged 2026-07-19 · `500aa9f5`
- author: SaintedRogue

## What & why

Rebuilds the README and the full documentation set around a distinctive, codified voice that captures Longbox's ethos — _your comics, bagged, boarded, and served, on your own hardware_ — while de-Stumping inherited references throughout. **No product code is touched** (docs + README only).

## The voice, codified

New source-of-truth: **`docs/longbox-voice-notes.md`** — the "Longbox Archivist" verbal identity (the companion to `longbox-design-notes.md`). It defines the lexicon (metaphor _seasons_ but never renames real product nouns), the six fixed caption-box labels (`MINT CONDITION`, `BAGGED & BOARDED`, `PULL LIST`, `HOUSE RULES`, `CONTINUITY`, `FROM THE LONGBOX`), register rules (loud comic-shop register only in the README hero), and hard-don'ts.

## Scope of the rewrite

- **README** — full voice; banner, badges, all commands, and the License & Attribution section preserved byte-for-byte.
- **Overview + section landings** — full voice; the original author's first-person "I" reframed to the project "we".
- **~37 deep guides** — voiced _framing_ (intro + section names + callout labels) with **clean, neutral step-by-step bodies**. Commands, env vars, permission strings, API endpoints, and provider names are byte-for-byte intact.

## De-Stumping

- Functional stale links repointed to `SaintedRogue/longbox`: "open an issue" CTAs, the roadmap, release/source/AUR install links, and theme/font contributor source links. The misleading upstream star-history chart was dropped.
- **Deliberately preserved:** the fork-of-Stump credit, the MIT `LICENSE`, attribution links, and 10 specific upstream issue-number citations (repointing those would fabricate wrong links).

## Verification

- `fumadocs-mdx` compiles every MDX page; the **full `vite + nitro + prerender` docs build succeeds**.
- No product/source files changed; no broken internal links; CI's frontend gate outcome is unchanged (docs `.mdx` isn't linted, and zero linted files changed).
- Built via subagent-driven development: a fresh implementer per batch, an adversarial spec+quality review after each, and a whole-branch review at the end. Design/plan artifacts under `docs/superpowers/`.

## Known follow-up (not in this PR)

`readers.mdx` still contains a pre-existing off-voice "Wow, such empty. Much sad." placeholder blockquote (out of the rewrite's touch scope).

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01TjLSJsv4y6yfKDaoQKsZDk

---

## #4 — feat: ComicVine metadata provider + clean composed issue titles

- state: MERGED · merged 2026-07-19 · `e00934bc`
- author: SaintedRogue

## Summary

Adds **ComicVine** as a metadata provider and makes matched comics display clean,
audiobookshelf-style titles — `{Series} #{number}` (e.g. `Absolute Batman #1`) —
instead of the raw filename. Also fixes a latent auto-apply bug, adds a
preferred-provider setting, and tunes issue matching so the exact issue ranks first.

Motivation: a scanned book showed `Absolute Batman 001 (2024) (digital) (Son of
Ultron-Empire)` (its filename) because it had no metadata. `media.resolvedName`
already prefers `media_metadata.title` over `media.name`, so the fix is to
populate a clean title from a provider match.

## What's included

**ComicVine provider** (`crates/integrations/metadata/src/providers/comic_vine.rs`)

- `api_key` auth, ComicVine `status_code` envelope handling, `4000-`/`4050-`
  detail endpoints, comma-joined role parsing, cv_id exact-match, server-side
  credential validation.
- Registered in the `MetadataProvider` enum + `create_provider` factory + the
  provider setup UI (label, logo, server-side validation).

**Clean composed titles**

- Comic providers (ComicVine **and** Metron) compose `media_metadata.title` as
  `{Series} #{number}` in their mapping (`compose_comic_title`), preserving raw
  issue numbers via a new `number_raw` field. `resolvedName` surfaces it, so no UI
  change was needed for display.

**Auto-apply fix + preferred provider**

- Fixes a latent bug where auto-apply never fired for _any_ provider (it compared
  enum Display `"METRON"` against candidate id `"metron"`); added the canonical
  `MetadataProvider::provider_id()`.
- New provider `position` column (migration) + preferred-provider tie-break in
  `find_auto_apply_candidate`; providers are queried in position order. New comic
  providers default to auto-apply for high-confidence matches.

**Exact-issue ranking (scorer + retrieval)**

- The scorer now matches the query's series against the candidate's `series_name`
  and weights the issue number: `+bonus` on match (exact series + number clears the
  0.95 auto-apply floor), `−penalty` on mismatch.
- Adds a ComicVine volume→issue retrieval path — free-text `/search` has poor
  recall for a specific issue, so it resolves the series' volume by name then
  fetches the exact issue by `(volume, issue_number)`, falling back to `/search`.

**Frontend**

- ComicVine registered in provider setup; a preferred-provider selector in the
  providers settings section. The metadata **diff view** (Current → External →
  Resolved) already existed in server/library metadata settings and now shows the
  composed title truthfully.

## Verification

- Rust: `cargo fmt` / `clippy -D warnings` / schema-drift / `cargo test` — green
  (metadata 78, core 206, graphql 83).
- Frontend: `eslint` / `prettier` / `check-types` / `jest` (346+) — green.
- **Live-verified against the real ComicVine API**: `Absolute Batman` #1 →
  `Absolute Batman #1` at **0.96** confidence, ranked first, full metadata mapped
  (Snyder / Dragotta / Martin, cover date, characters).

## Notes

- ComicVine's API is **non-commercial use only** — fine for self-hosting; noted in
  code.
- Auto-apply defaults on for comic providers (high threshold, comic libraries only).

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01TU7fXiwCBiCsoyqtM4UN7U

---

## #5 — fix(ci-preflight): initialize FAILED array so summary works when all gates pass

- state: MERGED · merged 2026-07-19 · `75496e95`
- author: SaintedRogue

## Problem

`scripts/preflight.sh` runs `set -u` and declares the failure tracker with
`declare -a FAILED` (no assignment). Under `set -u`, a declared-but-unassigned
array is treated as unset, so the summary's `${#FAILED[@]}` throws
`unbound variable` and the script exits 1 — but **only when every gate passed**
(the array was never appended to). Net effect: a fully-green preflight reports
`✗ preflight FAILED`.

## Fix

Initialize the array empty: `declare -a FAILED=()`.

## Verification

The change only touches `.claude/**`, which matches neither path filter, so the
script skips all gates and goes straight to the summary — the exact failure
scenario. After the fix it prints `✔ preflight passed — safe to push` and exits
0 (was: `unbound variable`, exit 1). `bash -n` clean.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01TU7fXiwCBiCsoyqtM4UN7U

---

## #6 — fix(web): point server-settings + version links at the Longbox repo

- state: MERGED · merged 2026-07-19 · `799cf665`
- author: SaintedRogue

The server settings still linked to `stumpapp/stump`. Points the user-facing repo
links at the fork instead:

- **Server info** (`ServerInfoSection.tsx` `REPO_URL`) — used by the _Semantic
  version_ and _Exact commit_ links.
- **Helpful links** _GitHub_ link (`HelpfulLinks.tsx`) — Documentation + Changelog
  were already Longbox.
- **Sidebar app-version** link (`ApplicationVersion.tsx`).

The _Exact commit_ / build SHA was already surfaced (`env!("GIT_REV")` from
`apps/server/build.rs` → the `rev` field); this just makes its link point at the
right repo.

Left unchanged (per CLAUDE.md attribution): `LICENSE`, the "fork of Stump" credit,
and dev comments referencing real upstream issue numbers.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01TU7fXiwCBiCsoyqtM4UN7U

---

## #7 — feat(metadata): per-issue Find metadata match + filename query parsing

- state: MERGED · merged 2026-07-19 · `68655238`
- author: SaintedRogue

## Why

Diagnosing "nothing matches on my library" surfaced two root causes: metadata
matching is a **separate action from a library scan**, and — the real blocker —
filename-only libraries (no `ComicInfo.xml`) have empty `media_metadata`, so the
providers were handed the whole messy filename (`Absolute Batman 001 (2024)
(digital) (Son of Ultron-Empire)`) as the series/search term and matched nothing.
This adds both the missing per-issue entry point **and** the filename parsing that
makes matching actually work.

## Backend

- **`metadata_integrations::parse_comic_filename`** (new, pure + unit-tested):
  strips bracketed cruft, pulls a year, and treats the trailing token as the issue
  number → `{ series: "Absolute Batman", number: "1", year: 2024 }`.
- Wired as a **last-resort fallback into both query builders** — `fetch::enrich`
  (on-demand path) and the `fetch_job` bulk path — so empty `media_metadata` no
  longer sends the raw filename. Heuristic only; **never written back** to
  `media_metadata` (matches the "embedded truth vs derived-for-search" split).

## Frontend

- **"Find metadata match"** action in the book detail Metadata section: calls the
  existing `fetchMediaMetadata(id)` for just that issue, then opens the existing
  **review dialog** (Current → External → Resolved) to pick + apply
  (`acceptMediaMatch`), or reports that a high-confidence match was auto-applied.
  Reuses the metadataMatching store/dialog — **no schema change** (regenerated TS
  client only).

## Verification

- Rust: `fmt` / `clippy -D warnings` / `cargo test` — parser (6) + fetch fallback (2).
- Frontend: `eslint` (react-compiler clean) / `check-types` / `jest` (346).
- **Live** against ComicVine: the raw `Absolute Batman 001 (2024) …` filename now
  resolves to **`Absolute Batman #1` at 0.96 confidence**.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01TU7fXiwCBiCsoyqtM4UN7U

---

## #8 — feat(metadata): configurable in-issue search UI + series matching

- state: MERGED · merged 2026-07-19 · `332b0e7e`
- author: SaintedRogue

## What & why

Adds a **configurable metadata-search UI inside the book/issue page**. The
server-side filename parser pre-fills editable fields — you can refine them
before searching, and search either **this issue** or its **whole series**.

Motivating context: a filename-only library kept showing "no match." That
turned out to be an environment problem on the deployment (a bad stored
ComicVine credential + an unreachable Metron), not the parser — but the old
per-issue button gave no way to tell a _genuine_ no-match from a dead key, and
no way to correct a query the parser split wrong. This feature closes both gaps.

## Backend

- **`MetadataSearchInput`** — optional per-field overrides (`title`, `number`,
  `year`, `publisher`). A value the user supplies overrides the auto-derived
  `SearchQuery`; a blank/absent field falls back to metadata/filename
  enrichment, which only fills empty fields — so the override needs no new
  branching in core, it just pre-sets `Some(...)`.
  - A `title` override sets **both** `title` and `series_name` so every provider
    honors it (ComicVine matches on `series_name`, Metron on the `title` term).
- **`fetchMediaMetadata(id, query?)` / `fetchSeriesMetadata(id, query?)`** —
  accept the override; behavior is unchanged when `query` is omitted.
- **`parseComicFilename(name): ParsedComicFilename`** — exposes the existing
  parser over GraphQL so the UI seeds its fields from the _same_ logic that
  drives auto-matching (no duplicated parsing on the client).
- `core::fetch_series_metadata` gains a `year_override`.

## Frontend

- **`BookMetadataMatch`** rewritten from a fire-and-forget button into a Popover
  form: an Issue/Series scope toggle, parser-seeded editable fields, and a
  Search action. Results open the existing review dialog (reused, no new review
  UI); when nothing opens, the toast is **status-aware** — no-match vs
  auto-applied vs rate-limited — instead of one opaque message.

## Tests / gates

- `cargo fmt`, `cargo clippy -D warnings`, `cargo dump-schema --check` (no
  drift), `cargo test` — all green. New unit test covers the override
  trim/blank→None semantics.
- `yarn lint` (eslint + prettier + check-types) and `yarn test` (346/346) green.
- Regenerated GraphQL SDL + TS client are committed.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

---

## #9 — feat(metadata): interactive per-provider search & compare-grid match

- state: MERGED · merged 2026-07-19 · `e187352f`
- author: SaintedRogue

## What & why

Audiobookshelf-style **interactive metadata matching**. Instead of a
fire-and-forget "search all providers," you now: pick an **enabled provider**,
refine a parser-seeded query, **search a single provider**, compare the returned
results **side-by-side with confidence**, and **select** the right one. Reachable
from an **issue** and from a **series** action menu.

Extends the on-demand search from PR #8 (parser-prefilled fields + per-field
overrides) with provider selection + a compare-grid results view.

## Backend (additive)

Two optional args on the existing fetch mutations — behavior is unchanged when
omitted:

- `provider: MetadataProvider` — scope the search to ONE provider (default: all
  enabled). Core filters `provider_configs` to that provider.
- `autoApply: Boolean` (default `true`) — the interactive dialog passes `false`
  so the fetch record stays `AWAITING_REVIEW` and the user can accept **any**
  candidate. Without it, a ≥threshold top match auto-applies (status →
  `Fetched`) and blocks re-selection.

`core::fetch_media_metadata` / `fetch_series_metadata` gain matching
`provider_filter` + `auto_apply` params. No metadata-type changes —
`ExternalMediaMetadata.coverUrl` / `ExternalSeriesMetadata.coverUrl` were already
exposed (ComicVine populates them), so result cards show covers.

## Frontend

- **`ProviderMatchDialog`** — a self-contained, controlled Dialog (`{kind, id}`)
  that fetches its own context, seeds fields via `parseComicFilename`, lists
  enabled providers, searches the chosen one, and renders a **compare-grid** of
  result cards: cover, title, subtitle (year · publisher · credit), provider,
  `ConfidenceBadge`, and **Select**. Select → `acceptMediaMatch` /
  `acceptSeriesMatch`. Works for media and series.
- **Issue entry**: `BookMetadataMatch` now opens this dialog (replacing PR #8's
  popover).
- **Series entry**: a "Find metadata match" item in the `SeriesHeader` action
  menu.

Reuses `ConfidenceBadge`, the accept mutations, and `parseComicFilename`. The
one-at-a-time `MatchReviewDialog` stays for the auto-fetch review flow.

## Gates

`cargo fmt` / `clippy -D warnings` / `dump-schema --check` / `cargo test`, and
`yarn lint` + `yarn test` (346/346) all green locally. Regenerated GraphQL SDL +
TS client committed. Design doc: `docs/superpowers/specs/2026-07-19-interactive-provider-match-design.md`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

---

## #10 — feat(organizer): provider-confirmed loose-file organizer (backend + UI)

- state: MERGED · merged 2026-07-20 · `9afc6543`
- author: SaintedRogue

## Loose-file organizer

Fixes loose comic files collapsing into a junk root series (the `Jays of Future Past` → `data` problem). Longbox derives series from folders, so files sitting loose at a library root all fold into one series named after the root. This adds a provider-confirmed organizer that detects those files, confirms each one's canonical series via the metadata provider (keyed on volume ID), moves it into a `Name (Year)/` folder, and re-points its media record — **preserving read progress**.

### Backend

- **`core/src/filesystem/organizer/`** — pure, unit-tested logic (path sanitization, filename grouping, confidence bucketing, pattern-aware candidate detection) + DB/provider-aware `build_plan` (preview) and `apply_plan` (transactional move + media re-point).
- **`OrganizeLooseFilesJob`** with three modes: `Plan` (build a preview), `Apply` (execute chosen moves), `AutoScan` (opt-in, cached-matches-only, applied automatically after a scan).
- **GraphQL surface:** `planOrganizeLooseFiles` / `applyOrganizeLooseFiles` mutations, `organizePreview` query, and an `autoOrganizeLooseFiles` per-library config toggle.
- **DB:** migrations for the config column and an `organize_plan_record` table.

Confidence tiers make automation safe: **Confident** matches move; **Ambiguous** are surfaced for review; **Unmatched** files are left untouched. The auto-on-scan path only ever applies the Confident bucket, using cached matches (no live provider calls in the scan hot path).

### Frontend

- A **Settings → Organizer** tab with the auto-organize toggle and an **Organize loose files** dialog: scan → review the proposed moves (include/exclude, Confident pre-checked, Ambiguous flagged) → apply. Unmatched files are shown read-only. Preview refresh is driven by the existing job-event subscription.

### Safety & review

Every task passed an individual spec + quality review. The whole-branch reviews additionally found and fixed:

- an **IDOR** — organize resolvers now scope to user-visible libraries via `find_for_user`;
- an **arbitrary-file-move** — `apply_plan` now validates each source path is inside the library root (canonicalized `starts_with`);
- a **transactional-consistency** bug — a post-move DB failure now compensates (moves the file back) instead of stranding it;
- a **cross-library series-merge** bug — external-id merge is now library-scoped.

### Verification

- Rust: `cargo fmt` / `clippy -D warnings` / `dump-schema --check` / `cargo test` (incl. new organizer unit + in-crate DB tests).
- Frontend: `yarn lint` (check-types across 5 projects) / `yarn test` (349 browser tests incl. a `toDecisions` unit test) / production `@longbox/web` build.

### Remaining before release

- **Live end-to-end run** (Playwright driving toggle → scan → review → apply) was not run here — it needs a running server + a reachable provider (Metron is IP-banned on this egress; ComicVine/cached is the fallback).
- A few Minor polish items are tracked (e.g. the "Scanning…" spinner can stick if a plan job _fails_ mid-session).

Specs/plans: `docs/superpowers/{specs,plans}/2026-07-19-loose-file-organizer-backend*` and `…/2026-07-20-loose-file-organizer-frontend*`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01TU7fXiwCBiCsoyqtM4UN7U

---

## #11 — fix(organizer-ui): un-stick scan spinner on failed plan + valid checkbox ids

- state: MERGED · merged 2026-07-20 · `fdc74b43`
- author: SaintedRogue

Follow-up polish on the loose-file organizer UI (#10).

- **Stuck "Scanning…" spinner:** it previously cleared only when the plan job invalidated the preview (success path). A **failed** plan job (realistic when a provider is unreachable — Metron is IP-banned on this egress) emits no `JobOutput`, so the indicator stuck until the dialog was reopened. Now it keys off the job leaving the global job store, which fires on completion **or** failure.
- **Checkbox ids:** row `CheckBox` used the raw file path (spaces/slashes) as the DOM `id`; now derived from a sanitized path.

Verified: `check-types`, `toDecisions` unit test (3/3), `yarn lint` all green.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01TU7fXiwCBiCsoyqtM4UN7U

---

## #12 — fix(metadata): never contact Metron for credential validation

- state: MERGED · merged 2026-07-20 · `63c4eda7`
- author: SaintedRogue

Metron's gateway hands out 24-hour bans to clients that probe it, and the app was validating Metron credentials automatically — the create/edit provider form re-validated on **every debounced keystroke**, plus a Metron-only "Test" button. That's the ban risk. Removed entirely:

- **Server guard** (`run_validation`): short-circuits Metron to an `Unsupported` result **without making any request** — so no caller (UI or raw API) can make the server probe Metron.
- **Provider form** (`ProviderApiKeyInput`): no longer auto-validates Metron; shows a "verify manually" note.
- **Provider card** (`ExistingProviderCard`): drops the Metron-only Test button.

ComicVine / Hardcover validation is unaffected. Verify Metron credentials out-of-band.

**Note on scope:** this removes the _validation/connection-check_ paths. Metadata _searches_ still contact Metron if it's an enabled provider (that's a user-initiated fetch, not a check). To keep the app from ever reaching Metron at all, disable/delete the Metron provider — or ask and I'll exclude it from the search fan-out too.

Verified: cargo clippy / `dump-schema --check` (no schema change) / cargo test; yarn lint / check-types / provider test.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01TU7fXiwCBiCsoyqtM4UN7U

---

## #13 — feat(organizer): scan library root only (defer catch-all subfolder detection)

- state: MERGED · merged 2026-07-20 · `179b3491`
- author: SaintedRogue

A dry run of candidate detection against a real, well-organized library showed the "catch-all subfolder" rule over-firing: the filename parser reads `v01`/`v02` volume markers and `Annual`/`Noir Edition` variants as _distinct series_, so tidy folders (`King Spawn (v01-v03)`, `Absolute Batman (2025)`, several Omnibus folders) got wrongly flagged — ~78 files that would churn an already-organized library.

**Fix:** scan the **library root only**. Files loose directly at the root are the common, safe target; subfolders are left untouched. Catch-all detection is deferred until the parser is volume/edition-aware.

Verified: 21 organizer tests pass (candidate tests rewritten for root-only), clippy clean. No schema/frontend change.

Follow-ups (tracked): parser flexibility for subfolder catch-all detection; "target a specific file/folder" scoping; a longer-running background organize pass.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01TU7fXiwCBiCsoyqtM4UN7U

---

## #14 — feat(organizer): parser volume/edition flexibility + opt-in catch-all subfolders

- state: MERGED · merged 2026-07-20 · `02c402b5`
- author: SaintedRogue

Follow-up to root-only (#13). Brings subfolder scanning back safely.

**Parser** (`filename.rs`): strips volume markers (`v01`, `vol 1`, `volume 1`) from the series — `King Spawn v01/v02/v03` collapse to `King Spawn`. Helps grouping, provider search, and catch-all alike. A bare `V` (as in `V for Vendetta`) is not stripped.

**Catch-all** returns, but:

- **Opt-in per library** via a new `organize_catchall_subfolders` toggle (default OFF) in the Organizer settings tab. Root-only stays the safe default.
- **Sturdier heuristic:** a folder is a "dump" only if a _majority_ of its files don't belong to the folder's own series-family (`series_family_key` folds editions/annuals — Noir Edition, Deluxe, Facsimile, 2025 Annual — for this check only, never for real grouping/foldering). This leaves tidy folders (main run + Annual + Noir Edition + spin-off) alone.

**Validated against a real library** (host dry-run): root-only = exactly 5 loose root files; catch-all ON = **0 of 29** organized folders flagged.

Verified: 87 metadata tests, 23 organizer tests, 9 filename tests, clippy, `dump-schema --check`, yarn check-types/lint, fmt.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01TU7fXiwCBiCsoyqtM4UN7U

---

## #15 — feat(organizer): targeted organize — right-click a file/folder to file it into a series

- state: MERGED · merged 2026-07-20 · `e2c4102b`
- author: SaintedRogue

## Targeted organize — right-click a file or folder to file it into a series

Third item on the loose-file-organizer roadmap (after #13 root-only scan and #14 parser flexibility): let users organize **one file or folder on demand** instead of running a whole-library plan.

**Right-click a file or folder in the library file explorer → "Organize into series" → a scoped preview → Apply.** The preview reuses the same review-and-apply rows as the library-wide organizer, but scoped to just the target. Works on both files (the file itself) and folders (its direct loose media — no "is this folder a dump?" heuristic, because you pointed at it deliberately).

### Backend

- `scoped_candidate_files` (`candidates.rs`) — a file → itself; a folder → its direct, non-ignored media, with no dump gate.
- `build_plan_scoped` + an `assemble_plan` refactor (`plan.rs`) — the library-wide `build_plan` and the scoped path now share one core. Move **destinations still land at the library root** (`<root>/Series (Year)/`); scoping only restricts the _candidate set_.
- `organizePreviewForPath(libraryId, path)` GraphQL query (`query/organize.rs`) — synchronous live provider lookup, **not persisted** (never disturbs the library-wide plan record). `ScanLibrary`-gated, `find_for_user`-scoped, with `canonicalize` + component-wise `starts_with(root)` path containment on the client-supplied path. The scan runs on the client path (same base as `media.path` rows) so moved records re-point correctly even under a symlinked library root.

### Frontend

- `organizeMoves.tsx` — extracted `toDecisions` / `MoveRow` / `PreviewRows` from the library-wide dialog so both dialogs share one renderer (no duplication).
- `ScopedOrganizeDialog.tsx` — lean, no-scan-button dialog: query on open → default-check Confident moves → Apply. Focus-refetch disabled so a slow, rate-limit-sensitive provider lookup never re-fires on window focus.
- Explorer wiring — `ContextMenu` on grid items and the table name-cell; `onOrganize` / `canOrganize` (computed once, `ScanLibrary`-gated) threaded through `ExplorerContext`; the scoped dialog owned by the provider.

### Verification

- Rust: `fmt`, `clippy -D warnings`, `dump-schema --check`, `cargo test` (26 organizer tests, incl. 3 new scoped-candidate tests) — all green.
- Frontend: `check-types`, `lint`, `toDecisions` unit test — all green.
- Whole-branch adversarial review: path-containment, authorization, the `assemble_plan` refactor, and the React hooks all confirmed sound; both surfaced Minor issues (symlinked-root media identity; focus-refetch) fixed in this branch.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01TU7fXiwCBiCsoyqtM4UN7U

---

## #16 — feat(organizer): manual series search — fix unruly-filename matches by hand

- state: MERGED · merged 2026-07-20 · `1eaabf9e`
- author: SaintedRogue

## Manual series search for the organize flow

When an unruly filename ("Jay and Silent Bob") comes back **unmatched** in the organizer, you can now fix it by hand. From **any** organize preview row (Unmatched, Ambiguous, or to override a wrong Confident match), click **"Find match"** → a launched picker lets you **edit the series query, pick a provider, Search, and Select** the correct series. Your pick files that file correctly on Apply.

Fourth item on the loose-file-organizer roadmap (after root-only scan #13, parser flexibility #14, targeted organize #15).

### How it works

The organizer matches loose files to series fully automatically today; there was no way to intervene when the parser mis-split a name or the best provider hit scored under the confidence floor. This adds a manual escape hatch that reuses the metadata-match compare-grid UI and the existing organize apply path.

**Backend**

- `search_series_candidates` gains an optional single-provider filter (auto-organize path unchanged — passes `None`).
- New `organizeSearchSeries(libraryId, title, year, provider)` GraphQL **query** — `ScanLibrary`-gated, `find_for_user`-scoped, and **non-persisting** (writes no `metadata_fetch_record` for a series that doesn't exist yet). No new apply logic: a manual pick becomes an override keyed by the file's `src`, which rides the existing `applyOrganizeLooseFiles` decision path.

**Frontend**

- Extracted a shared, backend-agnostic `MetadataSearchPanel` from the shipped `ProviderMatchDialog` (editable query + provider picker + compare-grid) — the per-issue match flow is behavior-unchanged (accept-by-index preserved).
- New `OrganizeSeriesMatchDialog` picker + per-row "Find match" button + override state + a `toDecisions` merge, wired into **both** the scoped and library-wide organize dialogs (shared `organizeMoves`).

**Metron safety (standing rule):** the picker never auto-searches — a provider is contacted only on an explicit Search click, and the picker waits for the provider list to load before mounting so a cold-open Search can never silently fall through to "all providers."

### Quality

- Built subagent-driven: 6 tasks, each implemented + reviewed (spec + code quality), plus a final whole-branch review (opus).
- Reviews caught and fixed: series-metadata union narrowing (no empty series name can reach Apply), search-error surfacing, and the cold-open all-provider default.
- Gates: `fmt`, `clippy -D warnings`, `dump-schema --check`, `cargo test` (workspace), `check-types`, `lint`, `yarn test` — all green. `toDecisions` merge is unit-tested (override-wins / promote-unmatched / unchecked-noop).

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01TU7fXiwCBiCsoyqtM4UN7U

---

## #17 — feat(library): standalone books and metadata-driven virtual grouping

- state: MERGED · merged 2026-08-09 · `90c541d6`
- author: SaintedRogue

Books left loose in a library root all collapse into one series named after that
directory — a library at `/data` grows a series called `data` holding 139 of 609 books.
The scanner does this deliberately (`walk_library` uses `min_depth(0)`) and re-derives it
on every scan, so no amount of metadata work can split it.

**⚠️ Merging this is also an operational fix.** The migration is already applied on the
production database, and Longbox migrations are forward-only in practice: an older binary
hard-panics on boot against a migrated DB, even for purely additive schema changes. GHCR's
`:latest` currently holds a pre-migration build, so an Unraid update pulls a binary that
cannot start. Merging republishes `:latest` from this branch and closes that.

## Phase 1 — standalone books (no migration)

The bucket is identified **structurally** — a series whose `path` equals its own library's
`path` — so there is no column to backfill and it stays correct after every future scan.

The exclusion is applied **per call site, not centrally**, because there is no single
chokepoint that works. `crates/models/src/entity/series.rs` defines two `find_for_user`
functions, and the series grid and `seriesById` share one of them but need opposite
behaviour: filtering `seriesById` would drop the library breadcrumb from every affected
book page. So `series`, `numberOfSeries` and `recentlyAddedSeries` filter; `seriesById`
deliberately does not.

Also fixes a per-book leak: `BookOverviewContent` rendered "Next in series"
unconditionally, and `nextInSeries` walks `series_id`, so every loose book showed a rail of
unrelated books drawn from the bucket.

## Phase 2 — virtual grouping (2 additive migrations)

`book_groups` is a shelf with no path and no directory. Membership lives on
`media.book_group_id`; `media.series_id` always stays pointed at the folder the file is
really in, so joins, library scoping and `library_config` resolution are untouched.
Standalone is **derived** (no shelf, series is the bucket), never stored.

Detection is offline and synchronous — no provider calls, no job queue. The
provider-confirmed organize job that already ships ran **917 seconds against this same
library before failing**; this runs in **0.11s**.

### The grouping key, and two corrections it took to get right

Year is included **only for issue-shaped books** — an issue number _and_ no
collected-edition marker _and_ no volume token.

On a floppy the year is a volume designation, constant across the run, and exactly what
separates `Batman (2011)` from `Batman (2016)`. On a collected edition it is the
publication year of one volume and varies. Keying everything on `(title, year)` destroyed
four of the six real clusters in the production library.

Requiring an issue number was _also_ not enough, which only production revealed:
`Saga of the Swamp Thing v01..v04` carry `number` 1.0–4.0, because a collected edition's
**volume** number lands in the same column an issue number would. All four looked
issue-shaped and the run split 2/1/1 with the singletons dropped. The signal that
separates them was already being computed and thrown away — `parse_comic_filename` strips
`v01` and never reported it. It does now.

Both corrections were the same mistake: taking a field that correlated with "is an issue"
in a hand-written fixture and treating the correlation as the signal.

Groups need **two or more** books. Grouping every loose book produced 8 real groups and
**115 groups of one** — turning one junk bucket into 115 junk shelves is a worse library.

`book_group_locked` marks a book a person has decided about. Detection never reads or
writes those rows, and the scanner does not know the column exists, so manual corrections
survive re-runs _and_ rescans.

## Verified against production (609 books, 242 series, 139 loose)

|                      |                               |
| -------------------- | ----------------------------- |
| Collections          | **11**, covering **47** books |
| Standalone books     | **92**                        |
| Total books visible  | **609** (unchanged)           |
| `numberOfSeries`     | **241** (was 242)             |
| Detection wall clock | **0.11s**                     |
| Idempotent re-run    | 0 created, 11 matched         |

Largest shelves: `Fantastic Four Epic Collection` (22), `Fantastic Four Omnibus` (4),
`Saga of the Swamp Thing` (4).

Re-running detection after the key formula changed converged on its own — 2 created,
9 matched, 2 pruned — confirming that keying group identity on `source_key` makes a change
in the grouping rule self-healing.

## Two unrelated fixes found along the way

- **`docker/Dockerfile` had a build race.** The pdfium and Rust builder stages both mount
  the same unnamed apt cache, and BuildKit runs them in parallel; the loser dies with
  `Could not get lock ... held by process 0`. It failed three times in a row, in different
  stages each time — which is why it reads as flaky CI. `sharing=locked` fixes it without
  changing the cache id, so warm builds stay warm.
- **`.nx/` was not gitignored**, so a `git add -A` swept the Nx cache into the index.

## Gates

`cargo fmt` · `cargo clippy -D warnings` · `cargo dump-schema --check` · `cargo test`
(all green, +21 new) · `yarn lint` · `yarn test` (524 passing).

The `onDeck` regression test was verified to **fail without its fix** — it offered
`data_2` as the next book.

Design spec: `docs/superpowers/specs/2026-08-09-virtual-book-grouping-design.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01SND5zDhtvFzJnK5FnXGWyQ

---

## #18 — fix(header): stop five stat chips crowding the entity header on tablets

- state: MERGED · merged 2026-08-09 · `f97c60e0`
- author: SaintedRogue

The header row carries four things: the entity name, the stat chips, the tab nav, and
settings. Everything except the chips has a function you cannot drop — so the chips were
the thing to make adaptive. Previously all five appeared at once from `sm` upward, which
left a tablet unreadable.

## Stats now arrive in tiers

| Width   | Chips shown                                        |
| ------- | -------------------------------------------------- |
| `< sm`  | none — unchanged; the ⓘ sheet still has everything |
| `sm–lg` | **2** — series count, books completed              |
| `lg–xl` | **3** — + books in progress                        |
| `xl+`   | **5** — + reading time, size on disk               |

Priority is a prop rather than a hardcoded index, so the series and smart-list headers —
which share `EntityHeader` — tier their own stats sensibly too.

No width that previously showed stats now shows none: the threshold stays at `sm`, the
tiers just stop all five arriving at once.

## Three smaller fixes in the same row

- **The name was `shrink-0`**, so a long library name pushed the tabs off the row instead
  of truncating. It truncates now.
- **A stat chip had no accessible name** — an icon plus a bare number, so a screen reader
  read "241" with no indication of what was counted. `MiniStatCard` takes a `label`,
  rendered as visually-hidden text and as the tooltip; the icon is `aria-hidden`.
- **Info and settings buttons were 24–28px**, well under the 44px minimum. They are 44px
  through tablet widths — tablets are touch devices too — and compact only at `lg`, where
  a pointer is the likely input. Desktop appearance is unchanged.

## Gates

`yarn lint` (0 errors) · `yarn check-types` · `yarn test` (524 passing). Frontend-only, so
the Rust gates are untouched by the change-gated CI. Verified the built CSS actually emits
`lg:flex` / `xl:flex` / `h-11` / `sr-only`, since the tier classes live in a TS lookup
object and would be easy for Tailwind to miss.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01SND5zDhtvFzJnK5FnXGWyQ

---

## #19 — fix(header): tier stat chips by container width

- state: MERGED · merged 2026-08-09 · `eb0f4471`
- author: SaintedRogue

Follow-up to #18, which used viewport breakpoints. Those measured the wrong thing.

The sidebar takes ~208px, so a 768px tablet leaves the header a **544px** row — barely more
than a phone in landscape. #18 still showed two chips there and squeezed the library name
down to `Co…`. Container queries measure the row itself, so the tiers stay correct whether
the sidebar is open, collapsed, or replaced by the top bar.

## Measured on the real library

| Viewport | Header container | Chips |
| -------- | ---------------- | ----- |
| 375      | 375              | 0     |
| 768      | 544              | **1** |
| 1024     | 800              | 2     |
| 1280     | 1056             | 3     |
| 1536     | 1312             | 5     |
| 1920     | 1696             | 5     |

Name intact and zero horizontal overflow at every one — verified with Playwright, not by
eye.

## Also

- **The name outranks the chips.** It is capped and truncates only past `14rem`, so a short
  name like "Comics" can never lose characters to make room for a stat chip.
- **Chips re-ranked** so the one that survives longest is books-completed (`27 / 609`) — the
  number that actually says something about the library at a glance — rather than series
  count.

## Gates

`yarn lint` (0 errors) · `yarn check-types` · `yarn test` (524 passing).

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01SND5zDhtvFzJnK5FnXGWyQ

---

## #20 — fix(library): make collections a view of the series grid, not a wall above it

- state: MERGED · merged 2026-08-09 · `65742618`
- author: SaintedRogue

Collections shipped as one `HorizontalCardList` **per group**, stacked above the series grid.
That is fine at zero collections — which is how it was written and reviewed. Once detection
found 11, the section became ~**4,700px** of carousels and pushed the series grid and its
pagination far below the fold.

The grid was still paginating correctly. Every page just _looked_ identical because the same
wall of collections sat on top of it.

```
viewport 768          scroll region: 1024px
Collections heading            y =   112
Fantastic Four Epic Collection y = 1128
Spawn: New Beginnings (2)      y = 4256
...series grid + pagination below that
```

## The fix

The conceptual error was treating a collection as an annotation on the series list. **A
collection is a shelf of books, exactly like a series** — it just isn't backed by a folder.
So it belongs in the same browse surface, in the same card, not in a banner above one.

The series tab now has a **Series / Collections** toggle beside the search box. One grid, one
pagination, nothing buried — and no fourth header tab to re-crowd the row that #19 just
decrowded for tablets. Collection cards drill into a detail view listing that shelf's books.

## Details

- The view lives in the URL (`?view=collections`) so it is linkable and survives a
  back-navigation, matching how page/search/filters already work here. Switching views drops
  `?page`, which belongs to the series list and would otherwise land on a page the other view
  does not have.
- Sort, filter, layout and the alphabet strip are hidden in the collections view — none apply
  to eleven items.
- `StackedSeriesCard` takes an optional link target so collections reuse the series card
  verbatim rather than growing a near-duplicate component. Series prefetch is skipped for
  non-series destinations.
- Both links go through `paths` helpers. A relative `collections/:id` resolved to
  `/series/collections/:id`, matched no route, and rendered an empty page.

## Verified against the live library

| View              | Result                                                  |
| ----------------- | ------------------------------------------------------- |
| Series            | first card at y=120 (was ~4700); pagination turns pages |
| Collections       | 11 cards, two rows                                      |
| Collection detail | correct URL, books render                               |

`yarn lint` (0 errors) · `yarn check-types` · `yarn test` (524 passing).

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01SND5zDhtvFzJnK5FnXGWyQ

---

## #21 — feat: metadata pipeline hardening

- state: MERGED · merged 2026-08-09 · `7386d30d`
- author: SaintedRogue

Phase 1 of the Omnibus-comparison program (spec: docs/superpowers/specs/2026-08-09-metadata-hardening-calendar-design.md — behavioral findings only, GPL clean-room; no Omnibus code consulted).

## What's in here

1. **Provider response cache** — new \`metadata_response_cache\` table; CV/Metron GETs flow through it (normalized-URL SHA-256 keys, detail 7d / list 12h TTLs evaluated at read time, 512 KiB cap). A cache hit costs neither a rate-limit permit nor budget.
2. **API budget ledger + job discipline** — new \`metadata_api_usage\` rolling-window ledger (ComicVine stops at 170/200-hr, Metron at 4500/5000-day). \`MetadataFetchJob\` checks the budget per entity and defers (\`RATE_LIMITED\`, zero provider traffic) instead of marching through the wall; the scheduled MetadataRetry resumes.
3. **One shared provider client cache** — moved to \`ApalisWorkerState\` (reachable from \`Ctx\` and \`JobContext\`) with lazy encryption-key resolution. Fixes GraphQL mutations building fresh caches with fresh rate limiters that bypassed the job budget.
4. **External-ID collision guard** — auto-apply refuses to bind \`(metadata_source, metadata_external_id)\` a sibling series/media in the same library already holds; the record stays awaiting review. Library-scoped (organizer precedent); explicit accepts still win with a logged warning.
5. **Year + publisher scoring signals** — \`MatchScorer\`: year ±1 → +0.05, gap >1 → −0.20 (same-name volume disambiguation, e.g. Suicide Squad 2011 vs 2016); publisher corroboration +0.03, never a penalty. Wires the previously dead \`SearchQuery.publisher\`.
6. **NO_MATCH retry** — the scheduler's status picker now offers it (backend already accepted it).
7. **Metron file evidence + native short-circuit** — dedicated \`ComicVineIssueId\`/\`MetronIssueId\` ComicInfo tags, \`metron.cloud\` Web-URL extraction, Metron-scoped \`[Issue ID N]\` Notes disambiguation, new \`media_metadata.metron_id\` column, and a Metron provider short-circuit on the stored ID (skips the cv_id bridge).

## Migration note

Adds one forward-only migration (two tables + one column). Per the migration ledger: push the image to GHCR before any Unraid update.

## Testing

- 294 core + 102 metadata-crate Rust tests (24 new), 481+ frontend tests
- Full ci-preflight green: fmt, clippy -D warnings, schema-drift, cargo test, yarn lint, yarn test

🤖 Generated with [Claude Code](https://claude.com/claude-code)

---

## #22 — feat: follows + release calendar + updates feed

- state: MERGED · merged 2026-08-10 · `d14828d8`
- author: SaintedRogue

Phase 2 of the Omnibus-comparison program (spec: docs/superpowers/specs/2026-08-09-metadata-hardening-calendar-design.md). Builds on the Phase 1 cache/budget runtime (#21).

## What's in here

1. **Per-user follows** — \`series_follows\` table + idempotent \`followSeries\` mutation in the series action menu. Follows are curation only: they drive the pull list and updates feed, never any automation.
2. **Expected-issue skeletons** — \`expected_issues\` provider rows (unique per series+provider+external_id). Never media: "in library" is computed at query time by issue-number matching.
3. **Release-calendar oracle** — \`ScheduledJobKind::ReleaseCalendarSync\` sweeps CV/Metron store-date windows (−14d..+90d, cap 3000) through the Phase 1 response cache + budget ledger, matching by provider series-ID only (\`metadata_external_id\`, plus Mylar \`comicid\` for CV). Budget-exhausted providers defer to the next run. **Metron sweep defaults OFF** — its issue-list \`series.id\` shape is wiremock-pinned but unverified live (egress ban); enable via the job config after a VPN test.
4. **New provider capability** — \`fetch_upcoming_releases(start, end, cap)\` on the trait (default unsupported), paginated implementations for CV and Metron.
5. **GraphQL** — \`releaseCalendar(weekOffset, scope)\` (Sunday-aligned week, FOLLOWED|ALL), \`updatesFeed\` (30d/500-cap, unread from finished sessions), \`followedSeriesIds\`; all access-filtered via \`find_for_user\`.
6. **UI** — Calendar scene (week grid, pull-list/all tabs, today highlight, in-library badges), Updates scene (day-grouped, unread filter persisted), sidebar links, and the oracle job type in the scheduled-jobs dialog with per-provider toggles.

## Notes for review

- Pre-existing latent bug spotted (not fixed here, out of scope): \`LibraryScanConfigInput\` serializes \`library_ids\` (snake_case) into stored config, but \`LibraryScanConfig\` deserializes with \`rename_all = "camelCase"\` — a GraphQL-created scheduled scan likely fails config parsing at dispatch. The new ReleaseCalendar config uses camelCase on both sides.
- Follow entry point is the series action menu rather than a dedicated header bell (kept the existing header layout untouched); calendar/updates empty states point users there.

## Migration note

One forward-only migration (two tables). Push the image to GHCR before any Unraid update.

## Testing

- 297 core + 105 metadata-crate Rust tests (13 new: sync/upsert semantics, provider pagination + cap, week windowing), 488 frontend tests (7 new)
- Full ci-preflight green: fmt, clippy -D warnings, schema-drift, cargo test, yarn lint, yarn test

🤖 Generated with [Claude Code](https://claude.com/claude-code)

---

## #23 — fix: JWT secrets read per-database, not cached process-wide

- state: MERGED · merged 2026-08-10 · `fdd1cf36`
- author: SaintedRogue

Root-cause fix for the intermittent api_tests 401 flakes that hit PR #21 (once) and PR #22 (twice, different tests each time).

**Mechanism:** \`ACCESS_TOKEN_SECRET\`/\`REFRESH_TOKEN_SECRET\` were process-wide \`OnceLock\` statics. The integration-test binary boots one database per test, each with freshly generated secrets — when two tests raced the first read, the loser kept signing tokens with its own database's secret while validation used the winner's cached one → spurious 401s anywhere in the suite, timing-dependent (frequent on the loaded CI runner, rare locally). A second symptom was the \`image_caching\` "expected an etag header" failure — same 401 wearing a different assertion.

**Fix:** drop the statics; read the secret per call. It's a single-column point-read on in-process SQLite (microseconds), correctly scoped, and permits secret rotation without a restart. The old \`test_secrets_cached_after_first_retrieval\` (which pinned the buggy behavior) is replaced with a cross-database scoping regression test.

Verified: full \`cargo test -p longbox_server\` green, \`api_tests\` run 5× consecutively clean, clippy clean.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

---

## #24 — feat: filename-parser tokens + image-serving polish

- state: MERGED · merged 2026-08-10 · `725ca4e3`
- author: SaintedRogue

Phase 3 (final) of the Omnibus-comparison program (spec: docs/superpowers/specs/2026-08-09-metadata-hardening-calendar-design.md). No migrations.

## Parser (\`crates/integrations/metadata/src/filename.rs\`, still regex-free)

- **Chapter tokens** — \`ch. 1044\`, \`Chapter 364\`, glued \`ch077\` fold into the number position and set a new \`has_chapter_token\` (the manga counterpart to \`has_volume_token\`; not GraphQL-exposed). Bare \`c###\` deliberately unsupported (false-positive prone); a marker word without digits stays title text.
- **Negative issues** — \`#-1\`, \`-01\` → \`-1\` (Zero Hour et al); spaced hyphens stay separators.
- **\`N of M\` tails** — \`Kingdom Come 3 of 4\` yields issue 3, never the count.
- **Volume digit cap** — \`v2024\` is a year tag, not volume 2024 (cap 3 digits, standalone and glued forms).
- **Year ranges** — \`(1994-1996)\` yields 1994.

## Images

- **Failure responses are never cacheable** — new \`ImageCachePolicy::Uncacheable\` (\`no-store\`, no ETag) marks the raw-page stand-in served when thumbnail self-heal fails (previously cached for its max-age, pinning the failure — the "whole series wears page-1 art" class of bug). Thumbnail fns now return \`ImageResponse\` end-to-end; the Kobo JPEG re-encode preserves the source policy; saved-thumbnail branches gained \`Last-Modified\`. All \`APIErrorResponse\` errors now carry \`no-store\` too.
- **Width-whitelisted thumbnail variants** — media/series/library thumbnail routes accept \`?width=160|320|480|640\`; variants are lazily generated as \`{id}@{width}.webp\` beside the base (header-probe sizing, downscale-only, serve-base-on-any-error) and swept when the base regenerates. Frontend adoption of \`?width=\` is a deliberate follow-up.
- Spec item "SWR on covers" was found already shipped (\`DERIVED_IMAGE_CACHE_CONTROL\` carries \`stale-while-revalidate=604800\`) — documented, no change.

## Testing

- 8 new parser tests (15 total in filename.rs), 3 variant cache/sweep tests, no-store header test
- Full ci-preflight green: fmt, clippy -D warnings, schema-drift, cargo test, yarn lint, yarn test

🤖 Generated with [Claude Code](https://claude.com/claude-code)

---

## #25 — feat(search): search coverage overhaul — escaping, widened fields, unified search

- state: MERGED · merged 2026-08-10 · `76aace1b`
- author: SaintedRogue

Phases 0–2 of the search-coverage work. Phase 3 (folder hierarchy, carries a migration) is deliberately **not** in this PR.

Design doc: `docs/superpowers/specs/2026-08-10-search-coverage-design.md`

## Why

An audit of "are we searching all possible content?" found the scanner indexes arbitrarily deep nesting correctly — `walk_library` walks unbounded for series-based libraries — but search itself covered **3 fields out of ~33**, and `/series` + `/libraries` rendered `<UnderConstruction />` while being routed.

## Defects fixed

- **LIKE wildcards were never escaped.** sea-orm's `contains`/`starts_with`/`ends_with` build `format!("%{}%", value)` with no escape mechanism. Searching `50%` produced the pattern `%50%%`, which collapses to `%50%` and matched "500 Page Special". Now routed through `LikeExpr` with an explicit `ESCAPE` clause, fixing every caller of the filter DSL at once.
- **Author queries bypassed access control.** `fetch_all_authors` took no `AuthUser` and never called `find_for_user`, so `authors`/`authorByName`/`authorSeriesByName` returned writers from libraries hidden to the user and from books above their age restriction. The equivalent character queries had applied these rules, with tests, since they were written.
- **`Excludes` was not the inverse of `Contains`.** It passed the raw value to `not_like`, making it an exact-match negation.
- **The book-club picker's `_or` was an AND.** `_or: [{ name: …, metadata: { title: … } }]` is one object with two keys, so it required the term to match the filename _and_ the metadata title.
- **`CommandPrompt` was unusable.** Never exported from the package, and it passed `href` to `Link`, which only routes when given `to` — every item would have full-page-reloaded the SPA.

## What changed

**Search moved server-side.** `search: String` is now an argument on `media` and `series`, matching the shape `libraries` already had. Terms are AND-ed, each term ORs across the entity's fields, so `batman year` finds a book whose characters list "Batman" and whose title is "Year One" — impossible under single-phrase matching. Both OPDS versions now call the same builders (wire params unchanged for client compatibility), collapsing four drifted implementations into one.

**`searchAll`** fans out over books, series, libraries, authors and characters, returning a capped group per type with total counts. Grouped rather than a union because characters and authors paginate in memory, so an interleaved list can't share a pagination scheme.

**`/series`, `/libraries` and `/search`** are real scenes now. "Show all" from a search group navigates to that type's browse route with the same term, so expanding one group never refetches the others.

## Deliberate omissions

- **`media`/`series` `path` is not searchable.** Absolute paths carry the library mount prefix, so a library at `/mnt/comics` would return every book for the term "comics". Folder-name search arrives in Phase 3 via `library_folders.name`, which stores leaf segments. `library.path` stays searchable — a library _is_ its path, so a match is one row.
- **Nothing links to `/series` in the persistent nav.** It's reachable via Cmd+K and `/search`. A nav entry needs a new `SystemArrangement` variant, which is a persisted user preference backed by a Rust enum and needs its own change.
- **Still on SQLite LIKE.** No FTS5; coverage is tiered instead.

## Verification

`cargo fmt --check`, `cargo clippy -- -D warnings`, `cargo dump-schema -- --check`, `cargo test` (29 binaries), `yarn lint`, `yarn test` (488 browser tests) — all green locally.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

---

## #26 — feat: folder hierarchy — record library folder structure (migration)

- state: MERGED · merged 2026-08-10 · `e290cae0`
- author: SaintedRogue

Phase 3 of the search-coverage work, stacked on #25 (now merged). Design doc: `docs/superpowers/specs/2026-08-10-search-coverage-design.md`

## ⚠️ Contains a migration

`m20260810_000000_add_library_folders`. Migrations here are **forward-only** — an older `longbox_server` binary hard-panics against a migrated database. **The GHCR image must be published before any Unraid update runs**, or the container comes up against a schema it cannot read.

Verified locally: applies cleanly, `down()` round-trips, both foreign keys enforced, all four indexes plus `series.folder_id` present.

## Why

A series is named after its leaf directory, so `/lib/Marvel/Hulk` and `/lib/DC/Hulk` produce two rows both literally called "Hulk" with nothing distinguishing them. The intermediate directories that would tell them apart produced **no rows at all**: `dir_has_media` resolves a directory to `UNKNOWN`, so a folder holding only subfolders never qualifies as a series, and the walk discarded it.

## The data was already being computed

`walk_library` partitions every directory into "becomes a series" and everything else. The grouping folders sit in that second bucket alongside `.git` and dotfiles. This separates them out — excluding ignore-rule matches, hidden directories and the library root itself — and reconciles them into a new `library_folders` table on every scan.

Two details worth review attention:

- **Both FKs are enforced**, including the self-referential `parent_id`. That's possible only because this is a `CREATE TABLE`; the `book_groups` precedent had to leave `media.book_group_id` unenforced because SQLite can't add an enforced FK via `ALTER TABLE`. Only `series.folder_id` inherits that limitation here.
- **Sorting by depth before insert is load-bearing.** A folder resolves its `parent_id` from a map built as it iterates, and `WalkDir` guarantees no ordering strong enough to rely on — a child processed first would silently attach to the root. The test feeds paths deepest-first to prove the sort does the work.

Rows are upserted on `(library_id, path)` so a rescan reuses existing ids and nothing pointing at a folder dangles. Stale rows are pruned in `finalize()`, mirroring the `scanned_directory` sweep. Every step is best-effort: losing folder rows costs breadcrumbs, not books.

## Edge case, covered by a test

A directory that is _both_ a series (holds books directly) _and_ an ancestor (has media-bearing subdirectories) is classified as a series, so no folder row exists for it and its children report no breadcrumb. Tested rather than left to be discovered.

## API + UI

GraphQL gains `LibraryFolder` (children / series / ancestors), `Series.folder`, `Series.breadcrumb`, and a `libraryFolders` query. Folder search matches `name` only — never `path` — which is what makes it usable where `SeriesFilterInput.path` is not: a library mounted at `/mnt/comics` would otherwise match every folder inside it for the term "comics".

The series header breadcrumb now shows the folder chain. Segments are **plain labels, not links** — folder browse doesn't exist yet, and a segment that looks clickable but isn't would be worse than one that plainly orients.

## Not included

**Folder browse UI.** The query, object and name-search all exist server-side and are unused by the frontend. Flagged rather than half-built.

## Verification

`cargo fmt --check`, `clippy -D warnings`, `cargo dump-schema -- --check`, `cargo test` (29 binaries, 4 new scanner tests), `yarn lint`, `yarn test` (488 browser tests) — all green locally.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

---

## #27 — feat: Series in the nav, and the filter fields the forms were missing

- state: MERGED · merged 2026-08-10 · `1809b04c`
- author: SaintedRogue

Two follow-ups from the search-coverage work (#25, #26). Both were picked over the other deferred items because the others turned out to be no-ops on real data — see below.

## Series in the navigation (`24e57338`)

`/series` shipped in #25 as a working route reachable only by typing the URL or via Cmd+K, because navigation is driven by the `SystemArrangement` enum and there was no variant for it.

**Adding the variant alone would have been invisible to every existing user, permanently.** A navigation arrangement is persisted the moment someone reorders or hides anything, which freezes the section list as it was that day; defaults are only consulted when nothing is stored.

`with_missing_system_sections` reconciles a stored arrangement against the current enum on read. Two deliberate choices:

- **Appends** rather than inserting at the default index — the stored order is the user's decision, and reshuffling it to match a new default is a worse surprise than a new item at the end.
- **Never re-adds links a user removed.** Covered by a test, along with hidden-stays-hidden and idempotency.

Side benefit: the next system section added needs no migration of its own.

Series carries no create/showAll links, so it joins Home and Explore as non-configurable in the arrangement settings. Only `en-US` gains locale keys — the other 31 fall back, which beats inventing translations.

**Note:** this is server-driven, so the item appears as soon as the new server runs. The reconciliation is read-only and writes nothing to stored preferences.

## Filter fields (`73fe630b`)

The forms had drifted well behind the backend. Three fields with real data were unreachable from the UI even though `mediaMetadataOverview` already returned them and `MediaMetadataFilterInput` already accepted them — **the query simply never selected them.** Measured on the live library:

| Field                       | Distinct values |
| --------------------------- | --------------- |
| `coverArtists`              | 302             |
| `teams`                     | 228             |
| `series` (ComicInfo string) | 234             |

Adds those three multiselects plus a publication-year range (249 of 400 sampled books have a year, 1987–2026). Year renders outside the guard that hides the multiselects when a library has no metadata, since it needs no option source.

`NumericRangeFilter` is new rather than an extension of `AgeRatingFilter`, which answers a different question (a single "X and up" bound with a radio for "any"). Its mapping returns a **union**, not one object with three optional keys — the GraphQL numeric filters are `@oneOf`, so their generated types are discriminated unions a loose shape cannot narrow to. It also guards `NaN` (what an empty number input yields, which would otherwise serialise and match nothing) and swaps inverted bounds instead of sending a range that can never match.

**Removes the dead `metaType`** from the series form: it was in the zod schema, the defaults _and_ the GraphQL mapping with no control ever rendered, so it read like a working filter that could never be set. Wiring it up was the alternative, but there is no series equivalent of `mediaMetadataOverview` to source options from. The backend filter is untouched and still reachable via smart lists and the API.

## Why not the other deferred items

Checked against the live library before building:

- **Folder browse** — 0 folders exist. The library is flat: 380 depth-1 entries, 241 directories containing files, **0** grouping directories.
- **Duplicate series-name disambiguation** — 0 duplicates, and structurally impossible in a flat library, since two directories in one parent cannot share a name.
- **Series publisher/imprint/status controls** — only 3 of 241 series have any metadata, with `metaType` and `status` null across all of them.

Each would have shipped UI that filters an empty column.

## Verification

`cargo fmt --check`, `clippy -D warnings`, `cargo dump-schema -- --check`, `cargo test` (4 new arrangement tests), `yarn lint`, `yarn test` (488 browser tests) — all green locally.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

---

## #28 — fix(docker): retry package installs that fail on transient network errors

- state: MERGED · merged 2026-08-10 · `e9b9be2d`
- author: SaintedRogue

## The problem

`apk add --no-cache git` (`docker/Dockerfile`, frontend stage) failed **twice in one day** on the self-hosted runner:

```
WARNING: fetching https://dl-cdn.alpinelinux.org/alpine/v3.21/main: temporary error (try again later)
ERROR: unable to select packages: git (no such package)
ERROR: failed to solve: process "/bin/sh -c apk add --no-cache git" exit code 1
```

Both times a re-run fixed it with no code change (16:23 and 18:53 UTC, runs `31408625243` and `31421300186`).

It's a single uncached call to a public CDN with no retry, and it fails the **entire image publish**. That failure is quiet from the outside — Actions shows red, but `latest` just silently stays where it was, so a merge can look complete while producing no image.

## The change

Both package-install steps retry three times with linear backoff.

The builder stage's `apt-get` is included because it has identical exposure — it only escaped notice because it gets _cancelled_ when the frontend stage fails first. `apt-get update` sits inside the loop deliberately: a half-fetched package index is precisely what makes the subsequent install fail.

**Neither loop's exit status is trusted.** `command -v git` and `dpkg -s build-essential` confirm the packages actually landed, so a transient failure can't be absorbed into a silently broken image.

## Verified, both directions

Run against the real base image (`node:22.14.0-alpine3.21`) on the actual build host:

| Scenario         | Result                                            |
| ---------------- | ------------------------------------------------- |
| Normal           | Installs, `git version 2.47.3`                    |
| `--network none` | Exhausts 3 attempts, guard fires, **exit code 1** |

The second case is the one that matters: the retry must not turn a genuine failure into a green build.

## This mitigates a symptom, not the cause

The host's outbound connectivity is intermittently failing. During this investigation a `docker pull` from `registry-1.docker.io` timed out, while minutes later the same endpoint plus `dl-cdn.alpinelinux.org` and `ghcr.io` all answered 3/3. Worth looking at the runner container's networking separately — the retry just stops it costing you an image.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

---

## #29 — fix(docker): retry the pdfium stage's network steps too

- state: MERGED · merged 2026-08-10 · `9bf21b1d`
- author: SaintedRogue

Follow-up to #28, which **missed two of the four** network-dependent steps.

## What I got wrong in #28

I searched for network calls with a pattern that required the command on the same line as `RUN`. The pdfium stage puts `--mount` there, pushing the command onto a continuation line, so two steps were invisible to that search and I reported the job as done when it wasn't:

| Line | Step                              | #28        |
| ---- | --------------------------------- | ---------- |
| 24   | pdfium `apt-get install curl tar` | **missed** |
| 40   | pdfium `curl` download            | **missed** |
| 90   | frontend `apk add git`            | retried    |
| 135  | builder `apt-get install`         | retried    |

All four are now retried and verified.

## `--fail` matters as much as the retry

The pdfium download used `curl -sLo` with no `--fail`. curl exits **0** on a 4xx/5xx and writes the HTTP error body straight into `pdfium.tgz`, so a failed download surfaces as a confusing `tar` error rather than a download problem. The existing sha1sum check would eventually catch it, but only after the extract had already failed misleadingly.

`--retry-all-errors` is required because `--retry` alone ignores connection-level failures — which is precisely the class being seen on this runner.

## On the underlying cause — one theory tested and rejected

The host's outbound networking is intermittently failing for containers spawned on the Unraid daemon. Observed during this work: two `docker pull` timeouts from `registry-1.docker.io`, and `apk add curl` failing three consecutive attempts inside a bridge-network container.

Narrowing it down:

| Probe                                    | Result             |
| ---------------------------------------- | ------------------ |
| devbox container → 4 registries, 3× each | 12/12 OK, DNS fine |
| bridge container: DNS + raw TCP 443      | OK                 |
| bridge container: `apk add`              | failed repeatedly  |
| **host**-network container: `apk add`    | **OK**             |

Small packets fine, larger transfers failing, bridge-only — that reads like MTU, so I checked. **It isn't**: docker0, eth0 and bond0 are all 1500, and the daemon's bridge MTU is 1500. `tunl0` sits at 1480 but is NOARP and down.

So I don't have a root cause, and I'd rather say that than leave a tidy-sounding theory standing. It's intermittent, scoped to containers on that daemon, and not DNS or MTU. Someone with host access could check conntrack, `dmesg`, and whether it correlates with array or VM activity. The retries stop it costing an image in the meantime.

## Verification note

The retry-loop pattern was verified end-to-end on the real base image on the build host in #28 — installs on success, exhausts and exits 1 with networking disabled. For this PR I validated the shell syntax, but could **not** empirically exercise the curl flags on the build host: the network kept failing mid-test, which is the very problem being fixed. `--fail`/`--retry` are standard documented curl behaviour, and the image build on merge exercises them for real.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

---

## #30 — ci: build the Dockerfile on docker/\*\* changes

- state: MERGED · merged 2026-08-10 · `cee7ebc1`
- author: SaintedRogue

## The gap

The `docker` paths-filter has been declared in `ci.yaml` all along, but **no job consumed it**. A `docker/**` change therefore ran nothing: #28 and #29 both reported green in 13 seconds with every job skipped.

That means a broken Dockerfile merges clean and fails later in the publish workflow — where the only outward symptom is `latest` quietly not moving. It's how two missed retry steps in #28 survived to be caught by a build log instead of by CI.

## `--check` is included, but it is not the safety net

I tested it rather than assuming:

| Dockerfile                        | `docker build --check` | stage build   |
| --------------------------------- | ---------------------- | ------------- |
| Real one                          | exit 0                 | exit 0        |
| **Unbalanced quote inside a RUN** | **exit 0** ❌          | **exit 1** ✅ |

`--check` lints Dockerfile syntax, not shell. It's kept because it costs ~2s and covers every stage, but **building the pdfium and frontend stages is what actually catches a malformed RUN**. Between them they cover three of the four network-dependent steps.

**The builder stage is excluded on purpose** — it's a full Rust release compile, far too expensive per PR, and its contents are already covered by `check-rust`. A broken RUN in that stage alone will still reach the publish workflow. Stating that plainly rather than implying full coverage.

## Retries raised from 3 to 5 attempts

Not speculative tuning — 3 proved insufficient during a live episode. A frontend-stage build on the build host exhausted all three attempts and tripped the guard while the host's outbound network was degraded:

```
ERROR: failed to build: process "/bin/sh -c for attempt in 1 2 3; do apk add --no-cache git && break; ..."
       did not complete successfully: exit code: 1
```

Backoff goes from 5s/10s to 10s/20s/30s/40s. This matters more now that CI builds these stages: an under-tuned retry makes the new job intermittently red, and a flaky required check trains people to ignore it.

## Verified on the build host

- `--check` → exit 0 on the real Dockerfile
- `--target pdfium` → exit 0
- retry guard with `--network none` → **exit 1** (still fails loudly; the wider retry must not mask a genuine failure)

## Honest caveat

This job runs on the self-hosted runner and builds two network-dependent stages, so **it will occasionally fail for environmental reasons** until the host's outbound networking is sorted. The 5-attempt retry narrows that window considerably but does not close it. If it proves noisy, the pragmatic fallback is to keep `--check` plus the cheap pdfium stage and drop the frontend build.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

---

## #31 — feat(metadata): test connection button for saved providers

- state: MERGED · merged 2026-08-10 · `c042350d`
- author: SaintedRogue

## The problem

There was no way to check a provider's credentials from the UI. The backend mutations existed, the feedback components existed _and were unit-tested_, and nothing wired them together — so a wrong key stayed invisible until a metadata fetch silently returned nothing.

That is exactly how a bad ComicVine key sat undetected in production for three weeks.

## What was actually wrong with the old button

PR #12 (`63c4eda7`) removed the previous Test button and added a server-side short-circuit so Metron could never be contacted for validation at all — not even by an API caller. Its stated reason was that Metron bans clients which probe it, but the commit body names the real fault:

> the create/edit form **re-validated on every debounced keystroke**, plus a per-provider "Test" button

Typing a password fired a burst of authenticated requests. That is genuinely abusive and deserved removing. A single deliberate click is one request against **20/min and 5,000/day**, and `MetronClient::validate_credentials` already waits on the client's own rate limiter before issuing it. The two got removed together; only one deserved it.

**The short-circuit goes. The no-auto-validation rule stays.** The create/edit form still does not validate Metron as you type (`PROVIDER_VALIDATORS.METRON` remains `null`). A test asserts that _rendering_ the button issues no request — the exact regression that started this.

## Why not a toast

The seven `ProviderValidationStatus` variants are not interchangeable. Only `InvalidCredentials` means "your password is wrong"; `Forbidden` and `NetworkError` mean the account or the network is at fault. Collapsing them into pass/fail is what made a blocked IP read as a bad password and cost real diagnostic time.

Results render through the existing `ProviderValidationFeedback`, which was already built and tested but connected to nothing. Only `InvalidCredentials` reddens a credential field; the rest render as callouts that say explicitly _"this is not a password problem"_. Each state carries an icon **and** a title **and** a description, so severity is never conveyed by colour alone.

`metronStatusToFeedback` becomes `validationStatusToFeedback` with a provider label, since the button covers ComicVine too. The old name stays as a deprecated alias so existing tests and callers are untouched.

## Verified against the live providers

|                                   | Result                                                                              |
| --------------------------------- | ----------------------------------------------------------------------------------- |
| Metron `validate_credentials`     | **Valid** — and a real search returned _Absolute Batman #1 (2024)_, 0.96 confidence |
| ComicVine, stored key             | `FORBIDDEN`                                                                         |
| ComicVine, key from `longbox.env` | `VALID` — re-saved, config now reports **VALID**                                    |

Worth noting: Metron validated from egress IP `104.50.208.178`, the IP previously recorded as firewall-banned by Metron. That ban appears to have been lifted.

## Gates

`cargo fmt --check`, `clippy -D warnings`, `cargo dump-schema -- --check`, `cargo test` (116 graphql), `yarn lint`, `yarn test` — 493 browser tests, 5 new.

## Known limits

- No UI cooldown between clicks. The client-side 20/min governor is the only throttle; a visible cooldown would be a small follow-up if repeated clicking ever becomes a concern.
- Provider health is still only visible on demand — there's no persistent "last tested" state on the card. That needs schema columns, and migrations here are forward-only with real deploy cost.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

---

## #32 — feat(metadata): real progress for provider searches

- state: MERGED · merged 2026-08-10 · `916f66d7`
- author: SaintedRogue

## The problem

A metadata search appeared to hang. It wasn't hanging — it was working, silently. The entire loading state was **one line of static grey text**: _"Searching the provider…"_. Nothing moved, so a slow search and a dead one looked identical.

These searches are slow by construction, not by accident:

| Cause            | Cost                                  |
| ---------------- | ------------------------------------- |
| Connect timeout  | 10s                                   |
| Request timeout  | 30s                                   |
| Retry middleware | up to 3 attempts, exponential backoff |
| ComicVine lookup | walks volumes → issues, sequentially  |

Previously measured at ~80s in production. Static text for 80 seconds reads as a hang every time.

## The change

A spinner, **a running clock**, the provider's real name, and result-shaped placeholders showing where matches will land.

The clock is the load-bearing part — it's what answers _"is this alive?"_. Copy escalates with the wait:

- **< 10s** — silent; a short wait needs no explanation
- **10s** — "This can take up to a minute if the provider is slow to respond."
- **30s** — "Still working. Providers rate-limit and retry, so a slow reply is normal — **not a failure**."

That last line exists because the old experience trained users to assume breakage. Naming the wait as normal is the actual fix for the feeling.

## Deliberately omitted

**No progress bar.** The server reports no percentage. A fabricated one is worse than none the moment it parks at 90% — it converts "I don't know how long" into "this is definitely stuck".

**No Cancel.** The SDK has no abort plumbing, so Cancel could only stop the _UI_ waiting while the request continued server-side. Beyond being dishonest, it invites an immediate retry — doubling load on a provider that rate-limits at 20/min. Real cancellation needs an `AbortSignal` threaded through `sdk.execute`, which is a cross-package change worth doing on its own.

## Accessibility

The clock is `aria-hidden` — a per-second announcement is unusable noise — while the phase messages sit in an `aria-live` region so state still reaches screen readers. The placeholder pulse is `motion-safe`.

## Scope note

This makes the wait **legible, not shorter**. If the 80s itself is the target, that's separate work: the biggest lever is that an unreachable provider burns its full connect timeout plus retries before failing, and `hardcover.rs` still carries `// TODO: Parallelize these fetches` on its serial search path.

## Gates

`yarn lint`, `check-types`, `yarn test` — 498 browser tests, 5 new covering the clock, the escalation thresholds, and that a long wait reads as normal rather than an error.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

---

## #33 — fix(scheduler): hold the JobScheduler so cron loops survive boot

- state: MERGED · merged 2026-08-11 · `a899cb7e`
- author: SaintedRogue

## Root cause

`http_server.rs` discarded the `Arc<JobScheduler>` returned by `init_scheduler()`:

```rust
core.init_scheduler()
    .await
    .map_err(|e| ServerError::ServerStartError(e.to_string()))?;   // Arc dropped here
```

`JobScheduler`'s `Drop` impl aborts every cron loop it spawned — so every scheduled job's task was killed microseconds after `Scheduler initialized` was logged. The bug was invisible until tonight because prod never had a scheduled job (`job_count: 0` → nothing to abort). Discovered when the first `ReleaseCalendarSync` job loaded cleanly at boot and then never fired: prod logs show `Starting scheduled job … job_count: 1` at 23:38:37 and no `Firing scheduled job` line at any of the next three cron boundaries.

This also means scheduled **library scans** have never fired via GraphQL-created jobs (compounding the `LibraryScanConfigInput` snake/camel config-parse issue noted in #22's PR body).

## Fix

- Bind the scheduler in `start_server` so it lives for the server's lifetime.
- Mark `JobScheduler` `#[must_use]` and return it bare (not `Arc`-wrapped — the lint can't see through `Arc`), so a discarded handle at a call site fails `clippy -D warnings`.
- Regression test: a held scheduler fires an every-second cron (`ReleaseCalendarSync` no-op sweep) and stamps `last_run_at` — proving the cron loop mechanics end-to-end against a real migrated in-memory DB.

## Verification

- `cargo test -p longbox_core --lib job::scheduler` → new test passes in <1s.
- Full ci-preflight green (fmt, clippy -D warnings, schema check, cargo test).

🤖 Generated with [Claude Code](https://claude.com/claude-code)

---

## #34 — fix(web,metadata): stale book detail, mobile overlap, ComicVine budgeting

- state: MERGED · merged 2026-08-11 · `dbcbc469`
- author: SaintedRogue

## Description

Four reported problems: book detail loading the previously-viewed book, components overlapping in the mobile book layout, ComicVine rate limiting leaving throughput on the table, and metadata search not reusing its cache across a bulk match run.

### Book detail rendered the previous book

`/books/:id` matches the same route pattern for every book, so a book-to-book navigation (the "Next in series" strip is the common path) reconciles one long-lived scene rather than mounting a fresh one. Everything beneath it that seeds state from props in a mount-only `useState` therefore kept rendering the book you came from:

- `MediaMetadataEditor` snapshots `data` into state, along with the locked-field set and the react-hook-form defaults — none of it resynced.
- `ThumbnailImage` held bare `isLoaded` / `hasError` booleans. `isLoaded` left `true` faded the incoming cover in while the browser still held the previous bitmap; `hasError` left `true` suppressed the `<img>` entirely for _every_ book rendered through that instance afterwards.

`BookReaderScene` already carries exactly this fix (`key={media.id}`, with a comment describing the same failure mode) — book detail never got it. Book content is now keyed by book id, both metadata editors are keyed by their entity id, and the thumbnail's flags are src-scoped so they self-reset with no effect to synchronize.

### Two overlaps in the mobile layout

- **Metadata editor.** The Edit/Save/Cancel controls were the `header` of a right-pinned `actions` column declared `size: 0` — a zero-width `position: sticky` cell containing real buttons, whose content overflowed its own box at `z-index: 1` and painted over the adjacent cells. Desktop slack in the width arithmetic hid it; at phone and tablet widths the buttons landed on the field values. They now render above the table, and the column is gone. Rows and cells were also made to agree on width (`w-full` + `min-w-0`), with `overflow-x-auto` replacing `overflow-hidden` so overflow is reachable rather than silently clipped.
- **JobOverlay.** The expanded card carried `fixed relative` together. Tailwind emits both declarations and orders `relative` last, so it resolved to `position: relative`: it dropped into the document flow at the end of the shell, shifted up by its `bottom` offset, and painted over the page beneath it at `z-50`. Only the expanded state was affected — the minimized pill never had the extra class. Visible while a scan or metadata job runs.

### ComicVine rate limiting

ComicVine publishes **no** rate-limit headers. Unlike providers that send `X-RateLimit-Remaining`/`-Reset`, it reports a breach only after the fact, as `status_code: 107` ("Rate limit exceeded. Slow down cowboy.") inside an HTTP 200 body. Remaining budget cannot be observed, only modelled — so:

- **`cached_get_json` takes a body-cacheability policy.** ComicVine's error envelopes (107 rate limit, 100 bad key, 101 not found) were being cached under the requested URL for the full TTL — 12 hours for a search, 7 days for a detail lookup. A brief rate-limit blip mid-run replayed "rate limit exceeded" for exactly the books being matched, days after the real window reset, with no way to clear it.
- **`RateLimiter` models the budget and the velocity floor separately.** Smearing 200/hour into a flat `per_minute(3)` discarded the burst entirely: 40 lookups took 13 minutes with the hour untouched. It now allows 30 back-to-back and paces them at ComicVine's documented one request per second.
- **The usage ledger counts per resource,** as the per-resource limit actually works. Counting every endpoint into one 200-call pool fired "exhausted" at roughly a third of the real ceiling and abandoned the whole run. `budget_status()` reports used / remaining / `resets_in_ms` per pool.

### Metadata cache reuse for bulk matching

`search_issues_by_volume` issued `filter=volume:X,issue_number:N` per book — a distinct URL per issue number, so the URL-keyed response cache could never serve the second book. 50 books from one series meant 50 live calls against a 200/hour budget.

It now pulls the volume's issue index once (`filter=volume:X`, `field_list=id,issue_number`) and matches numbers client-side via the existing `issue_numbers_match`. That URL is byte-identical for every book in the volume, so the first book pays for it and the rest are served from `metadata_response_cache` without touching the API. Volumes over 200 issues keep the targeted query, where the index would never amortize.

### Additional context

`budget_status()` is not surfaced in the UI — that needs a GraphQL field plus schema and TS client regeneration. Straightforward follow-up if it's wanted.

The book-to-book navigation path is confirmed fixed and covered by a test. If the symptom persists specifically when tapping a book _from a grid_, that path mounts fresh and would need separate investigation.

## Screenshots

Not captured — this branch was developed headless, with no running server or library data to render the book page against. The visual changes to verify:

- Book detail at phone/tablet width: the metadata table's Edit button should sit above the table rather than on top of the field values.
- With a scan or metadata job running: the expanded job card should float at the bottom-right of the viewport rather than sitting in the page flow over the content.

## Ready?

- [ ] I read the [contributing guidelines](https://github.com/stumpapp/stump/blob/main/.github/CONTRIBUTING.md)
- [x] I searched for existing issues or pull requests that may be related to my contribution
- [ ] This PR is based into `nightly` and not `main` — based into `main` as requested, matching this fork's recent practice (#31, #32, #33)
- [x] I added tests and/or documentation for my changes if applicable

### Verification

Every CI gate was run locally against this diff and passes:

| Gate                                                    | Result                  |
| ------------------------------------------------------- | ----------------------- |
| `cargo fmt --all -- --check`                            | pass                    |
| `cargo clippy -- -D warnings` (lib and `--all-targets`) | pass                    |
| `cargo dump-schema -- --check`                          | pass (no schema change) |
| `cargo test` (workspace)                                | pass                    |
| `yarn lint`                                             | pass                    |
| `yarn test`                                             | 500 passed, 72 suites   |

The new `BookOverviewScene.test.tsx` was verified to fail without the fix (`Expected: "book-b", Received: "book-a"`), and both ComicVine cache tests assert against the live network-call count so they cannot pass vacuously.

---

_Generated by [Claude Code](https://claude.ai/code/session_01SXUSFFgDmWkReahnWGfSDt)_

---

## #35 — ci: retry the GHCR push so a DNS blip does not discard a build

- state: MERGED · merged 2026-08-11 · `dfea10a2`
- author: SaintedRogue

## Description

The publish run for the #34 merge failed, leaving that merge unpublished. It was not a build failure — the image built, and the push had uploaded every layer — it was the registry becoming unresolvable partway through:

```
Head "https://ghcr.io/v2/saintedrogue/longbox/blobs/sha256:42a5...":
  dial tcp: lookup ghcr.io on 8.8.8.8:53: read udp 10.0.0.2:46785->8.8.8.8:53: i/o timeout
```

The same push had already logged `dddf8b0aaa1b: Retrying in 5 seconds` for one blob and recovered from it — docker retries individual blob uploads on its own, but nothing retries the manifest request, and one failed step discards a build that takes minutes.

- `docker push` is retried per tag, up to 5 attempts with exponential backoff (10s → 160s). Pushes are idempotent, so a retry re-uploads nothing: already-transferred layers come back as "Layer already exists".
- The resolved digest is now checked before being handed to `actions/attest-build-provenance`, so an empty value fails at its cause rather than inside the attestation action.

### Reasoning

This is the first publish failure in the last 15 runs on `main`, so it is not a systemic break — but the cost of a single transient resolver failure is a merge whose image never ships, which then needs a manual re-run. Retrying is the proportionate fix.

### Additional context

This does **not** fix the underlying flakiness. The runner is resolving through `8.8.8.8` and timing out; pointing the Unraid host at a LAN resolver (or adding a secondary) would reduce the flakes at source. The retry only stops a momentary one from costing a publish.

The `Attest build provenance` step does its own registry I/O and is exposed to the same failure. It is a `uses:` step, so retrying it inline would mean taking on a third-party retry action — left alone deliberately rather than adding a dependency for a failure mode not yet observed.

## Ready?

- [ ] I read the [contributing guidelines](https://github.com/stumpapp/stump/blob/main/.github/CONTRIBUTING.md)
- [x] I searched for existing issues or pull requests that may be related to my contribution
- [ ] This PR is based into `nightly` and not `main` — based into `main`, matching this fork's practice and where the failing workflow runs
- [x] I added tests and/or documentation for my changes if applicable

### Verification

The workflow YAML parses, and the retry function was exercised against a stubbed `docker` for both paths:

- fails twice, succeeds on attempt 3 → returns 0, no spurious error
- fails always → 5 attempts, emits `::error::`, returns 1 (job fails as it should)

No application code is touched, so the Rust and TypeScript gates are unaffected.

---

_Generated by [Claude Code](https://claude.ai/code/session_01SXUSFFgDmWkReahnWGfSDt)_

---

## #36 — feat(filters): field-first filter picker, scoped to the library

- state: MERGED · merged 2026-08-11 · `a7fb7aae`
- author: SaintedRogue

## Description

Replaces the filter drawer in the library views with a field-first picker, and makes its options describe the library you are actually looking at.

**Scope filter options to the library** (`e00a675`)

- `mediaMetadataOverview` takes an optional `libraryId` alongside the existing `seriesId`. Both stay optional and compose, so an unscoped overview keeps its current no-join query plan.
- `library_id` lives on `series` rather than `media`, so library scoping needs one hop further than series scoping. That second join is added only when the filter is present.
- On the web side a library view always passes its `libraryId`; series scoping stays behind its existing opt-in checkbox.
- Reasoning: unscoped, a library with no manga in it still offered every manga genre on the server, and picking one returned nothing. The options described the server, not the shelf in front of you.

**Field-first filter picker** (`53a3099`)

- New header control next to sort. The popover opens on the list of filterable fields; picking one drills into that field's values with a search box over them. Clicking a value applies it immediately — no Apply button to forget.
- Selections are any-of, so picking three genres widens rather than narrows.
- Publication year and age rating come along as a two-input range screen, so this is a full replacement rather than a partial one. File type moves from a single `eq` to `anyOf`, and URLs written by the old drawer with `eq` still read back correctly.
- Reasoning: the drawer stacked twelve multiselects in one scrolling column. Every field was on screen whether or not you wanted it, and each one's options — writers, characters, publishers — run to thousands of entries in a real library, so the one thing you could not do was search for the value you had in mind.

Two fixes fell out of it:

- `getActiveFilterCount` counted top-level keys, so everything under `metadata` — nearly every filter there is — collapsed into one, and a view narrowed by three genres and two writers badged a `1`. It now descends into nested inputs and stops at the operator object, counting fields. Stopping at the operator is what keeps a bounded range one filter instead of two.
- Applying a filter resets to page 1. Instant apply made the pre-existing behaviour visible: narrowing from page 5 left you on page 5 of a result set that might now be one page long, which reads as "my filter returned nothing".

### Additional context

Wired into Library Books and Library Series. The three other scenes that use `URLFilterDrawer` — Series Books, Book Search, Series Search — are deliberately left alone: they have no library context, so their options stay server-wide, and that is worth deciding on its own rather than by default. The drawer and the two filter forms stay in the tree for them.

The `series` field on the media picker filters the ComicInfo `<Series>` string, which is not the series a book is filed under on disk. That matches the drawer's behaviour; the label reads "Series (from metadata)" to keep the two apart.

## Screenshots

Not included — the picker has not been viewed in a browser. Its interaction is covered by the render tests below rather than visually; popover sizing and the mobile alignment are worth an eye before release.

## Ready?

- [x] I searched for existing issues or pull requests that may be related to my contribution
- [x] I added tests and/or documentation for my changes if applicable

Verification — 29 new tests: 16 over the field descriptors and counting logic, 13 driving the picker's real interaction (drill-in, search, toggle, blur-commit, badge, back navigation, clear). Full frontend suite 529 passed across 74 suites. `ci-preflight` green on `cargo fmt`, `clippy -D warnings`, `dump-schema --check`, `cargo test` (119 in `graphql`), `yarn lint`, `yarn test`. The schema SDL and TS client are regenerated and committed.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01SXUSFFgDmWkReahnWGfSDt

---

_Generated by [Claude Code](https://claude.ai/code/session_01SXUSFFgDmWkReahnWGfSDt)_

---

## #37 — fix(web): filters never applied, and every series showed the first one

- state: MERGED · merged 2026-08-11 · `1ab49a7a`
- author: SaintedRogue

## Description

Two separate bugs, both reported from the library views.

### Filters could not be applied

The picker set the filters and then called `setPage(1)` to drop back to the first page. Both go through `setSearchParams`, which builds its next URL from the location of the render it was created in — so the page reset started from the pre-click params, which do not carry the new filters, and its `navigate` landed on top of the one that did. The filter was written and immediately thrown away, so clicking a value did nothing at all.

- The page reset moves into `setFilters`, so it is one write and one navigate. That is also the only place it can be correct, since only `setFilters` knows the filters and the page are changing together.
- `setFilters` now merges into the existing params rather than rebuilding them from ordering and pagination alone. That fixes a second thing on the same line: picking a filter used to drop the active search, because `search` was simply not among the keys being written back.

This was a regression in the filter picker. Its own tests missed it because they mock `setFilters` and `setPage` separately, so nothing could observe the two clobbering each other — the picker test now asserts a single write, and `useFilterScene` covers that the reset still happens.

### Every series opened the first series

`SeriesLayout` read the series through a react-query key of `['seriesById']`, with no id in it. Every series in the app therefore shared one cache entry: whichever you opened first filled it, and opening any other one afterwards re-rendered that first payload. Not specific to any one series — whichever you happened to click first.

- The key now includes the id, via the same `sdk.cacheKey` builder the rest of the app uses.
- `usePrefetchSeries` was already keyed by id, so the prefetch and the read were not even addressing the same entry; it moves onto the shared builder too.
- `SeriesLayout` was the only reader in the codebase keyed without its identifier — the others were checked.

### Additional context

Reported alongside these: the Series tab's filter offers only three fields. That is the series field set working as built rather than a fault, and is being addressed separately by giving series a real vocabulary to filter on.

## Screenshots

Not applicable — no visual changes; both fixes are to behaviour.

## Ready?

- [x] I searched for existing issues or pull requests that may be related to my contribution
- [x] I added tests and/or documentation for my changes if applicable

Verification — the filter bug was reproduced in a failing test first (the URL came out `?page=3` with the filters discarded) before being fixed. The series cache-key test was confirmed to catch its bug by reintroducing it: 2 failures with the bug, 3 passes with the fix restored. Full frontend suite 541 passed across 75 suites; `yarn lint` and `check-types` clean. No Rust changes.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01SXUSFFgDmWkReahnWGfSDt

---

_Generated by [Claude Code](https://claude.ai/code/session_01SXUSFFgDmWkReahnWGfSDt)_

---

## #38 — feat(filters): give series a real set of fields to filter on

- state: MERGED · merged 2026-08-11 · `25ecbf6b`
- author: SaintedRogue

## Description

The series tab's filter offered three fields — status, publication year, age rating — against the book tab's fourteen. That reads as a broken control rather than a thin one, and it is: `series_metadata` carries plenty more worth narrowing a shelf by, there was simply nowhere to source the values from.

- Adds `seriesMetadataOverview(libraryId)`, the series counterpart to `mediaMetadataOverview`, returning the distinct publishers, imprints, book types and statuses. Scoping is one join rather than the media overview's two, since `library_id` sits on `series`, which owns the metadata row directly. An unscoped overview keeps a no-join query plan.
- Adds `find_for_column` to the `series_metadata` entity, mirroring the helper on `media_metadata`.
- Series fields go from three to eight: **publisher, imprint, book type, status, read status, publication year, volume, age rating**.
- Status stops being a hard-coded Continuing/Ended pair and comes from the server with the rest. The column is free text and providers do not agree on it as reliably as the entity comment suggests, so a fixed list offered values no series in the library had — the same complaint that motivated scoping options to the library in the first place.
- Read status is the one series field that lives at the top level of the filter input rather than under `metadata`, so it is written there.

### Additional context

The picker holds both overview queries until the popover is opened, and only the one matching the entity runs, so a browse page pays for neither until asked.

## Screenshots

Not included — this has not been viewed in a browser; the field list and value drill-in are covered by the render tests below.

## Ready?

- [x] I searched for existing issues or pull requests that may be related to my contribution
- [x] I added tests and/or documentation for my changes if applicable

Verification — new Rust tests cover the unscoped no-join plan, the library-scoping join, and the entity helper's SQL. Frontend tests cover the field list, that series values come from the series overview rather than the media one, the `bookType` → `booktype` column mapping, read status writing at the top level, and the volume range round-trip. `ci-preflight` green across `cargo fmt`, `clippy -D warnings`, `dump-schema --check`, `cargo test`, `yarn lint`, `yarn test`. Schema SDL and TS client regenerated and committed.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01SXUSFFgDmWkReahnWGfSDt

---

_Generated by [Claude Code](https://claude.ai/code/session_01SXUSFFgDmWkReahnWGfSDt)_

---

## #39 — feat(metadata): review fields before applying a hand-picked match

- state: MERGED · merged 2026-08-11 · `bf5a64dd`
- author: SaintedRogue

## Description

"Find metadata match" applied the whole candidate the moment you selected it. Picking the right _match_ and accepting every one of its _fields_ are two different decisions, though: a provider that identifies the issue correctly can still carry a worse summary, or the wrong creators, than what is already on the book. There was no way to say no to part of it.

The field-by-field review already existed for automatically queued matches — a checkbox per field, current value beside candidate value, per-field manual override, and field locking. It was simply unreachable from the on-demand search, which is the path you take when you already know the automatic guess was wrong and most want the control.

Selecting a candidate now opens that review rather than applying. **Nothing is written until the review is accepted.**

### Why this needed no new UI and no backend work

- `acceptMediaMatch` / `acceptSeriesMatch` already accepted `excludeFields` and `overrides` — the search dialog's mutation just never declared them.
- The search already runs with `autoApply: false`, deliberately leaving a fetch record awaiting review, and `metadataFetchRecord(id: {media|series: …})` reads it back.
- So selecting a candidate reads that record and opens the existing review dialog on it.

The review opens positioned on the candidate that was clicked — `open()` takes a `startCandidateIndex` now. That matters because the accept mutation re-runs the search server-side and applies whichever candidate sits at that index, so opening on candidate 0 would quietly review a different match than the one selected.

Accepting now invalidates every query rather than only the pending-matches list. That list was the only caller before; reached from the book page, a narrow invalidation would leave the title and credits that were just rewritten stale on the screen behind the dialog.

Applies to both books and series, which share the dialog.

## Screenshots

Not included — not viewed in a browser. The handoff is covered by the tests below, but the review dialog rendering in this new context (it was built for a settings scene, and opens here over a book page) is worth an eye.

## Ready?

- [x] I searched for existing issues or pull requests that may be related to my contribution
- [x] I added tests and/or documentation for my changes if applicable

Verification — new tests drive the dialog through a search and a selection, asserting the review opens, that it opens on the candidate that was picked rather than the first, and that selecting writes nothing (the only mutation run is the search itself). Full frontend suite 552 passed across 76 suites; `ci-preflight` green. No Rust changes, so those gates are correctly skipped.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01SXUSFFgDmWkReahnWGfSDt

---

_Generated by [Claude Code](https://claude.ai/code/session_01SXUSFFgDmWkReahnWGfSDt)_

---

## #40 — feat(metadata): toggle providers from the card, and stop demanding a stored credential on edit

- state: MERGED · merged 2026-08-11 · `5d8e89de`
- author: SaintedRogue

## Description

Two changes to managing metadata providers, both about the same friction: turning a provider on or off was far harder than it should be.

### 1. Toggle a provider on or off from its card

Enabling and disabling is the one provider setting worth changing on a whim — a provider is rate-limited, or down, or returning bad matches, and you want it out of the rotation without touching its credentials. That meant opening the edit dialog, finding the toggle among the API-token fields, and saving a form.

The card already showed the state as a badge. It is now a switch, so the thing that reports the state is also the thing that changes it, sitting alongside the Test button.

- **No backend work.** `PatchMetadataProviderConfigInput` is all-optional, so this sends `enabled` alone rather than round-tripping the rest of the config.
- The switch moves on click and clears its local value only once the refetch has landed. Clearing when the mutation resolves would snap it back to the stale cached value for the gap in between.
- A rejected change reverts and surfaces a toast — a switch left in a state the server refused reads as though the provider were off when it is still in the rotation.
- In-flight changes disable the switch, so a double-click cannot queue two conflicting patches.
- Read-only viewers keep the badge; the switch is gated on `MetadataProviderManage`, matching the edit and test actions beside it.

### 2. Editing a provider no longer demands its credential again

Opening a saved provider, flipping the enable switch and saving failed asking for an API token — one the server already holds, and never returns, so the field is always blank there. Changing any setting meant digging the credential back out of wherever you keep it.

The edit form was validating against `createConfig` rather than `patchConfig`. Creating a provider genuinely does require a token, so every edit inherited a rule that only makes sense when there is nothing stored to fall back on.

- The patch schema now treats a blank credential as "keep what you have": empty and null both collapse to `undefined`, so the key is omitted from the patch rather than sent as an empty string that would overwrite the stored one.
- Blank now also _says_ so. The field explains that a key is already saved and that leaving it alone keeps it, with a masked placeholder standing in for the value. An empty box with no explanation reads as "no credential set", which is what made the old error look like a bug in saving rather than a missing field.
- Creating a provider is unchanged and still requires a token.

## Screenshots

Not included — not viewed in a browser. The switch replaces a badge in an existing row, so it is worth confirming the row still balances against the Edit button and expiry warning.

## Ready?

- [x] I searched for existing issues or pull requests that may be related to my contribution
- [x] I added tests and/or documentation for my changes if applicable

Verification — 7 tests on the switch (current state, patching `enabled` alone in both directions, immediate visual response, refresh on success, revert on failure, disabled in flight) and 8 on the schema (blank and null both omitting the token, a real token surviving, the edit form's own defaults validating, and creation still rejecting an empty token). Full frontend suite 567 passed across 78 suites; `ci-preflight` green. No Rust changes, so those gates are correctly skipped.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01SXUSFFgDmWkReahnWGfSDt

---

## #41 — fix(metadata): rejecting drops a candidate, not the whole record

- state: MERGED · merged 2026-08-11 · `39526d88`
- author: SaintedRogue

## Description

Rejecting a match left the row sitting in the pending list, and coming back to it later showed a _different_ match than before.

Both symptoms follow from the same mismatch. `rejectMediaMatch` removes **one candidate** from the record's list and leaves the record awaiting review while it still has others — only an empty list flips it to `NO_MATCH`. The dialog treated the same click as a verdict on the whole record: it announced "Match rejected" and advanced to the next record, so the remaining candidates were never reviewed, just skipped. The row stayed because the server was right to keep it, and the next visit opened on whatever candidate had moved into the top slot.

- **Rejecting now stays on the record**, drops that candidate from the list on screen, and moves on only once nothing is left to choose from — which is the point at which the record really does leave the pending list. The toast distinguishes "Candidate rejected" from "All candidates rejected".
- The position is held rather than reset, so rejecting the 2nd of 5 lands on whatever moved into that slot instead of sending you back to the top.

### All candidates on screen

The prev/next stepper reading "2 of 9" is replaced by the full list — provider, title and confidence per row, click to select. Nine results across three providers meant clicking through the whole list to learn what was on offer while holding the ones already seen in your head. Reviewing a match is a comparison, so the options have to be comparable.

Switching candidates clears any field-level decisions: excluding a summary was a judgement about one provider's result and must not silently carry to another's.

### Row count under the table

Noticed while reproducing: the table read **"1 to 10 of 10" above a single row**. The count fell back to `pageCount * pageSize` whenever no total was given, rounding any short list up to a full page. That estimate is only right for a server-paginated table, where the data is one page and its length says nothing about the total; a client-paginated table has every row in hand and can just count them. Shared component, so both paths are covered by tests.

## Screenshots

Not included — not viewed in a browser. The candidate list replaces a single-row toolbar, so it is worth confirming the dialog still fits with nine candidates listed (the list caps at a scrollable ~40 units).

## Ready?

- [x] I searched for existing issues or pull requests that may be related to my contribution
- [x] I added tests and/or documentation for my changes if applicable

Verification — 9 store tests (dropping only the rejected candidate, keeping the record while others remain, holding position, clamping off the end, reporting an empty list, leaving other records untouched, direct selection, clearing field decisions on switch, opening on a given candidate) and 4 table tests. The table fix was confirmed to catch its bug by reintroducing it: 2 failures, then 4 passes with the fix restored. Full frontend suite 580 passed across 80 suites; `ci-preflight` green. No Rust changes — the server behaviour was already correct; only the client's reading of it was wrong.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01SXUSFFgDmWkReahnWGfSDt

---

_Generated by [Claude Code](https://claude.ai/code/session_01SXUSFFgDmWkReahnWGfSDt)_

---

## #42 — feat(metadata): League of Comic Geeks provider behind an acknowledgement gate

- state: MERGED · merged 2026-08-12 · `205511d3`
- author: SaintedRogue

League of Comic Geeks has no usable API. Its private one at `/api/*` answers every request without a client key with `403 {"error":"Invalid API Key."}`, and there is no route for a self-hoster to obtain one — the `Himon` wrapper that had credentials was archived in March 2026. So this provider does what the maintained third-party clients do: it signs in with the operator's own account and reads the site's own endpoints.

**LOCG's Terms of Use prohibit automated access.** The provider is therefore **absent** from the add-provider list — not disabled, absent — until the server owner acknowledges what using it means.

## Phase 0 — the gate

- `server_config.unofficial_providers_acknowledged_at`, a nullable timestamp: auditable, and clearable to re-prompt if the wording changes.
- Collapsed **"Unofficial integrations"** panel in Settings → Metadata stating plainly that there is no public API, that it uses your personal login, that their terms prohibit automated access, and that you act as yourself and accept the consequences.
- Enforced **server-side** in `create_metadata_provider`, not just in the UI. Hiding a card is not a gate.
- `MetadataProvider::is_unofficial()` is generic, so any future no-API provider inherits the gate for free.

## Phase 1 — the read provider

`search_series`, `search_media`, `fetch_series_metadata`, `fetch_media_metadata`, `validate_credentials`, `fetch_upcoming_releases`. No write methods — the read trait stays read-only.

Parsing is split so a redesign is a one-file fix: **every** CSS selector lives in `locg/selectors.rs`, parsers in `locg/parse.rs`, the credit role table in `locg/roles.rs`.

## Site behaviour worth knowing, all verified live

| Finding                                                                                | Consequence in the code                                                                                                                                                                                                                               |
| -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Login success is `303 → /dashboard`; **failure is `200`** with the form re-rendered    | `validate_credentials` reads the landing path, not the status                                                                                                                                                                                         |
| `ci_session` is reissued on **every** response (~12.5d)                                | The cookie jar is the source of truth; credentials stored as `username:password` per Metron's precedent                                                                                                                                               |
| `/comic/{id}` returns **200 with a "Page Not Found" body** — a soft 404                | Issue pages need a slug                                                                                                                                                                                                                               |
| A wrong slug **301s when logged out but hard-404s once a session exists**              | The canonical slug is resolved with a deliberately session-less redirect probe, then the page is fetched as the operator                                                                                                                              |
| `format[]` widening is **not monotonic**                                               | Strict superset on a series listing (+9 collected editions, 0 lost) but _not_ on weekly releases, where `1,3,4,6` gains 41 collected editions and **drops 120** digital-first serials. The release sweep issues two requests per week and unions them |
| Release cards carry **no series id in any view**                                       | `fetch_upcoming_releases` resolves one page per distinct series, bounded, ordered by `pulls`, truncation logged — never silent                                                                                                                        |
| Role strings are free text and **compound** ("Writer, Artist, Colorist" is one person) | Split before mapping; unmapped roles logged, not dropped                                                                                                                                                                                              |

Coverage was measured against a real 241-series library that is 87% omnibuses: an issues-only `format[]=1,6` filter matched 5 of 16 sampled titles, adding the collected-edition formats matched 10, and widening further was measured to buy nothing while adding ~16% more rows per query.

## Testing

**44 tests**, every parser exercised against fixtures captured from the live site; client behaviour against wiremock. **No test touches the network.** 4 `#[ignore]`d live probes follow the existing `METRON_CREDENTIALS` convention and are gated on `LOCG_CREDENTIALS`.

Live verification ran end to end: credentials validate, an issue fetch returns correct title/summary/page count/dates/credits, upcoming releases resolve real series ids, and a search for a real omnibus returns its collected edition. The Phase 0 gate was driven in a real browser — 16/16 checks across hide → acknowledge → appear → withdraw → hide.

## Notes for the reviewer

- Phase 0 and Phase 1 land in one commit because the change is compiler-coupled: adding the `Locg` variant forces every `Record<MetadataProvider, T>` map and match site to update together.
- **Reads work anonymously** — the login buys attribution, not capability. Keeping it is a deliberate accountability choice, not a technical requirement.
- LOCG confidence tops out near **0.71** on exact title matches because it has fewer structured fields than ComicVine/Metron. Expected, not a bug — but a 0.95 auto-apply threshold will never fire for it.
- `.prettierignore` now excludes captured provider fixtures. They are verbatim site responses, not source; the `.html` captures were already unchecked, so this makes the set consistent.
- LOCG ships no logo asset — `ProviderLogo` renders a monogram fallback rather than vendoring someone else's trademark.

`ci-preflight` green on all six gates.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01GMKPoe7qDSVx73wDgaYkkL

---

## #43 — fix(metadata): the scheduled metadata retry never retried anything

- state: MERGED · merged 2026-08-12 · `1146bd21`
- author: SaintedRogue

## The bug

`dispatch_metadata_retry` selects fetch records **by status** — `RateLimited` by default — and hands their ids to the metadata fetch job. The job, when not forced, skips any entity whose record status is in its skip list:

```rust
if !self.params.force_refetch {
    // ... skip if status is in [AwaitingReview, Fetched, RateLimited]
}
```

Both `MetadataFetchJobParams::media` and `::series` hardcode `force_refetch: false`. So the job skipped **precisely the records the retry had just selected.**

Net effect: in its default configuration the retry job was a no-op. It could only ever act on statuses _outside_ the skip list — in practice `NoMatch`, and only if someone configured it that way. It went unnoticed because scheduled jobs did not fire at all until #33.

## The fix

| Change                             | Why                                                                                                                                                                                                   |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Extract `SKIP_STATUSES`            | It was an anonymous array duplicated at two call sites, and it _is_ the re-fetch policy. Worth naming, and worth documenting that a job targeting those statuses must force.                          |
| Add `retry_media` / `retry_series` | They force. Putting the requirement in the constructor name is what stops it being silently undone — the plain constructors still respect existing outcomes, which is what a scan-driven fetch needs. |
| Name `DEFAULT_RETRY_STATUSES`      | So a test can assert the overlap that makes forcing mandatory.                                                                                                                                        |

## Tests

`default_retry_statuses_require_forcing` asserts both halves: that every default retry status is one the job skips, and that the retry constructors force. **Verified non-vacuous** — flipping `retry_media` back to `false` fails it with "a media retry that does not force is a no-op".

`ordinary_scopes_do_not_force` guards the opposite direction, so nobody "fixes" this by forcing every scope and re-searching matched books.

## Deploy note

A retry job that has been quietly doing nothing will start doing work — including provider requests for every rate-limited record it finds. Worth knowing before this reaches a server with a nightly retry configured.

Found while mapping re-fetch policy for the LOCG provider (#42); unrelated to LOCG itself and safe to land independently.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01GMKPoe7qDSVx73wDgaYkkL

---

## #44 — fix(metadata): adding one file re-searched the whole unmatched backlog

- state: MERGED · merged 2026-08-12 · `d537965b`
- author: SaintedRogue

## The bug

A library scan that creates any media enqueues a follow-up metadata fetch scoped to the **entire library**:

```rust
// Note: I figure we only care about new entities
if has_relevant_provider && did_create_media {
    ctx.enqueue(LongboxJob::metadata_fetch(
        MetadataFetchJobParams::media_in_library(self.id.clone()),
    ))
}
```

The intent in that comment is right, and the skip list mostly delivers it — a book with a match is left alone. But `NoMatch` was **missing** from `SKIP_STATUSES`, so the walk re-searched every previously-unmatched book against every enabled provider.

The cost is paid per _scan_, not per new book. Dropping one file into a 600-book library where 100 never matched means 100 books × N providers of requests nobody asked for. With a provider that publishes no rate limit and is therefore paced conservatively, that is hours of traffic from a single file.

## The fix

One entry added to `SKIP_STATUSES`, with the reasoning recorded next to it. Retrying an unmatched book is worth doing — a provider may have catalogued it since — but **deliberately**, not as a side effect of a scan.

Three paths still reach those records, all operator-chosen:

| Path                     | How                                         |
| ------------------------ | ------------------------------------------- |
| Scheduled metadata retry | configure its statuses to include `NoMatch` |
| Forced re-fetch          | `fetchLibraryMetadata(force_refetch: true)` |
| Per book                 | "Find match" in the UI                      |

## Depends on #43

Without the forcing fix from #43, the scheduled retry could not reach a `NoMatch` record either — so this change on its own would have closed the _only_ working retry path rather than redirecting it. #43 is merged, so all three paths above work.

## Tests

`a_scan_does_not_re_search_the_unmatched_backlog` asserts the three facts that together are the behaviour: `NoMatch` is skipped, scan-driven scopes don't force, and a deliberate retry does. **Verified non-vacuous** — removing the `NoMatch` entry fails it with "an unmatched book must not be re-searched by an incidental library walk".

Found while mapping re-fetch policy for the LOCG provider (#42); unrelated to LOCG itself.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01GMKPoe7qDSVx73wDgaYkkL

---

## #45 — feat(metadata): enrichment pool so providers add rather than compete

- state: MERGED · merged 2026-08-12 · `91221032`
- author: SaintedRogue

Phase 2a — the data layer. A book can now hold metadata from several providers at once, and every stored field knows which source it came from.

## Why

`media_metadata` has a single `metadata_source` / `metadata_external_id` pair. The moment a book matched ComicVine it had nowhere to keep its LOCG id, which blocked enrichment and — less obviously — **broke the LOCG release calendar**, since that joins on a stored provider id and could never find a ComicVine-matched series. LOCG's release calendar is the main reason it's here at all, so that was the case that mattered most and could not work.

## Two tables

| Table                    | Grain                          | Holds                                                                                                                                          |
| ------------------------ | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `external_metadata_link` | one row per (entity, provider) | the provider's id, its captured payload, and whether it's a `candidate`, `linked`, or `rejected`. Doubles as the link table two-way sync needs |
| `metadata_field_source`  | one row per (entity, field)    | which source won that field, and whether a human or the auto-apply chose it                                                                    |

`media_metadata` stays the single resolved record and the only thing library views read — neither new table is on a browsing path.

## How data arrives

1. **Every fetch** stores each provider's best candidate as a `candidate` row, so the review grid can compare LOCG against ComicVine _before_ either is accepted. An accepted link is never demoted by a later candidate.
2. **Applying** promotes that provider's row to `linked` and writes a provenance row per field actually written.
3. **Overridden fields** are attributed to `manual` and added to `locked_fields` — the existing mechanism that stops a fetch overwriting a value. Phase 2 doesn't invent locking, it starts _using_ it.

Knowing _which_ fields an apply wrote meant asking the merger, since the strategy, the lock list and the exclusions all get a say. `FieldMerger` now records what it wrote and what an override replaced — a handful of lines in one file instead of rewriting ~300 lines of per-field apply logic.

## Three things worth your attention

**The migration is raw SQL, deliberately.** The `CHECK` that exactly one of `media_id`/`series_id` is set cannot be added to an existing SQLite table, and the unique indexes must be **partial** — a composite unique index over a nullable column constrains nothing in SQLite. The composite primary key we first sketched for provenance would have silently allowed duplicate rows per field. I verified each constraint by inserting the violation and watching it be rejected:

```
duplicate (media, locg) link      -> REJECTED (UNIQUE)
same media, different provider    -> ALLOWED
both ids set / neither set        -> REJECTED (CHECK)
second PageCount for same book    -> REJECTED (UNIQUE)
```

**The backfill recovers links from the ad-hoc columns too.** On the dev database, all four recovered links came from `comicvine_id` with `metadata_source` **NULL throughout** — without that path they'd have been lost entirely.

**A field can be both merged and overridden.** Provenance is unique per (entity, field), so emitting a row for each would fail the insert and take the whole apply down. The override wins, since it's what survives in the record. Found by a test, not by review.

## Also fixed along the way

`merge_locked` parsed the lock list into typed fields, so **one** unrecognized token — a field added by a newer build, or renamed — made the whole list fail to deserialize and silently discarded _every_ existing lock. Locks are the operator's protection against their choices being overwritten, so losing them quietly is the worst available outcome. It now works on raw tokens and carries unknown ones through untouched.

## Tests

322 core tests pass. New coverage:

- two providers linking to the same book; re-applying updates one row rather than accumulating
- applied fields attributed to their provider; fields the provider had nothing for are _not_ claimed
- an overridden field attributed to `manual`, locked, and holding exactly one provenance row
- a series matched to ComicVine still found by a LOCG sweep — the capability the pool exists for
- a link for another provider does _not_ match a sweep, so ids stay provider-scoped
- migration verified forward and back against a copy of the real dev database

## Not in this PR

The `metadata_backfill_providers` column ships, but nothing can set it yet — honouring it in the fetch job lands with the GraphQL and UI that turn it on, rather than shipping logic no one can exercise. The multi-source review grid is the next slice.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01GMKPoe7qDSVx73wDgaYkkL

---

## #46 — feat(metadata): pick a field from any source that has it

- state: MERGED · merged 2026-08-12 · `d9da6811`
- author: SaintedRogue

Completes Phase 2. The pool landed in #45 but nothing could read it; this makes it visible and gives the library flag a way to be turned on.

## Reading the pool

`mediaEnrichmentPool` / `seriesEnrichmentPool` return every provider that has answered for an entity, plus the provenance of its stored fields — ordered `linked` first, then by confidence, which is the order a reviewer reads them in.

**Two shape bugs had to be fixed before a client could read a payload at all.** Both were invisible until something actually consumed it:

| Bug                                                                                                                                                                                                                                                          | Fix                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `ExternalMetadata` is a serde **union**, so serializing it produced `{"Media": {…}}` — every reader would have had to unwrap a Rust representation detail                                                                                                    | store the inner field bag; the entity kind is already known from which id column is set                                |
| The payload is stored in serde's `snake_case` so it round-trips back into `ExternalMediaMetadata`, but the client reads a field by the **same key it uses for a match candidate** — and those are `camelCase`, because candidates come through async-graphql | translate at the query boundary. Storage stays canonical, and the pool is readable with the existing field definitions |

## Picking a field

Each row in the review dialog now offers the _other_ sources' values for that field as chips. Clicking one adopts it as an override — which is also what attributes it to you and locks it against the next fetch. Rows show where the stored value came from.

Deliberately chips rather than a column per provider: a grid is readable at two providers and unreadable at four, and the comparison anyone actually makes is one field at a time. Sources with nothing for a field are omitted rather than rendered empty — a row of dashes hides the sources that _do_ have something.

## Backfill

With `metadataBackfillProviders` on for a library, a book that already has a match is no longer skipped outright: **only providers with no link row for it are asked.** If every compatible provider is already linked the book is skipped as before. Nothing already linked is ever re-searched, and the flag is off by default.

The comparison goes through `needs_backfill`, which exists to pin the id spelling — link rows store the trait id (`comicvine`) while the enum's `Display` form is `COMIC_VINE`. Comparing the wrong one matches nothing, which in backfill mode means re-asking every provider that had already answered. There's a test that spells both out.

## Verification

Preflight green on all six gates. Verified live against the running API with two seeded sources:

```
sources[0] comicvine  linked     0.94   pageCount: null   storyArc: "Absolute Universe"
sources[1] locg       candidate  0.71   pageCount: 44     editors: [Katie Kubert, Chris Conroy]
fieldSources           PAGE_COUNT <- locg (user)
```

`linked` first, keys camelCased, and LOCG carrying a page count and editors where ComicVine has neither — the enrichment case, working.

## Phase 2 is complete

| Slice                       |         |
| --------------------------- | ------- |
| 2a data layer               | #45     |
| 2b GraphQL + backfill       | this PR |
| 2c review grid + provenance | this PR |

Not built, and worth naming: the metadata _editor_ still edits the resolved record directly rather than sharing the review grid's source chips. Adopting a source value is a review-dialog action for now. That's a UI convergence rather than a capability gap — every source value is already reachable and attributable.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01GMKPoe7qDSVx73wDgaYkkL

---

## #47 — fix(metadata): pull the whole LOCG page, and unbreak the book layout

- state: MERGED · merged 2026-08-12 · `0b19dac3`
- author: SaintedRogue

Two unrelated problems from one report.

## LOCG returned almost nothing for a collected edition

Reviewing **Absolute Carnage Omnibus** showed LOCG's column as dashes for summary, writers, colorists, letterers, cover artists, pages and ISBN — all of which are plainly on [the page](https://leagueofcomicgeeks.com/comic/6266160/absolute-carnage-omnibus-hc). Four separate causes:

| Cause                                                      | Effect                                                                                                                                                                                                           | Fix                                                                                                                |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| **Candidates were never hydrated**                         | `search_media` built them from search _cards_, which carry title, publisher, cover, date — nothing else. Everything worth comparing exists only on the detail page, so a candidate arrived as a column of dashes | fetch the detail page for the top few results, bounded — the way Metron's `search_series` already hydrates per hit |
| **`div.header-intro` doesn't exist on collected editions** | publisher _and_ release date lost on every trade and omnibus                                                                                                                                                     | fall back to the header section's own text                                                                         |
| **Page count read the wrong number**                       | the summary ends "VENOM #16-20; and the EVERYONE IS A TARGET stinger **pages**", so taking the first `" pages"` and scanning back for digits turned an 880-page omnibus into a **20**-page one                   | the number must be adjacent to the word                                                                            |
| **Only the first paragraph of the description was kept**   | LOCG splits descriptions across several, and on a collected edition the third is the "Collecting …" list — the most useful paragraph for an omnibus                                                              | keep every paragraph                                                                                               |

Also **mapped ISBN**, which collected editions carry where single issues carry a UPC. The UPC has nowhere to go in Longbox; the ISBN does.

Verified live against `/comic/6266160`:

```
publisher   Marvel Comics        page_count  880
released    2020-09-23           isbn        9781302925291
summary     3 paragraphs incl. the full Collecting list
writers     13 (Donny Cates, Frank Tieri, Cullen Bunn, …)
plus artists, colorists, letterers, cover artists, characters
```

## The book page layout

Three defects, each measured in a browser before and after rather than eyeballed:

**The download row escaped its column and covered the description.** It lives in a ~200px column that cannot fit two labelled buttons plus the overflow menu on one line. Flex children default to `min-width: auto`, so the labels refused to shrink and the row pushed out over the text beside it. Wrapping alone didn't help — `flex-1` lets a child shrink below its basis, so instead of wrapping they squashed until "Download" truncated to a few characters and the menu sat on its neighbour. Now the primary download shares a line with the menu and the offline download gets its own.

**The metadata table ran off the right edge of the page.** The table already sets `overflow-x-auto` — but nothing in the ancestor chain constrained width, so the column grew to the table's intrinsic width and the _page_ scrolled sideways instead of the table scrolling internally. `min-w-0` down the chain fixes it. Measured page overflow: **112px → 0**.

**The collapsed description cut through the middle of a line**, leaving the gradient and the "Read more" pill on half-rendered text. The collapsed height is now a whole number of lines, with the line-height set on the same element the height is derived from rather than inherited and guessed at.

## Tests

48 LOCG tests (up from 46) plus 5 live probes, all passing. New coverage:

- a full collected-edition page fixture (Absolute Carnage Omnibus), asserting publisher, date, 880 pages, ISBN, summary and aggregated credits
- the "stinger pages" trap, which keeps the fixture phrase in place so the regression can't come back quietly
- candidates arriving hydrated — asserting the top result carries page count, ISBN, summary and credits that only exist on the detail page

`ci-preflight` green on all six gates.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01GMKPoe7qDSVx73wDgaYkkL

---

## #48 — perf(metadata): open a provider's page when it's needed, not for every result

- state: MERGED · merged 2026-08-12 · `0d36834e`
- author: SaintedRogue

LOCG's search endpoints are list views: a result carries a title, publisher, cover and date, while the summary, page count, ISBN, credits and characters live only on the item's own page. #47 fixed the resulting column of dashes by fetching that page for the top three results during **every search**. That was the wrong place for the work.

Only **one** candidate is ever rendered — the grid displays `matchCandidates[currentCandidateIndex]` — so two of those three fetches were always waste. And it does nothing for ranking either: the scorer uses title, publisher, year and number, all of which a card already carries.

## Measured, live, fresh client, 7 candidates

|                                       |                      |
| ------------------------------------- | -------------------- |
| Search with no detail fetches         | 4.4–4.6s             |
| Search fetching 3 (as shipped in #47) | 6.8–7.3s             |
| **Search after this change**          | **4.76s**            |
| The candidate you select              | **0.88s**, on demand |

The interactive saving is modest. **Bulk is where it mattered**: at the deliberate 15 req/min ceiling every request is 4s of sustained budget, so three per book across ~600 books added roughly **two hours** to a whole-library match — for pages nobody would open, since a bulk match never clicks anything.

## The fetch now happens at the two moments the data is used

**A reviewer selects a candidate.** New `mediaExternalMetadata` / `seriesExternalMetadata` queries. The grid compares against the fetched page and falls back to the card while it loads or if it fails — a thin candidate is still a valid match to accept. The column header shows `loading…` rather than dashes that then change under the reader.

**Auto-apply is about to write one.** No reviewer means nothing would trigger the fetch, and the record would be saved with title/publisher/date only. `hydrate_candidate_for_apply` fetches the page for the single candidate being written, wired into all four auto-apply sites through one helper.

## Which providers need it is a provider property

`MetadataProvider::search_returns_partial_metadata` defaults to `false`, so ComicVine and Metron pay nothing — a test pins that a provider without the flag passes through the helper untouched, because otherwise auto-apply would silently double its request count across a library. The client mirrors the flag in `PARTIAL_SEARCH_PROVIDERS`, the same way `isComicProvider` mirrors `supported_library_types`.

## Tests

47 unit tests plus 5 live probes. Notably `a_search_does_not_fetch_detail_pages` asserts **zero** detail requests during a search (`expect(0)`), so the previous behaviour can't return quietly.

I also deleted the three timing probes I'd added to produce the numbers above — they had no assertions and were diagnostics, not tests.

`ci-preflight` green on all six gates.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01GMKPoe7qDSVx73wDgaYkkL

---

## #49 — feat(omnibus): an Omnibuses tab for the library

- state: MERGED · merged 2026-08-12 · `f161da23`
- author: SaintedRogue

A fourth tab beside Books, Series and Files, listing the library's omnibus **sets**: one card per set, badged with its volume count, volumes opening in place.

## Why

Neither existing tab can show you your omnibuses. The Series tab makes each set a folder you click into — for a library that is 210 omnibuses out of 241 series, that's 210 clicks. The Books tab mixes omnibus volumes in with every individual issue.

## What counts as an omnibus

A book qualifies when **any** of these says "omnibus", case-insensitively: its `name`, its `metadata.title`, its `metadata.format`, or **its series' name**.

That last signal is what covers a flat library, where the folder carries the name (`Wolverine Omnibus (Marvel, 2020-...) (01-05)`) and the files inside it are called `v01.cbz`. `format` is included even though nothing populates it yet — it already exists as a column, it's the principled signal, and setting it by hand in the metadata editor is the escape hatch for a book the name rule misses.

## The one decision everything rests on

Grouping happens in the resolver, and **pagination is applied to the sets, not the books**.

The cheaper version — expose `format` as a filter, group in the browser — puts the page boundary inside a five-volume set. The volume badge then counts only the volumes the current page happened to contain, and the set reappears as a second card on the next page. Sorting by series makes sets adjacent enough to hide the seam most of the time, but it doesn't fix the count, and it costs you every other sort order permanently.

Grouping on the series alone would have been simpler still, and wrong in the other direction: a series named plain `Batman` holding a hundred issues and one `Batman Omnibus Vol 1` would become a hundred-volume omnibus. So a set is keyed on its series only when the _series name itself_ says omnibus, and on a normalized title otherwise — which also covers loose files with no series row.

The rule lives in `core/src/omnibus.rs`, not in the GraphQL crate, so a future scan-time detector that materializes sets as `book_group` rows can reuse it without a move.

## Notable

- **`StackedSeriesCard` gained an `onPress` mode.** The card is a button rather than a link because a set isn't a destination — everything about it is already on the card and in the volumes underneath. Wrapping the existing link in a button would nest two interactive elements and break keyboard and screen-reader behaviour, so the element itself changes.
- **The memory bound is stated, not hidden.** Grouping is in memory, capped at 10,000 qualifying books (~410 in practice). Hitting it logs a warning and flags every set `truncated`, so the UI can say the shelf is partial rather than present an incomplete collection as the whole thing.
- **A `limit: 0` cursor guard.** `PaginationValidator` only rejects a zero page size on the offset variant, so a zero cursor limit reached the last-item arithmetic and underflowed.
- **en-GB gets no key** — it has no `libraryHeader` block and falls back to en-US.

## Testing

19 tests. The naming rule is pure and covered without a database; four tests exercise the real schema, because the condition filters on `media_metadata` columns reachable only through a join and on a `series` subquery — a mistake there is a runtime error no string-level test would catch. They earned their keep immediately, catching that `series.library_id` is a real foreign key (needing a `library`, which needs a mandatory `library_config`) and that `media.size`, `pages` and `status` are NOT NULL without defaults.

All six CI gates pass locally: `cargo fmt`, `clippy -D warnings`, `dump-schema --check`, `cargo test`, `yarn lint`, `yarn test`.

**Not yet verified in a browser** — the scene is type-checked and the query is proven against the schema, but nothing has rendered the shelf against real covers. The dev database has no omnibus-named series to render.

## Deliberately out of scope

Excluding a book the name rule wrongly caught (including one already works via `format`); a cross-library shelf UI (the `libraryId` argument is already optional, no screen omits it); provider-populated `format`, which would mean widening `ExternalMediaMetadata`.

Spec: `docs/superpowers/specs/2026-08-12-omnibus-shelf-design.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01GMKPoe7qDSVx73wDgaYkkL

---

## #50 — fix(omnibus): make a card a book, not a set

- state: MERGED · merged 2026-08-12 · `6213ebc4`
- author: SaintedRogue

The collapsed shelf shipped in #49 was wrong. This replaces it: **a card is a book, and one click opens it.**

## What was wrong

Two things, one of them mine and obvious in hindsight:

1. **It added a click to a screen whose purpose was removing clicks.** You clicked a set card to reveal its volumes, then clicked a volume to open it — for the sake of a volume count nobody needed.
2. **The expansion panel was broken.** It rendered `BookCard`s in an unconstrained flex row, and `BookCard` sizes itself to a grid column, so every cover ballooned to the full page width.

## Why this is much _less_ code, not more

Grouping had to happen on the server **only** to keep volume badges honest across a page boundary. With no sets there are no badges — so paginating books is correct, and the approach I previously rejected as "quietly wrong" becomes the right one. That objection was specific to collapsed cards, not general.

So `isOmnibus` lands as a `MediaFilterInput` field beside the `isStandalone` it mirrors — derived rather than stored, negated when `false` — and the ordinary `media` query serves the shelf.

`LibraryOmnibusScene` is now a wrapper around `LibraryBooksScene` with `{ isOmnibus: true }` preset. That means the tab gains **sorting, the table view, the grid size slider, the alphabet strip and pagination** without any of it being written twice, and it keeps inheriting improvements to that scene.

`LibraryBooksScene` takes three optional props, all defaulting to today's behaviour so the Books tab is untouched:

| Prop           | Purpose                                                                                            |
| -------------- | -------------------------------------------------------------------------------------------------- |
| `presetFilter` | AND-ed into every query the scene makes                                                            |
| `variant`      | Separates cached pages, saved layout and remembered scroll position                                |
| `emptyState`   | Its own words — "do you have any books in your library?" is the wrong question for a filtered view |

## Deleted rather than left dormant

The `omnibusSets` query, the `OmnibusSet` object, `group_sets` / `SetKey` / `strip_volume_tokens` / `normalize_key`, and the `MAX_QUALIFYING_BOOKS` in-memory ceiling with its `truncated` flag — pagination is in SQL now, which has no such bound. `StackedSeriesCard` is back to a zero diff, since its button mode existed only for the card that expanded.

Net: **250 insertions, 1,425 deletions.**

## Testing

Six tests. Two are pure name matching; four run against a real migrated schema, because the condition filters on `media_metadata` columns reachable only through a join and on a `series` subquery.

One of those four is new and deliberately uses `find_for_user` rather than the bare `find` — every real caller does, and its extra library-exclusion and series-metadata joins are exactly where an ambiguous-column error would surface. That seam was untested in #49.

All six CI gates pass locally.

## Known trade-off

The series-name signal contributes _every_ book in an omnibus-named folder, so a stray extra file in such a folder shows up on the shelf too. That's the right trade for a library where an omnibus folder holds only its own volumes.

Spec updated in place, including a "Revision" section recording why the first design was replaced: `docs/superpowers/specs/2026-08-12-omnibus-shelf-design.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01GMKPoe7qDSVx73wDgaYkkL
