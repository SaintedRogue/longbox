# Stump → Longbox Full Rebrand — Design Spec

**Date:** 2026-07-17
**Status:** Approved (design), pending implementation plan
**Author:** Michael Ahrendt (with Claude)

## 1. Problem

Longbox is a hard fork of [Stump](https://github.com/stumpapp/stump). User-facing
surfaces were rebranded to Longbox, but the fork left `stump` remnants throughout:
the README is still substantially Stump's (including its screenshot), the Cargo
crates/binary, npm scope, Rust type/module names, env vars, config file, and the
runtime data directory all still say `stump`. There are **2,668 case-insensitive
matches across 838 files** (excluding `target/`, `node_modules/`, `dist/`,
`*.lock`, `graphify-out/`).

The current `CLAUDE.md` explicitly declares these internal identifiers
"load-bearing — don't fix these to longbox." That rule was written to avoid
breaking external users. **There are no external users: Longbox is a single
self-hosted deployment (the author's Unraid box).** This spec deliberately
reverses that rule: the goal is _zero_ `stump` leftovers, delivered so the live
deployment survives the migration.

## 2. Goal / Success Criteria

- No identifier named `stump`/`Stump`/`STUMP` remains in the source tree, with the
  sole exception of **legitimate references to the upstream project** (attribution/
  license/fork provenance) and immutable **git history**.
- The live Unraid deployment upgrades with **no manual data steps** and **no data
  loss** (library, users, reading progress preserved).
- CI stays green at every phase (`ci-preflight`: `cargo fmt`/`clippy -D warnings`/
  `dump-schema --check`/`cargo test`, plus `yarn lint`/`yarn test`).
- `CLAUDE.md` and the affected memories are rewritten to reflect the new reality.

Note on "Stump Checks CI": the CI _title_ is user-facing branding and will be
renamed. Internal job/step ids are renamed only where doing so does not break
required-status-check gating; if a rename would break branch protection, the id is
kept and only the display name changes (flagged in Phase 1).

## 3. Scope Decisions (locked)

Four tiers, all in scope ("Everything, phased"):

| Tier                | Contents                                                                                                             | Risk     | Enforcement                                  |
| ------------------- | -------------------------------------------------------------------------------------------------------------------- | -------- | -------------------------------------------- |
| 1. Branding         | README + real screenshots, docs content, UI strings, `StumpLogo.tsx`, CI title                                       | none     | visual review                                |
| 2. Dead legacy      | `.github/CHANGELOG.md` (4,393 upstream matches) → **deleted**                                                        | none     | n/a                                          |
| 3. Code identifiers | Cargo crates, `stump_server` binary, npm `@stump/*` scope + ~1,500 imports, Rust types/modules, GraphQL object names | low      | **compiler / type-checker**                  |
| 4. Runtime contract | 38 `STUMP_*` env vars, `Stump.toml`, `~/.stump` data dir + `stump.db`                                                | **high** | **live-verify (only silently-failing tier)** |

**Runtime migration behavior (locked):**

- **Data dir:** auto-migrate on boot. Atomic `rename()` of `~/.stump → ~/.longbox`
  _only when the target does not already exist_. Idempotent, non-destructive,
  logged. Inside the moved dir, rename `Stump.toml → Longbox.toml` and
  `stump.db → longbox.db` in the same guarded step.
- **Env vars:** `LONGBOX_*` primary; if unset, fall back to `STUMP_*` and emit a
  one-time deprecation warning; else default. Fallback + warning are removed one
  release later. `longbox.env` + Unraid template + compose/entrypoint rewritten to
  `LONGBOX_*` now.

## 4. Canonical Naming Map

| Domain       | From → To                                                                                                                                                                      |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Cargo crates | `stump_core→longbox_core`, `stump_server→longbox_server`, `stump-config-gen→longbox-config-gen`                                                                                |
| Binary       | `stump_server→longbox_server` (Dockerfile, `.github/actions/*`, `.cargo/config.toml` aliases, entrypoint, `logging.rs`, server test harness)                                   |
| npm scope    | `@stump/{sdk,client,browser,components,graphql,i18n,web,docs}→@longbox/*` (internal only; nothing is published)                                                                |
| Rust types   | `StumpConfig→LongboxConfig`, `StumpCore→LongboxCore`, `StumpJob→LongboxJob`, `StumpConfigGenerator→LongboxConfigGenerator`, and remaining `Stump*` types surfaced in discovery |
| Rust files   | `core/src/config/stump_config.rs→longbox_config.rs`, `core/src/job/stump_job.rs→longbox_job.rs`, `core/src/config/stump_shadow_text.txt→longbox_shadow_text.txt`               |
| GraphQL      | `#[graphql(name="StumpConfig")]→"LongboxConfig"` (any other `Stump*` graphql names in discovery) → schema drift → `cargo dump-schema` + `cargo codegen`, committed together    |
| Config file  | `Stump.toml→Longbox.toml` (legacy read during migration)                                                                                                                       |
| Env vars     | all 38 `STUMP_*→LONGBOX_*` (`LONGBOX_*` primary, `STUMP_*` fallback + warn)                                                                                                    |
| Data dir     | `~/.stump→~/.longbox` (atomic-rename auto-migrate)                                                                                                                             |
| DB file      | `stump.db→longbox.db` (renamed during migration)                                                                                                                               |
| Shadow text  | `STUMP_SHADOW_TEXT`/`stump_shadow_text.txt` → longbox equivalents                                                                                                              |

**Explicitly NOT renamed:** upstream attribution links (`github.com/stumpapp/stump`)
where they credit the fork source, LICENSE provenance, and git history. Discovery
produces a false-positive exclusion list.

**Already resolved (no work):** `.stumpignore` is already unsupported (scanner
dropped it; docs updated).

## 5. Tier-4 Migration Mechanics

1. **Boot sequence** (in `core/src/config` bootstrap, before tracing init):
   resolve config dir → if legacy `~/.stump` exists **and** `~/.longbox` absent →
   atomic `rename()` → rename `Stump.toml→Longbox.toml`, `stump.db→longbox.db`
   inside → `tracing`/eprintln the migration. Guard ensures it never runs twice
   and never overwrites existing data.
2. **Env resolution helper:** a single `env_var(new_key, legacy_key)` →
   `LONGBOX_x ?? (STUMP_x + warn_once) ?? default`. Each `*_KEY` const gains a
   `LEGACY_*_KEY`. Removes the existing `// TODO(env): prefix with STUMP_` debt.
3. **Deployment rewrite:** `longbox.env`, `deploy/unraid/*` template,
   `docker-compose`/entrypoint, Dockerfile `ENV`/`ARG` → `LONGBOX_*`.

## 6. Phased Delivery (sub-agent derived)

Each phase = its own branch/PR, `ci-preflight` green before merge.

- **Phase 0 — Discovery swarm.** Parallel `Explore` agents produce the authoritative
  per-area touch-point inventory + false-positive exclusion list. Backbone of the plan.
- **Phase 1 — Branding + legacy (Tier 1+2).** README + real screenshots (reuse
  `mobile-*.png`), docs rebrand/prune, `StumpLogo`, CI title, **delete
  `.github/CHANGELOG.md`**. Parallelizable, low risk.
- **Phase 2 — Rust rename (Tier 3a).** Crates, binary, types, modules, files;
  `dump-schema` + `codegen`. Compiler-gated.
- **Phase 3 — TS rename (Tier 3b).** `@stump→@longbox` scope + all imports +
  tsconfig/path aliases + jest/vite config. Type/lint-gated.
- **Phase 4 — Runtime (Tier 4).** Env indirection + fallback, data-dir auto-migrate,
  config rename, deploy rewrite. **Live-verify** against a copy of the real data dir.
- **Phase 5 — Sweep & seal.** Re-grep for residual `stump`; rewrite the CLAUDE.md
  "load-bearing" section; update `reverse-proxy-trust-headers` and
  `longbox-live-verify-setup` memories (they name `STUMP_*`).

## 7. Verification & Rollback

- **Every phase:** `ci-preflight` skill before merge.
- **Phase 4 test matrix:** (a) fresh install (no legacy dir) boots to `~/.longbox`;
  (b) migration path — copy of real `~/.stump` present → auto-migrated, data intact,
  headless-Playwright login + library + reading-progress verified per
  `longbox-live-verify-setup`; (c) env fallback — a `STUMP_*` var set → warns +
  still applies.
- **Rollback:** phases are independent PRs; migration is idempotent + non-destructive
  (guarded on target absence); env fallback keeps un-updated configs booting.
  Release notes add a "back up appdata before upgrading" line.

## 8. Risks

| Risk                                                        | Mitigation                                                                                                   |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Data-dir migration corrupts/loses DB                        | Atomic same-fs `rename()`, guard on target absence, dry-run on a _copy_ first, backup nudge in release notes |
| Missed `STUMP_*` var silently defaults                      | Fallback-with-warning catches it; discovery enumerates all 38                                                |
| Schema drift gate fails CI                                  | `dump-schema` + `codegen` committed in the same Rust phase                                                   |
| Required status check id renamed → branch protection breaks | Keep internal ids where gated; rename display name only (Phase 1 check)                                      |
| False-positive renames (upstream URLs, "stumped")           | Discovery exclusion list; compiler/type-checker catch identifier breakage                                    |
| CLAUDE.md reverts future sessions' work                     | Phase-5 rewrite of the load-bearing section is a tracked deliverable                                         |

## 9. Out of Scope

- Renaming the upstream project or its git remote history.
- Publishing renamed packages to any registry.
- Feature changes; this is a rename/branding effort only.

---

## 10. Discovery Addendum (2026-07-17) — supersedes earlier counts/scope where in conflict

A 4-agent discovery swarm mapped the real footprint. Key corrections to §3–§8:

### 10.1 The repo is already ~60% rebranded

README prose, body copy, and the logos already read "Longbox". Most raw
`grep stump` hits are **legitimate references that must stay** (see §10.6). The
net remaining work is smaller than the 2,668 raw count implies, but the
runtime-contract tier is **larger and riskier** than the spec stated.

### 10.2 Env vars: 43 keys, not 38 — and only the prefixed ones are renamed

- `core/src/config/stump_config.rs` `mod env_keys` holds **40 constants**; plus
  **2 inline `#[env_key("…")]`** on struct fields (`ACCESS_TOKEN_TTL`,
  `REFRESH_TOKEN_TTL`) and **1 in `database.rs`** (`FORCE_DB_RESET`) = **43 total**.
- **33 are `STUMP_`-prefixed → renamed to `LONGBOX_`** with `STUMP_` fallback + warn.
- **10 are NOT `STUMP_`-prefixed → LEFT AS-IS** (decision locked): `PDFIUM_PATH`,
  `ENABLE_KOREADER_SYNC`, `ENABLE_KOBO_SYNC`, `ENABLE_OPDS_PROGRESSION`,
  `HASH_COST`, `SESSION_TTL`, `SESSION_EXPIRY_CLEANUP_INTERVAL`, `ACCESS_TOKEN_TTL`,
  `REFRESH_TOKEN_TTL`, `FORCE_DB_RESET`. No `LONGBOX_` variants added.
- **Fallback must be wired in THREE places, not one:** (a) the
  `stump-config-gen` derive macro `gen_env_var_extractors`
  (`crates/macros/stump-config-gen/src/gen_config_impls.rs:139-192`) covers ~32
  fields; (b) `OidcConfig::from_env()` (`core/src/config/oidc_config.rs:89-162`)
  reads 9 OIDC keys directly; (c) `stump_in_docker()` (`core/src/config/mod.rs:59`)
  reads `IN_DOCKER`. Only the 33 prefixed keys get the fallback+warn treatment.
- `debug_setup()` (`apps/server/src/main.rs:15-22`) sets `STUMP_*` in-process for
  dev — update it to `LONGBOX_*` so dev runs don't self-trigger the deprecation warn.

### 10.3 Data-dir migration mechanics (revised, more precise)

- **Hook point:** `bootstrap_config_dir()` (`core/src/config/mod.rs:22`) is the
  first on-disk resolution (`main.rs:29`). Migration runs there, before it returns.
- **Default dir literal:** `core/src/config/mod.rs:15` — `home.join(".stump")`.
- **DB path:** `core/src/database.rs:17-26`. `STUMP_DB_PATH`/`db_path` is a
  **directory**; `stump.db` is appended. Migration must rename `stump.db→longbox.db`
  **inside whichever directory applies** (config dir OR custom db_path).
- **WAL sidecars:** WAL mode is on (`core/src/lib.rs:235`), so `stump.db-wal` and
  `stump.db-shm` sit beside the DB and must move atomically with it (or checkpoint first).
- **Third file:** `Stump.log` (`logging.rs:15`, `stump_config.rs:408`) → `Longbox.log`.
- **Docker:** `STUMP_CONFIG_DIR=/config` (`docker/Dockerfile:123`) means the
  **dir-migration is a no-op in Docker** (env wins) — but the **DB-file rename
  `/config/stump.db→/config/longbox.db` still applies**. Keep `STUMP_CONFIG_DIR`
  working via fallback so existing `/config` deployments don't break.

### 10.4 THREE new categories (not in original spec) — decisions locked

1. **Browser persisted state (Tier 4, frontend).** ~10 `stump-*`/`stump:*`
   localStorage/zustand-persist keys (`stump-user-store`, `stump-main-store`,
   `stump-${key}-layout-store`, `stump:entity-card-density`, `stump-explorer-layout`,
   `stump-image-sizes`, `stump:epubjs-locations-cache`, `stump-fonts-stylesheet`,
   `stump-debug-storage`, `stump-alert-dismissed-*`, plus `stump-user-store` in
   `apps/web/src/index.html`). **Decision: rename to `longbox-*`/`longbox:*` + a
   one-time read-old→write-new migration shim** so saved UI/reader state carries over.
2. **Client↔server wire contracts (Tier 4).** **Decision: full rename, in lockstep
   on both sides.** `X-Stump-Save-Session`→`X-Longbox-Save-Session`
   (`STUMP_SAVE_BASIC_SESSION_HEADER` in `packages/sdk/src/constants.ts:1` + the
   server header) **and** the `stump_` API-key prefix→`longbox_` (server issues +
   validates; `CreateAPIKeyModal.tsx:49`). **Existing API keys are invalidated —
   release notes must say "re-create API keys after upgrade."**
3. **i18n JSON keys.** Keys `stump`, `stumpServer`, `noStumpServers`, `nonStumpData`
   in ~40 `packages/i18n/src/locales/*.json` (values already say "Longbox").
   **Decision (default): rename keys + every `t('…')` call-site in lockstep.**

### 10.5 Branding assets & the app-linked changelog

- **README hero (`docs/public/images/landing-{dark,light}.png`), `og.png`, and
  `favicon.ico/png` are still UPSTREAM STUMP assets.** They must be replaced with
  Longbox captures. The three root `mobile-*.png` are staged but unreferenced.
  → Phase 1 needs **new desktop screenshots** (the mobile ones aren't a hero).
- `.github/CHANGELOG.md` (deleted) is **linked from the running app** at
  `packages/browser/src/scenes/settings/server/general/HelpfulLinks.tsx:41` — update
  or remove that link in the same phase.
- CI: renaming `ci.yaml` title `'Stump Checks CI'`→`'Longbox Checks CI'` is **safe** —
  no required status-check context (`Rust checks`, `TypeScript checks`, …) contains
  `stump`, so branch protection is unaffected.

### 10.6 Hard constraint — attribution & upstream links are PRESERVED

The following are **never** renamed (MIT attribution + link integrity):

- `LICENSE` "Copyright (c) 2022 Aaron Leopold"; "fork of Stump" provenance in
  `README.md:15,41,128`, `deploy/unraid/*`, `Footer.tsx` copyright.
- All `github.com/stumpapp/stump/{issues,pull,commit,discussions}/…` links (dead if
  the org is swapped — hundreds across docs + the changelog).
- Upstream community/funding/infra: Crowdin `crowdin.com/project/stump`,
  `opencollective.com/stump`, upstream Discord, `github.com/sponsors/aaronleopold`,
  `aaronleopold/stump:latest` image in OIDC examples.
- False positives a blind replace would corrupt: `.stumpignore` (in a
  "no-longer-supported" sentence), `stump.db`/`stump-legacy.db`/`/stump-old/` in
  migration-instruction docs, `stump_policy` Authelia example, example hostnames
  (`stump.example.com`), and git SHAs inside upstream commit URLs.
- **Distinct from the above:** the fork's own canonical URLs currently pointing at
  `stumpapp.dev` (`Head.tsx`, `__root.tsx`, issue templates) ARE rebrand targets, not
  attribution — fix them.

### 10.7 Docs are almost entirely LIVE (rebrand in place, not prune)

43 of 44 `docs/content/**` files are real Longbox docs → rebrand in place (mostly
just the `stumpapp.dev` self-URLs + stale removed-app mentions). Only
`guides/breaking-changes/0.1.0.mdx` is upstream-legacy → prune (with its `meta.json`
nav entry). Several LIVE files carry stale references to the deleted Tauri
desktop / Expo mobile apps (`contributing.mdx`, `server-config.mdx` default origins,
`themes.mdx`, `thumbnails.mdx`) → prune those snippets inline.

### 10.8 Revised risk additions

| Risk                                                       | Mitigation                                                              |
| ---------------------------------------------------------- | ----------------------------------------------------------------------- |
| Fallback wired only in the macro → OIDC/docker keys missed | Wire fallback in all 3 read sites (§10.2); test an OIDC + docker key    |
| WAL sidecar left behind → DB inconsistency                 | Move `stump.db`+`-wal`+`-shm` together, or checkpoint before rename     |
| Custom `STUMP_DB_PATH` dir not migrated                    | Rename `stump.db` inside the resolved db dir, not just the config dir   |
| API-key prefix rename invalidates keys silently            | Release-note "re-create API keys"; surface in-app if feasible           |
| localStorage rename wipes prefs                            | Read-old→write-new shim, verified in live-verify                        |
| Upstream links/attribution vandalized by a blind replace   | §10.6 exclusion list is a hard constraint; no global `s/stump/longbox/` |
