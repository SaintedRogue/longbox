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
