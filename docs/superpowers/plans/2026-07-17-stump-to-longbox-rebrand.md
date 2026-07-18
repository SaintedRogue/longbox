# Stump → Longbox Full Rebrand Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Each **Phase** is an independent branch/PR that must pass `ci-preflight` before merge.

**Goal:** Remove every `stump` identifier from Longbox — branding, dead legacy, code identifiers, and the runtime contract — with data-safe migrations so the single live Unraid deployment upgrades cleanly, while preserving all legitimate upstream attribution.

**Architecture:** Six risk-ordered phases, each its own PR. Tiers 1–3 (branding, Rust ids, TS scope) are compiler/type/lint-gated — a bad rename breaks the build loudly. Tier 4 (env vars, data dir, wire contracts, browser state) is the only silently-failing surface and gets its own phase with a live-data verify. Discovery was performed by a 4-agent swarm; the authoritative inventory is embedded below.

**Tech Stack:** Rust (Cargo workspace, SeaORM, async-graphql, `stump-config-gen` proc-macro), TypeScript (yarn 1 + lerna, Vite, React 19, gql.tada/graphql-codegen), Docker + Unraid deploy.

**Companion spec:** `docs/superpowers/specs/2026-07-17-stump-to-longbox-rebrand-design.md` (read §10 Discovery Addendum).

---

## Global Constraints

These apply to **every task**. Copied verbatim from the spec.

- **CI gate (per phase):** run `.claude/skills/ci-preflight/scripts/preflight.sh` before every merge. Rust: `cargo fmt --all -- --check`, `cargo clippy -- -D warnings`, `cargo dump-schema -- --check`, `cargo test`. Frontend: `yarn lint`, `yarn test`. `clippy -D warnings` and schema-drift are the two that surprise.
- **NEVER rename (hard constraint — MIT attribution + link integrity):**
  - `LICENSE` "Copyright (c) 2022 Aaron Leopold"; "fork of Stump" provenance (`README.md:15,41,128`, `deploy/unraid/*`, `docs/src/components/landing/Footer.tsx` copyright).
  - All `github.com/stumpapp/stump/{issues,pull,commit,discussions}/…` links (dead if org swapped).
  - Upstream community/funding: `crowdin.com/project/stump`, `opencollective.com/stump`, upstream Discord `discord.gg/63Ybb7J3as`, `github.com/sponsors/aaronleopold`, `aaronleopold/stump:latest` in OIDC examples, `?repos=stumpapp%2Fstump` star-history.
  - False positives: `.stumpignore` (in a "no-longer-supported" sentence), `stump.db`/`stump-legacy.db`/`/stump-old/`/`/stump-new/` in migration-instruction docs, `stump_policy` Authelia example, example hostnames (`stump.example.com`, `my-stump.cloud`), git SHAs in upstream commit URLs.
- **DO rebrand (these only _look_ like attribution):** the fork's own canonical URLs currently pointing at `stumpapp.dev` (`docs/src/.../Head.tsx`, `__root.tsx`, `.github/ISSUE_TEMPLATE/feature_request.yml:33`, `.github/CONTRIBUTING.md:7`).
- **Env-var policy:** only the **33 `STUMP_`-prefixed** keys → `LONGBOX_*` with `STUMP_*` fallback + one-time deprecation warn. The **10 unprefixed** keys (`PDFIUM_PATH`, `ENABLE_KOREADER_SYNC`, `ENABLE_KOBO_SYNC`, `ENABLE_OPDS_PROGRESSION`, `HASH_COST`, `SESSION_TTL`, `SESSION_EXPIRY_CLEANUP_INTERVAL`, `ACCESS_TOKEN_TTL`, `REFRESH_TOKEN_TTL`, `FORCE_DB_RESET`) stay **exactly as-is**.
- **Data migration invariants:** atomic same-filesystem `rename()`; run **only when target absent** (idempotent, never clobber); move `stump.db` + `stump.db-wal` + `stump.db-shm` together (or checkpoint first); handle custom `STUMP_DB_PATH` dir, not just the config dir.
- **No global `s/stump/longbox/`.** Every rename is scoped to identifiers/strings enumerated below.
- **Search exclusions (all `rg`/`fd`):** `target/`, `node_modules/`, `dist/`, `graphify-out/`, `*.lock`.
- **Commit style:** end messages with the repo's `Co-Authored-By`/`Claude-Session` trailers (see existing commits).

---

## Canonical Naming Map (authoritative)

| Domain             | From → To                                                                                                                                                                                                                                                                                                                                               |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cargo `[lib] name` | `stump_core→longbox_core` (`core/Cargo.toml:7`), `stump_server→longbox_server` (`apps/server/Cargo.toml:8`) — `[package]` names already done                                                                                                                                                                                                            |
| Cargo package      | `stump-config-gen→longbox-config-gen` (`crates/macros/stump-config-gen/Cargo.toml:2`) + dep at `core/Cargo.toml:46` + dir rename                                                                                                                                                                                                                        |
| Rust import ids    | `stump_core→longbox_core` (98 sites/65 files), `stump_server→longbox_server` (2 sites), `stump_config_gen→longbox_config_gen` (2 sites)                                                                                                                                                                                                                 |
| Rust types         | `StumpConfig→LongboxConfig`, `StumpCore→LongboxCore`, `StumpJob→LongboxJob`, `StumpAuthor→LongboxAuthor`, `StumpConfigGenerator→LongboxConfigGenerator`, `StumpConfigVariable(Attributes)→Longbox…`, `StumpVersion→LongboxVersion`, `StumpRequestInfo→LongboxRequestInfo`, `StumpSessionStore→LongboxSessionStore`, `StumpOidcClient→LongboxOidcClient` |
| Generated type     | `PartialStumpConfig→PartialLongboxConfig` (auto via `format_ident!`; 3 hand-refs in lockstep)                                                                                                                                                                                                                                                           |
| Rust fns           | `merge_stump_config→merge_longbox_config`, `generate_stump_hash→generate_longbox_hash` (trait+4 impls), `gen_stump_config_impls`, `gen_partial_stump_config`, `stump_in_docker→longbox_in_docker`                                                                                                                                                       |
| Rust modules/files | `stump_config.rs→longbox_config.rs`, `stump_job.rs→longbox_job.rs`, `stump_shadow_text.txt→longbox_shadow_text.txt`, `mock-stump.toml→mock-longbox.toml` (×2)                                                                                                                                                                                           |
| Rust consts        | `STUMP_SHADOW_TEXT→LONGBOX_SHADOW_TEXT`, `STUMP_SAVE_BASIC_SESSION_HEADER→LONGBOX_SAVE_BASIC_SESSION_HEADER`                                                                                                                                                                                                                                            |
| Tracing strings    | `"stump_core=trace"→"longbox_core=trace"`, `"stump_server=trace"→"longbox_server=trace"` (must equal lib name)                                                                                                                                                                                                                                          |
| GraphQL            | `#[graphql(name="StumpConfig")]→"LongboxConfig"` → `dump-schema` + `codegen` + TS ref fixups                                                                                                                                                                                                                                                            |
| npm scope          | `@stump/{sdk,client,browser,components,graphql,i18n,web,docs}→@longbox/*` (~1263 sites)                                                                                                                                                                                                                                                                 |
| CLI                | `#[command(name="stump")]→"longbox"`                                                                                                                                                                                                                                                                                                                    |
| Config file        | `Stump.toml→Longbox.toml`, `Stump.log→Longbox.log`                                                                                                                                                                                                                                                                                                      |
| Env vars           | 33 `STUMP_*→LONGBOX_*` (fallback+warn)                                                                                                                                                                                                                                                                                                                  |
| Data dir / DB      | `~/.stump→~/.longbox`, `stump.db→longbox.db` (+WAL sidecars)                                                                                                                                                                                                                                                                                            |
| Wire contracts     | header `X-Stump-Save-Session→X-Longbox-Save-Session`; api-key prefix `"stump"→"longbox"` (`crates/models/src/shared/api_key.rs:7`); session cookie `stump_session→longbox_session` (`apps/server/src/config/session/utils.rs:10`)                                                                                                                       |
| Browser state      | `stump-*`/`stump:*` localStorage keys → `longbox-*`/`longbox:*` (+ migration shim)                                                                                                                                                                                                                                                                      |
| i18n keys          | `stump`,`stumpServer`,`noStumpServers`,`nonStumpData` → `longbox…` (+ all `t()` sites)                                                                                                                                                                                                                                                                  |

---

## Phase Sequencing & Dependencies

```
Phase 1 (branding/docs)      ─┐  independent
Phase 2 (Rust + graphql)     ─┼─► Phase 2 regenerates codegen → touches packages/graphql; do BEFORE Phase 3
Phase 3 (TS @stump scope)    ─┘  depends on Phase 2's regenerated graphql client being merged
Phase 4 (runtime contract)   ───► depends on Phase 2 (const/fn renames) + Phase 3 (SDK/scope); LIVE-VERIFY gate
Phase 5 (sweep & seal)       ───► last; re-grep + CLAUDE.md + memories
```

Merge order: **1 → 2 → 3 → 4 → 5.** Phases 1 and 2 may be developed in parallel (no file overlap) but merge 2 before 3.

---

# PHASE 1 — Branding, Docs & Dead Legacy (Tier 1+2)

**Branch:** `rebrand/phase-1-branding`. Low risk, no compiled code. Gate: `yarn lint` (docs app + StumpLogo touch TS) + visual review.

### Task 1.1: Delete the upstream changelog and fix its in-app link

**Files:**

- Delete: `.github/CHANGELOG.md`
- Modify: `packages/browser/src/scenes/settings/server/general/HelpfulLinks.tsx:41`

- [ ] **Step 1:** Confirm it's purely upstream (every entry links `stumpapp/stump`):
      `rg -c 'stumpapp/stump' .github/CHANGELOG.md` → expect a large count, `rg -c 'SaintedRogue' .github/CHANGELOG.md` → expect `0`.
- [ ] **Step 2:** `git rm .github/CHANGELOG.md`
- [ ] **Step 3:** Open `HelpfulLinks.tsx:41`; if the link points at the deleted changelog, either remove that list entry or retarget it to `https://github.com/SaintedRogue/longbox/releases`. Show the changed line.
- [ ] **Step 4:** `rg -n 'CHANGELOG' packages/browser/src` → expect no dangling reference to the deleted file.
- [ ] **Step 5:** Commit: `chore(rebrand): remove upstream Stump changelog + fix in-app link`.

### Task 1.2: Rename StumpLogo component → LongboxLogo

**Files:**

- Rename: `docs/src/components/landing/StumpLogo.tsx` → `LongboxLogo.tsx`
- Modify: importers (`docs/src/components/landing/index.ts`, `.../LandingPage.tsx`, any others)

- [ ] **Step 1:** `rg -l 'StumpLogo'` → list all importers.
- [ ] **Step 2:** `git mv docs/src/components/landing/StumpLogo.tsx docs/src/components/landing/LongboxLogo.tsx`
- [ ] **Step 3:** Rename the component symbol `StumpLogo→LongboxLogo` in the file and update every importer from Step 1.
- [ ] **Step 4:** `rg -n 'StumpLogo'` → expect `0` matches. `yarn workspace @longbox/docs lint` (or root `yarn lint`) passes.
- [ ] **Step 5:** Commit: `refactor(rebrand): StumpLogo → LongboxLogo`.

### Task 1.3: Replace upstream Stump image assets with Longbox captures

**Files:**

- Replace: `docs/public/images/landing-dark.png`, `docs/public/images/landing-light.png` (README hero + landing Hero.tsx), `docs/public/og.png`, `docs/public/favicon.ico`, `docs/public/favicon.png`

> **Requires a real Longbox desktop screenshot.** The three root `mobile-*.png` are phone captures, not a hero. **Capture via the live-verify Playwright harness** (`longbox-live-verify-setup` memory): boot the server, log in, screenshot the library dashboard at desktop viewport for `landing-{dark,light}.png`; generate a 1200×630 `og.png` and favicons from the Longbox line-mark (`.github/images/logo.svg`).

- [ ] **Step 1:** Capture `landing-dark.png` / `landing-light.png` (theme-switched) at ~1600px wide from the running app.
- [ ] **Step 2:** Generate `og.png` (1200×630) and `favicon.ico`/`favicon.png` from `.github/images/logo.svg`.
- [ ] **Step 3:** Overwrite the five files in `docs/public/`.
- [ ] **Step 4:** Verify no asset still shows Stump UI: open `README.md` hero + `docs` landing locally; confirm Longbox. `rg -n 'landing-(dark|light)|og\.png|favicon' README.md docs/src` → references resolve.
- [ ] **Step 5:** Commit: `assets(rebrand): replace upstream Stump hero/og/favicon with Longbox`.

### Task 1.4: Rebrand docs content — self-URLs + stale removed-app snippets, keep upstream links

**Files (rebrand in place — 43 LIVE docs):** `docs/content/docs/**`, and landing meta (`docs/src/.../Head.tsx`, `__root.tsx`).

- [ ] **Step 1:** Rebrand the fork's own `stumpapp.dev` self-URLs → the Longbox canonical URL/domain in `Head.tsx`, `__root.tsx`, `.github/CONTRIBUTING.md:7`, `.github/ISSUE_TEMPLATE/feature_request.yml:33`. **Do NOT touch** `github.com/stumpapp/stump/*` links or the exclusion-list items.
- [ ] **Step 2:** Fix body-text brand leaks that should be Longbox: `docs/content/docs/guides/fundamentals/scanner.mdx:84` ("stump diffs…"→"Longbox diffs…"), `.github/SECURITY.md:5` ("the `stump` project"→"the Longbox project").
- [ ] **Step 3:** Prune stale references to the deleted Tauri/Expo apps: `developer/contributing.mdx:40,87`; `guides/configuration/server-config.mdx:60,64` (drop `tauri://localhost` default origins); `apps/web/themes.mdx:180`; `guides/fundamentals/thumbnails.mdx:54`.
- [ ] **Step 4:** `rg -n 'stumpapp\.dev'` → expect only intentional-keep hits (none should remain if self-URLs were the only ones). `rg -n 'github\.com/stumpapp/stump'` → all still present (untouched).
- [ ] **Step 5:** Commit: `docs(rebrand): retarget self-URLs, drop removed-app snippets`.

### Task 1.5: Prune the one upstream-legacy doc + CI title

**Files:**

- Delete: `docs/content/docs/guides/breaking-changes/0.1.0.mdx`
- Modify: `docs/content/docs/guides/breaking-changes/meta.json` (or parent nav), `.github/workflows/ci.yaml:1`

- [ ] **Step 1:** Confirm `0.1.0.mdx` is upstream pre-fork history (Prisma→SeaORM rewrite, `stumpapp/stump/discussions/634`). `git rm docs/content/docs/guides/breaking-changes/0.1.0.mdx`.
- [ ] **Step 2:** Remove the nav entry referencing it (`meta.json`); if the `breaking-changes` dir is now empty, remove it and its nav group.
- [ ] **Step 3:** `.github/workflows/ci.yaml:1` — `name: 'Stump Checks CI'` → `name: 'Longbox Checks CI'`. **Do not touch** any job `name:` (`Rust checks`, etc.) — those are required-status-check contexts.
- [ ] **Step 4:** `rg -n 'breaking-changes/0.1.0'` → `0`. `rg -n 'Stump Checks' .github` → `0`.
- [ ] **Step 5:** Commit: `docs(rebrand): prune upstream breaking-changes doc; rename CI title`.
- [ ] **Step 6:** Run `ci-preflight` (frontend gate), open PR, merge.

---

# PHASE 2 — Rust Identifiers, GraphQL & CLI (Tier 3a)

**Branch:** `rebrand/phase-2-rust`. Compiler-gated. Gate: full Rust `ci-preflight` **+** frontend `ci-preflight` (codegen regenerates TS). Merge **before** Phase 3.

### Task 2.1: Fix the broken build-server alias + flip lib names + sweep imports

**Files:** `core/Cargo.toml:7`, `apps/server/Cargo.toml:8`, `.cargo/config.toml:4`, `.github/actions/build-server/action.yml:18,23,28`, `core/src/config/logging.rs:26,28,31,33`, `apps/server/tests/common/app.rs:7-8`, **+ 98 `use stump_core::` sites across 65 files**.

**Interfaces produced:** crate import names `longbox_core`, `longbox_server` (every later Rust task and Phase 4 depend on these).

- [ ] **Step 1:** Flip `[lib] name`: `core/Cargo.toml:7` `stump_core→longbox_core`; `apps/server/Cargo.toml:8` `stump_server→longbox_server`.
- [ ] **Step 2:** Fix the stale/broken alias `.cargo/config.toml:4` → `build-server = "build --package longbox_server --bin longbox_server --release --"`.
- [ ] **Step 3:** Fix CI: `.github/actions/build-server/action.yml:18,23,28` `--package stump_server` → `longbox_server`.
- [ ] **Step 4:** Fix tracing directives (must equal lib name): `logging.rs:26` `"stump_core=trace"→"longbox_core=trace"`, `:31` `"stump_server=trace"→"longbox_server=trace"`, and the two `.expect(...)` strings at `:28,:33`.
- [ ] **Step 5:** Sweep imports. Because these are unambiguous crate paths, a scoped codemod is safe: `rg -l 'stump_core' -g '*.rs'` then replace whole-word `stump_core`→`longbox_core` and `stump_server`→`longbox_server` in `.rs` files only (`apps/server/tests/common/app.rs:7-8` included; `extern crate stump_core;` at `core/integration-tests/tests/utils.rs:2`). **Do not** touch `STUMP_*`, `Stump.toml`, `stump_config`/`stump_job` module paths yet.
- [ ] **Step 6 (verify it fails loudly if incomplete):** `cargo build 2>&1 | rg 'unresolved|cannot find'` — fix any stragglers until clean.
- [ ] **Step 7:** `cargo build && cargo test -p longbox_core --no-run` compiles. `rg -n '\bstump_core\b|\bstump_server\b' -g '*.rs' -g '*.toml' -g '*.yml'` → `0`.
- [ ] **Step 8:** Commit: `refactor(rebrand): flip lib names stump_*→longbox_*, sweep imports, fix build-server alias`.

### Task 2.2: Rename the config-gen macro crate + its dir

**Files:** `crates/macros/stump-config-gen/` → `crates/macros/longbox-config-gen/` (dir), `Cargo.toml:2,4`, `core/Cargo.toml:46`, `core/src/config/stump_config.rs:17`, `crates/macros/.../tests/basic_tests.rs:19`, macro-internal fns.

- [ ] **Step 1:** `git mv crates/macros/stump-config-gen crates/macros/longbox-config-gen`.
- [ ] **Step 2:** `crates/macros/longbox-config-gen/Cargo.toml:2` name `stump-config-gen→longbox-config-gen`; `:4` description text update.
- [ ] **Step 3:** `core/Cargo.toml:46` dep: `stump-config-gen = { path = "../crates/macros/stump-config-gen"}` → `longbox-config-gen = { path = "../crates/macros/longbox-config-gen" }`.
- [ ] **Step 4:** Update import ids `stump_config_gen→longbox_config_gen` (normalized name) at `stump_config.rs:17` and `basic_tests.rs:19`.
- [ ] **Step 5:** Rename macro-internal fns `gen_stump_config_impls→gen_longbox_config_impls` (`gen_config_impls.rs:7`), `gen_partial_stump_config→gen_partial_longbox_config` (`gen_partial_config.rs:7`) and their call-sites.
- [ ] **Step 6:** `cargo build` compiles. `rg -n 'stump.config.gen|stump_config_gen'` → `0`.
- [ ] **Step 7:** Commit: `refactor(rebrand): stump-config-gen → longbox-config-gen`.

### Task 2.3: Rename Rust types (incl. proc-macro + generated PartialStumpConfig)

**Files:** per §3 of the inventory — `stump_config.rs:113,115` (+`457,486,491` for `PartialStumpConfig`), `lib.rs:69`, `stump_job.rs:19`, `author.rs:11`, `longbox-config-gen/src/lib.rs:62` + `config_vars.rs:6,16`, `routers/api/v2/mod.rs:57`, `http_server.rs:166`, `session/store.rs:46`, `config/oidc.rs:20`.

- [ ] **Step 1:** Rename the derive proc-macro `StumpConfigGenerator→LongboxConfigGenerator` (`longbox-config-gen/src/lib.rs:62`) and the `#[derive(...)]` usage on the config struct.
- [ ] **Step 2:** Rename `StumpConfig→LongboxConfig` (`stump_config.rs:115`). Its `format_ident!("Partial{struct_ident}")` now emits `PartialLongboxConfig` — update the 3 hand-written refs at `stump_config.rs:457,486,491` in lockstep.
- [ ] **Step 3:** Rename the remaining types: `StumpCore→LongboxCore` (`lib.rs:69`), `StumpJob→LongboxJob` (`stump_job.rs:19`), `StumpAuthor→LongboxAuthor` (`author.rs:11`), `StumpConfigVariable(Attributes)` (`config_vars.rs:6,16`), `StumpVersion` (`mod.rs:57`), `StumpRequestInfo` (`http_server.rs:166`), `StumpSessionStore` (`store.rs:46`), `StumpOidcClient` (`oidc.rs:20`). Update all cross-crate references (e.g. `use stump_core::job::stump_job::StumpJob` in `crates/graphql/src/mutation/{upload,series,library,media}.rs`).
- [ ] **Step 4:** `cargo build 2>&1 | rg 'cannot find|unresolved'` → fix until clean.
- [ ] **Step 5:** `rg -n '\bStump(Config|Core|Job|Author|ConfigGenerator|ConfigVariable|Version|RequestInfo|SessionStore|OidcClient)\b' -g '*.rs'` → `0`. `cargo test --no-run`.
- [ ] **Step 6:** Commit: `refactor(rebrand): rename Stump* Rust types → Longbox*`.

### Task 2.4: Rename Rust functions, modules, files, constants + fixtures

**Files:** `crates/cli/src/config.rs:19` + `main.rs:37,39`; `process.rs:79` + pdf/rar/epub/zip impls; `config/mod.rs:3,58`; `job/mod.rs:24`; file renames per §5; `logging.rs:8`; `middleware/auth.rs:51` + `cors.rs:11,49`; `lib.rs:21,129`; fixtures.

- [ ] **Step 1:** Rename fns: `merge_stump_config→merge_longbox_config` (+ 2 call-sites in `main.rs`), `generate_stump_hash→generate_longbox_hash` (trait `process.rs:79` + 4 format impls), `stump_in_docker→longbox_in_docker` (`mod.rs:58`).
- [ ] **Step 2:** Rename files + module decls: `git mv core/src/config/stump_config.rs core/src/config/longbox_config.rs` (+ `mod.rs:3` `mod stump_config;→mod longbox_config;`); `git mv core/src/job/stump_job.rs core/src/job/longbox_job.rs` (+ `job/mod.rs:24` + cross-crate `job::stump_job::`→`job::longbox_job::` paths); `git mv core/src/config/stump_shadow_text.txt core/src/config/longbox_shadow_text.txt` (+ `include_str!` at `logging.rs:8`).
- [ ] **Step 3:** Rename consts: `STUMP_SHADOW_TEXT→LONGBOX_SHADOW_TEXT` (`logging.rs:8` + `lib.rs:21,129`). **Leave** `STUMP_SAVE_BASIC_SESSION_HEADER` for Phase 4 (wire contract).
- [ ] **Step 4:** Rename fixtures: `git mv core/benches/data/mock-stump.toml core/benches/data/mock-longbox.toml` and `core/integration-tests/data/mock-stump.toml → mock-longbox.toml`; grep for any loader referencing the old names and update.
- [ ] **Step 5:** `cargo build && cargo test --no-run`. `rg -n 'stump_config|stump_job|stump_shadow|merge_stump|generate_stump|stump_in_docker|mock-stump' -g '*.rs' -g '*.toml'` → `0`.
- [ ] **Step 6:** Commit: `refactor(rebrand): rename Stump fns/modules/files/fixtures → Longbox`.

### Task 2.5: GraphQL type rename + schema dump + codegen + TS ref fixups

**Files:** `core/src/config/longbox_config.rs:113` (graphql attr), `crates/graphql/schema.graphql` (generated), `packages/graphql/src/client/*` (generated), any hand-written TS querying the renamed type.

**Interfaces produced:** GraphQL schema type `LongboxConfig` (Phase 3/4 TS relies on the regenerated client).

- [ ] **Step 1:** Change `#[graphql(name = "StumpConfig")]` → `#[graphql(name = "LongboxConfig")]`.
- [ ] **Step 2:** `cargo dump-schema` — regenerates `crates/graphql/schema.graphql`. Verify `rg -n 'StumpConfig' crates/graphql/schema.graphql` → `0`.
- [ ] **Step 3:** `cargo dump-schema -- --check` passes (schema matches code).
- [ ] **Step 4:** `cargo codegen` — regenerates `packages/graphql/src/client/*` from the schema. `rg -n 'StumpConfig|stumpConfig' packages/graphql/src/client` → `0`.
- [ ] **Step 5:** Fix hand-written TS that referenced the renamed graphql type/field (`rg -n 'StumpConfig|stumpConfig' packages apps --glob '!**/client/**'`); update queries/selections to `LongboxConfig`.
- [ ] **Step 6:** `cargo test` + frontend `yarn lint && yarn test` (regenerated client must type-check).
- [ ] **Step 7:** Commit: `refactor(rebrand): graphql StumpConfig → LongboxConfig + regen schema/codegen`.

### Task 2.6: CLI program name + Rust string/comment brand sweep

**Files:** `crates/cli/src/lib.rs:15`; CLI docs (`developer/cli/*.mdx`, `access-control/users.mdx`); user-facing Rust strings (OPDS/error/schema-desc): `author.rs:19,68,89`, `opds/v2_0/authentication.rs:40,122`, `feed.rs:156`, `filesystem/error.rs:29`, `graphql/bin/main.rs:13`; comment-only files per §6.

- [ ] **Step 1:** `crates/cli/src/lib.rs:15` `#[command(name = "stump")]` → `#[command(name = "longbox")]`. Update CLI-invocation docs that call `./stump` → `./longbox`.
- [ ] **Step 2:** Rebrand user-facing Rust strings: OPDS author name/catalog titles `"Stump"`→`"Longbox"` (`author.rs`, `authentication.rs`, `feed.rs`), error `"Stump is not properly configured…"→"Longbox…"` (`error.rs:29`), schema desc `"…for Stump clients"→"…for Longbox clients"` (`bin/main.rs:13`).
- [ ] **Step 3:** Sweep comment/docstring-only mentions (§6 top-20) where they describe _this_ project (e.g. "A Stump-specific hash"→"A Longbox-specific hash"). **Skip** `stumpapp.dev` sample emails and `stumpapp/stump` URL comments (exclusion list). Leave `stump-test.txt`/`stump_test` temp-dir names if not user-visible (optional cosmetic).
- [ ] **Step 4:** `cargo build && cargo test`. `cargo clippy -- -D warnings`. `cargo fmt --all -- --check`.
- [ ] **Step 5:** Commit: `refactor(rebrand): CLI name + user-facing Rust strings → Longbox`.
- [ ] **Step 6:** Run full `ci-preflight` (Rust + frontend), open PR, merge **before Phase 3**.

---

# PHASE 3 — TypeScript `@stump` Scope & i18n Keys (Tier 3b)

**Branch:** `rebrand/phase-3-ts`. Type/lint-gated. Depends on Phase 2 merged. Gate: frontend `ci-preflight` + `yarn install` regenerates the lockfile.

### Task 3.1: Rename the 8 package names + all workspace wiring in lockstep

**Files:** `packages/{sdk,client,browser,components,graphql,i18n}/package.json`, `apps/web/package.json`, `docs/package.json` (names); dep entries (`packages/client:15`, `packages/browser:24-27`, `apps/web:14-15`); root `package.json:22-25` lerna scopes; tsconfig `paths` (`tsconfig.options.json:22-24`, `packages/sdk/tsconfig.json:11`, `packages/client/tsconfig.json:12-14`, `packages/browser/tsconfig.json:14-20`, `apps/web/tsconfig.json:14-17`).

> **Why lockstep:** Vite resolves via `vite-plugin-tsconfig-paths` and Jest via node resolution — if package `name`s flip but a `tsconfig paths` block stays `@stump/*`, TS + Vite break while Jest may still pass (silent partial). All four must move together.

- [ ] **Step 1:** Rename all 8 `"name": "@stump/x"` → `"@longbox/x"`.
- [ ] **Step 2:** Update every `dependencies`/`devDependencies` `@stump/*` entry (all use `"*"`).
- [ ] **Step 3:** Update root `package.json:22-25` `lerna run --scope @stump/*` → `@longbox/*`.
- [ ] **Step 4:** Update every tsconfig `paths` `@stump/*` alias → `@longbox/*` (5 files listed above). `references` use relative paths — leave them.
- [ ] **Step 5:** Commit (partial — build still broken until imports move): `refactor(rebrand): rename @stump/* package names + workspace wiring`.

### Task 3.2: Sweep all import sites (incl. CSS @import + side-effect imports)

**Files:** ~1263 `@stump/` occurrences across `.ts/.tsx/.css`. Critical non-JS sites: `packages/browser/src/styles/index.css:2` (`@import '@stump/components/tailwind/preset.css'`), `apps/web/src/App.tsx:2` (side-effect CSS import), `packages/components/tailwind/index.ts:4` (comment).

- [ ] **Step 1:** Scoped codemod: replace `@stump/` → `@longbox/` across `packages/`, `apps/web/`, `docs/` in `.ts,.tsx,.css` files. **Exclude** `packages/graphql/src/client/**` (already `@longbox`-free generated code — verify it has no `@stump/` scope imports first: `rg '@stump/' packages/graphql/src/client` → `0`).
- [ ] **Step 2:** Verify the CSS `@import` and side-effect imports moved: `rg -n '@stump/' packages apps docs -g '*.css' -g '*.ts' -g '*.tsx'` → `0`.
- [ ] **Step 3:** `yarn install` (regenerates `yarn.lock` — workspace symlinks now use `@longbox`). Commit the lockfile.
- [ ] **Step 4:** `yarn lint && yarn test && yarn workspace @longbox/web build` — all pass.
- [ ] **Step 5:** Commit: `refactor(rebrand): sweep @stump→@longbox import sites + regen lockfile`.

### Task 3.3: Rename i18n keys + internal `Stump*` TS identifiers

**Files:** `packages/i18n/src/locales/*.json` (~40 files: keys `stump`,`stumpServer`,`noStumpServers`,`nonStumpData`), all `t('…')` call-sites; `packages/client/src/context.ts:10,18,29,36,38` (`IStumpClientContext`,`StumpClientContext`,`StumpClientProps`, `'StumpContext not found'`); `packages/sdk/src/api.ts`/`controllers/server-api.ts` (`StumpVersion`, doc comments).

- [ ] **Step 1:** Rename the 4 i18n keys in **all** locale JSONs (keep the already-Longbox _values_): `stump→longbox`, `stumpServer→longboxServer`, `noStumpServers→noLongboxServers`, `nonStumpData→nonLongboxData`.
- [ ] **Step 2:** Update every `t('...')` call-site referencing those keys (`rg -n "t\(['\"].*(stump|Stump)" packages apps`). i18n keys are string-typed — verify by running the app, not just types.
- [ ] **Step 3:** Rename internal TS ids: `StumpClientContext`/`IStumpClientContext`/`StumpClientProps`→`Longbox…` (+ the `'StumpContext not found'` error string); `StumpVersion`→`LongboxVersion` in sdk (align with the Rust `LongboxVersion`).
- [ ] **Step 4:** `rg -n '\bstump|Stump' packages/i18n/src packages/client/src/context.ts packages/sdk/src` → only exclusion-list/attribution hits remain. `yarn lint && yarn test`.
- [ ] **Step 5:** Commit: `refactor(rebrand): i18n keys + internal Stump* TS identifiers → Longbox`.
- [ ] **Step 6:** Run frontend `ci-preflight`, open PR, merge.

---

# PHASE 4 — Runtime Contract (Tier 4) — the careful phase

**Branch:** `rebrand/phase-4-runtime`. The only silently-failing tier. Gate: Rust + frontend `ci-preflight` **AND** the live-verify matrix (Task 4.7). Uses **TDD** for the migration/fallback logic.

### Task 4.1: Env-var fallback helper (TDD) + wire into 3 read sites

**Files:** new `core/src/config/env.rs` (or a fn in `longbox_config.rs`); `crates/macros/longbox-config-gen/src/gen_config_impls.rs:139-192`; `core/src/config/oidc_config.rs:89-162`; `core/src/config/mod.rs:59`; the 33 `STUMP_*` consts in `longbox_config.rs:21-60`.

**Interface produced:** `fn env_var(new_key: &str, legacy_key: Option<&str>) -> Option<String>` — `LONGBOX_x ?? (STUMP_x + warn_once) ?? None`.

- [ ] **Step 1 (failing test):**

```rust
#[test]
fn env_var_prefers_new_then_warns_on_legacy() {
    std::env::remove_var("LONGBOX_PORT");
    std::env::set_var("STUMP_PORT", "10999");
    assert_eq!(env_var("LONGBOX_PORT", Some("STUMP_PORT")), Some("10999".into())); // falls back
    std::env::set_var("LONGBOX_PORT", "10801");
    assert_eq!(env_var("LONGBOX_PORT", Some("STUMP_PORT")), Some("10801".into())); // new wins
}
```

- [ ] **Step 2:** Run → FAIL (`env_var` undefined).
- [ ] **Step 3:** Implement `env_var` using `std::env::var`, with a `std::sync::Once`-guarded `tracing::warn!` per legacy key hit.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Rename the 33 `STUMP_`-prefixed consts to `"LONGBOX_x"` and add `LEGACY_x_KEY = "STUMP_x"` companions. **Leave the 10 unprefixed keys untouched.**
- [ ] **Step 6:** Route reads through `env_var`: (a) the macro `gen_env_var_extractors` (pass both keys); (b) `OidcConfig::from_env` (9 keys); (c) `stump_in_docker`/`longbox_in_docker` (`IN_DOCKER`). Update `debug_setup()` (`main.rs:15-22`) to set `LONGBOX_*`.
- [ ] **Step 7:** `cargo test` + a manual `STUMP_PORT=1 LONGBOX_PROFILE=release cargo run` shows the deprecation warn. `cargo clippy -- -D warnings`.
- [ ] **Step 8:** Commit: `feat(rebrand): LONGBOX_* env vars with STUMP_* fallback + warn`.

### Task 4.2: Config-file + log rename (`Stump.toml`/`Stump.log` → `Longbox.*`)

**Files:** `longbox_config.rs:114` (`#[config_file_location(...)]`), `:351` (write), `:408` (`get_log_file`), `logging.rs:15`; doc-comments.

- [ ] **Step 1:** `#[config_file_location(self.get_config_dir().join("Longbox.toml"))]`; write path `:351` `Longbox.toml`; `get_log_file` `:408` `Longbox.log`; `logging.rs:15` `rolling::never(log_dir, "Longbox.log")`.
- [ ] **Step 2:** (Legacy `Stump.toml` is handled by the boot migration in 4.3 — no runtime fallback needed once migrated.)
- [ ] **Step 3:** `cargo build`. `rg -n 'Stump\.(toml|log)' -g '*.rs'` → only doc-comments/tests remain; update those too.
- [ ] **Step 4:** Commit: `refactor(rebrand): Stump.toml/Stump.log → Longbox.*`.

### Task 4.3: Data-dir + DB auto-migration on boot (TDD)

**Files:** new `core/src/config/migrate.rs`; `core/src/config/mod.rs:13-52` (`get_default_config_dir`, `bootstrap_config_dir`); `core/src/database.rs:17-26`; `apps/server/src/main.rs:29`.

**Interface produced:** `fn migrate_legacy_config_dir() -> Result<(), MigrateError>` and `fn migrate_legacy_db(db_dir: &Path)`; called at the top of `bootstrap_config_dir` / before `init_config`.

- [ ] **Step 1 (failing test, dir migration):**

```rust
#[test]
fn migrates_legacy_stump_dir_only_when_target_absent() {
    let tmp = tempdir().unwrap();
    let legacy = tmp.path().join(".stump");
    let target = tmp.path().join(".longbox");
    std::fs::create_dir_all(&legacy).unwrap();
    std::fs::write(legacy.join("Stump.toml"), "x").unwrap();
    migrate_legacy_dir(&legacy, &target).unwrap();
    assert!(target.join("Longbox.toml").exists()); // renamed dir + file
    assert!(!legacy.exists());
    // idempotent + non-clobbering: re-run with target present is a no-op
    std::fs::create_dir_all(&legacy).unwrap();
    migrate_legacy_dir(&legacy, &target).unwrap();
    assert!(legacy.exists()); // NOT moved over an existing target
}
```

- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement: if `legacy.exists() && !target.exists()` → atomic `fs::rename(legacy, target)`; then inside `target`, rename `Stump.toml→Longbox.toml`, `Stump.log→Longbox.log`, and `stump.db{,-wal,-shm}→longbox.db{,-wal,-shm}`; `tracing::info!` the migration. Guard every step on source-exists/target-absent.
- [ ] **Step 4:** Run → PASS. Add a DB-file test covering the WAL sidecars and a custom `db_path` dir.
- [ ] **Step 5:** Wire the call: at the top of `bootstrap_config_dir` (`mod.rs:22`), compute default legacy (`~/.stump`) + target (`~/.longbox`) and run `migrate_legacy_config_dir()` **before** returning. In `database.rs`, before connecting, run `migrate_legacy_db(resolved_db_dir)` so `stump.db→longbox.db` applies under a custom `STUMP_DB_PATH`/`LONGBOX_DB_PATH` too. Update `database.rs:21,25` literals `stump.db→longbox.db`.
- [ ] **Step 6:** `get_default_config_dir` (`mod.rs:15`) `home.join(".stump")→home.join(".longbox")`.
- [ ] **Step 7:** `cargo test`. `rg -n '\.stump\b|stump\.db' -g '*.rs'` → only test/migration-source references.
- [ ] **Step 8:** Commit: `feat(rebrand): auto-migrate ~/.stump→~/.longbox + stump.db→longbox.db on boot`.

### Task 4.4: Wire contracts — header, api-key prefix, session cookie (server + client lockstep)

**Files:** `apps/server/src/middleware/auth.rs:51` + `config/cors.rs:11,49`; `packages/sdk/src/constants.ts:1`; `crates/models/src/shared/api_key.rs:7` + `crates/graphql/src/input/api_key.rs:21` + `packages/browser/.../CreateAPIKeyModal.tsx:49`; `apps/server/src/config/session/utils.rs:10`.

> **Breaking:** invalidates existing API keys; forces one re-login. Release notes (Task 4.6) must say so.

- [ ] **Step 1:** Header: const `STUMP_SAVE_BASIC_SESSION_HEADER→LONGBOX_SAVE_BASIC_SESSION_HEADER` and its **value** `"X-Stump-Save-Session"→"X-Longbox-Save-Session"` (`auth.rs:51`); update CORS allow/expose header lists (`cors.rs:11,49`); update SDK `packages/sdk/src/constants.ts:1` to `X-Longbox-Save-Session`. Server + SDK must match.
- [ ] **Step 2:** API-key prefix: `crates/models/src/shared/api_key.rs:7` `API_KEY_PREFIX = "stump"→"longbox"`; verify `create_prefixed_key` output; update the client parse in `CreateAPIKeyModal.tsx:49` (`'stump_'→'longbox_'`).
- [ ] **Step 3:** Session cookie: `apps/server/src/config/session/utils.rs:10` `SESSION_NAME = "stump_session"→"longbox_session"`.
- [ ] **Step 4:** `cargo test` + `yarn lint && yarn test`. `rg -n 'X-Stump|"stump"|stump_session|stump_' apps/server crates packages/sdk packages/browser --glob '!**/client/**'` → only exclusion-list hits.
- [ ] **Step 5:** Commit: `feat(rebrand)!: rename wire contracts (header, api-key prefix, session cookie)`.

### Task 4.5: Browser persisted-state rename + migration shim (TDD)

**Files:** new `packages/client/src/stores/migrateLegacyStorage.ts`; `packages/client/src/stores/{reader,user,layout,app}.ts`; `packages/browser/src/stores/debug.ts`; `packages/browser/src/components/container/useGridSize.ts:95`; `.../explorer/FileExplorerProvider.tsx:111`; `.../readers/imageBased/useImageSizes.ts:93`; `.../readers/epub/EpubJsReader.tsx:38,167`; `packages/components/src/alert/Alert.tsx:47,53`; `apps/web/src/index.html:9,214`.

**Interface produced:** `migrateLegacyStorage(pairs: Array<[string,string]>)` run once at app boot.

- [ ] **Step 1 (failing test):**

```ts
test('copies legacy stump- key to longbox- and removes old', () => {
  localStorage.setItem('stump-user-store', '{"v":1}')
  migrateLegacyStorage([['stump-user-store', 'longbox-user-store']])
  expect(localStorage.getItem('longbox-user-store')).toBe('{"v":1}')
  expect(localStorage.getItem('stump-user-store')).toBeNull()
})
```

- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement `migrateLegacyStorage`: for each `[old,new]`, if `old` set and `new` unset → copy value, remove `old`. No-op otherwise (idempotent).
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Rename every persist key `stump-*`/`stump:*`→`longbox-*`/`longbox:*` (list above, incl. the `index.html` inline reads). Call `migrateLegacyStorage([...all pairs...])` once at the earliest client boot (before stores hydrate).
- [ ] **Step 6:** `rg -n "'stump-|\"stump-|stump:" packages apps` → `0`. `yarn test && yarn workspace @longbox/web build`.
- [ ] **Step 7:** Commit: `feat(rebrand): migrate localStorage stump-*→longbox-* keys`.

### Task 4.6: Deployment rewrite + release notes

**Files:** `docker/Dockerfile:122-129` (ENV), `docker/entrypoint.sh` (`USER/GROUP=stump`), `deploy/unraid/longbox.xml:26`, `deploy/unraid/README.md:45,59`, `.github/workflows/release_binary.yml` (artifact names, optional), release notes.

- [ ] **Step 1:** Dockerfile `STUMP_CONFIG_DIR/CLIENT_DIR/PROFILE/PORT/IN_DOCKER` → `LONGBOX_*` (fallback keeps old `/config` deployments booting). Comment `# Default Stump environment variables`→Longbox.
- [ ] **Step 2:** `entrypoint.sh` `USER=stump`/`GROUP=stump`→`longbox` (cosmetic; verify PUID/PGID logic unaffected).
- [ ] **Step 3:** Unraid template `longbox.xml:26` `STUMP_TRUST_PROXY_HEADERS`→`LONGBOX_TRUST_PROXY_HEADERS`; `deploy/unraid/README.md:45,59` same. Keep the "migrating from `aaronleopold/stump`" section (attribution).
- [ ] **Step 4:** Write release notes: "**Back up appdata before upgrading.** Data dir auto-migrates `~/.stump`→`~/.longbox`. **You must re-create API keys** and will be logged out once. Env vars are now `LONGBOX_*` (`STUMP_*` still work this release with a warning)."
- [ ] **Step 5:** `rg -n 'STUMP_' docker deploy .github` → only intentional fallback docs. Commit: `deploy(rebrand): LONGBOX_* env + Unraid template + release notes`.

### Task 4.7: Live-verify matrix (the gate)

Per `longbox-live-verify-setup` memory (rebuild web dist first). **Do not merge Phase 4 until all three pass.**

- [ ] **Matrix A — fresh install:** no `~/.longbox`, no `~/.stump` → boots, creates `~/.longbox/Longbox.toml` + `longbox.db`, Playwright login + create library + read a page works.
- [ ] **Matrix B — migration:** copy a snapshot of the real `~/.stump` into place, boot → logs the migration, `~/.longbox` has `longbox.db`(+wal/shm) + `Longbox.toml`, `~/.stump` gone; Playwright confirms **existing library + users + reading progress intact**; re-create an API key and confirm it works.
- [ ] **Matrix C — env fallback:** set a `STUMP_TRUST_PROXY_HEADERS=true` (no `LONGBOX_` equiv) → deprecation warn logged **and** the setting applies.
- [ ] **Commit** any fixes found; then run full `ci-preflight`, open PR, merge.

---

# PHASE 5 — Sweep & Seal

**Branch:** `rebrand/phase-5-seal`. Gate: `ci-preflight` + the residual-grep returning only the allow-list.

### Task 5.1: Residual grep to the allow-list

- [ ] **Step 1:** `rg -i 'stump' -g '!*.lock' -g '!target/**' -g '!node_modules/**' -g '!dist/**' -g '!graphify-out/**'` and diff against the Global-Constraints exclusion list. Every remaining hit must be an intentional keep (attribution, upstream links, false positives). Anything else → fix.
- [ ] **Step 2:** Document the allow-list result in the PR description (what remains and why).
- [ ] **Step 3:** Commit any final fixes: `chore(rebrand): final residual sweep`.

### Task 5.2: Rewrite CLAUDE.md + update memories

**Files:** `CLAUDE.md` (the "Internal identifiers are still `stump`… load-bearing" section), memories `reverse-proxy-trust-headers.md`, `longbox-live-verify-setup.md`.

- [ ] **Step 1:** Rewrite the CLAUDE.md `## Longbox` intro + the load-bearing note: internal ids are **now** `longbox_*`, `@longbox/*`, `LONGBOX_*`, config `Longbox.toml`, data dir `~/.longbox`. Keep the "hard fork of Stump / rebranded" attribution line. Update the `STUMP_TRUST_PROXY_HEADERS`→`LONGBOX_TRUST_PROXY_HEADERS` mention and note the one-release `STUMP_*` fallback.
- [ ] **Step 2:** Update memory `reverse-proxy-trust-headers.md` (`STUMP_TRUST_PROXY_HEADERS`→`LONGBOX_`, note fallback) and `longbox-live-verify-setup.md` (any `STUMP_*` env in the boot recipe).
- [ ] **Step 3:** `rg -n 'STUMP_|stump_server|@stump|load-bearing' CLAUDE.md` → only the attribution/fallback mentions remain.
- [ ] **Step 4:** Commit: `docs(rebrand): flip CLAUDE.md to Longbox-native + update memories`.
- [ ] **Step 5:** Run `ci-preflight`, open PR, merge. **Rebrand complete.**

### Task 5.3 (next release): Remove the `STUMP_*` fallback

- [ ] Tracked follow-up: one release later, delete the `LEGACY_*_KEY` companions + `env_var` legacy branch + `debug_setup` STUMP mentions, and drop the boot dir-migration once the live box is confirmed migrated.

---

## Self-Review (against the spec)

- **Spec coverage:** §3 tiers → Phases 1–5; §4 map → Naming Map + per-task renames; §5 migration → Tasks 4.1–4.3; §10.2 (43 keys/3 read sites) → 4.1; §10.3 (WAL/custom db_path/Docker no-op) → 4.3/4.6; §10.4 (3 new categories) → 4.4/4.5 + 3.3; §10.5 (assets/app-linked changelog/CI title) → 1.1/1.3/1.5; §10.6 (exclusion list) → Global Constraints; §10.7 (docs) → 1.4/1.5. ✅
- **Placeholder scan:** logic tasks (4.1/4.3/4.5) carry real test + impl code; bulk renames carry exact codemod scope + a `rg …→0` verification (the honest procedure, not "handle edge cases"). ✅
- **Type consistency:** `LongboxVersion` used in both Rust (2.3) and TS sdk (3.3); `env_var`, `migrate_legacy_dir`, `migrateLegacyStorage` signatures consistent between their definition and call-site tasks. ✅
- **Sequencing:** Phase 2 regenerates codegen before Phase 3's scope sweep (2.5 note); Phase 4 depends on 2+3. ✅
