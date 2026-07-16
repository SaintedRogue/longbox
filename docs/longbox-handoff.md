# Longbox — Workstream Handoff

_Last updated: 2026-07-16. Written to kick off the next phase of work; read this first, then the referenced plans._

## 0. Snapshot

|                     |                                                                                                                                                                                                                                     |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Repo root**       | `~/longbox` (relocated from `~/Downloads/longbox` on 2026-07-16)                                                                                                                                                                    |
| **Origin**          | `https://github.com/SaintedRogue/longbox` (`upstream` = `stumpapp/stump`)                                                                                                                                                           |
| **`main` HEAD**     | `7428c1c4` — `docs: rebrand README around the Longbox identity` (pushed; tree clean)                                                                                                                                                |
| **What Longbox is** | A PWA-first fork of [Stump](https://github.com/stumpapp/stump): a fast self-hosted comics/manga/ebook server. Rust (Axum + SeaORM) backend, React 19 installable PWA, OPDS. Desktop/mobile native apps removed → whole repo is MIT. |

Everything through Wave 3b Stream 2 is merged, pushed, and live-verified. The next work is the **offline download subsystem (Wave 3b Streams 3–5)**, plus two deferred backlogs (Metron validation, security hardening).

---

## 1. What's already shipped

| Area                                      | State                           | Key locations                                                                                                                                                                      |
| ----------------------------------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Rebrand + identity**                    | ✅                              | `README.md`, `.github/images/banner.png` + `logo*.svg`, `packages/browser/src/components/LongboxMark.tsx` (inline line-mark), `docs/longbox-design-notes.md`                       |
| **Fork mechanics**                        | ✅                              | cargo pkgs `longbox_core`/`longbox_server` (lib names kept `stump_core`/`stump_server` → zero source churn); `@stump/*` npm scopes intentionally unchanged (merge-noise avoidance) |
| **Metron metadata provider**              | ✅ shipped, ⚠️ unvalidated      | `crates/integrations/metadata/src/providers/metron.rs` — Basic auth (`username:password` token), governor rate-limit, cv_id direct lookup. See §4B.                                |
| **ComicVine ID recovery**                 | ✅                              | `core/src/filesystem/media/metadata.rs` — `[Issue ID N]` + `[CVDB N]` tag conventions, `4000-N` web fallback; language split; validated on real DC All In file                     |
| **Wave 3a — navigation**                  | ✅ live-verified                | `useScrollRestoration.ts`, `AppRouter.tsx`, `AppLayout.tsx`, book-peek overlay. ADR: `docs/adr/0001-router-and-scroll-restoration.md`                                              |
| **Wave 3b Stream 1 — progress outbox**    | ✅ live-verified offline→online | `packages/browser/src/offline/{db,progressOutbox,progressMutation,useProgressOutbox}.ts` + `__tests__` (17 blocks). Durable IndexedDB queue, flush on `online`/mount.              |
| **Wave 3b Stream 2 — iOS splash/install** | ✅                              | `packages/browser/public/assets/splash/*`, `apps/web/src/index.html`                                                                                                               |

---

## 2. Build / test / run

All commands from `~/longbox`. Yarn is invoked as `npx -y yarn@1.22.21` (no global yarn).

```bash
# JS
npx -y yarn@1.22.21 install
npx -y yarn@1.22.21 check-types              # full monorepo typecheck
npx -y yarn@1.22.21 workspace @stump/browser test   # Jest (NOT vitest — see §3)
npx -y yarn@1.22.21 web build                # build the PWA

# Rust
cargo build -p longbox_server
cargo test -p longbox_core
cargo test -p metadata_integrations

# Run the server (debug): serves the built web app on :10801
STUMP_CONFIG_DIR=<dir> ./target/debug/longbox_server
# Hot-reload the web UI instead:
npx -y yarn@1.22.21 dev:web
```

**Debug DB note:** in debug builds the DB path is baked at compile time from `env!("CARGO_MANIFEST_DIR")` (`core/src/database.rs:23` → `<root>/core/dev.db`). Because of that, **after the 2026-07-16 move the pre-existing binary pointed at the old path** — a rebuild re-bakes it. If a debug binary ever can't find `dev.db`, force a recompile: `touch core/src/database.rs && cargo build -p longbox_server` (a plain rebuild is a no-op when `mv` preserved mtimes).

---

## 3. Development workflow & known gotchas

The waves so far used a **parallel worktree-agent** flow; keep it:

1. **Plan** lives in `docs/` (checkbox tasks, TDD). Spawn `worker-builder` agents in isolated git worktrees (one per independent stream).
2. **Review** each stream with `feature-dev:code-reviewer` (or `superpowers:requesting-code-review`) → fix loop → merge to `main`.
3. **Live-verify** the merged result — headless Playwright + a running server + real comics. Agents can write code and unit tests; **only the driver can do the offline→online / server-kill live tests.** Do them.

**Gotchas that already bit us:**

- **Test runner is Jest, not vitest.** `packages/browser` runs `jest`. The Wave 3b plan (`docs/longbox-wave3b-offline-plan.md`) says "vitest" in Streams 1–5 — that's wrong; Stream 1 shipped on Jest. Mentally substitute `jest` when executing Streams 3–5. Tests use `fake-indexeddb`; jsdom needs a `structuredClone` polyfill (already in the offline tests).
- **Worktree + lerna bug:** from inside a worktree, `yarn check-types` / `yarn web build` resolve to the **main** checkout (lerna workspace-root bug). Inside a worktree use direct `npx tsc -b <pkg>/tsconfig.json` / `npx vite build`.
- **Pre-commit hook** (husky + lint-staged): prettier `--check` on staged JS/TS/MD/JSON, `cargo fmt --check` on `.rs`. Run `cargo fmt` / prettier before committing or the commit is rejected.
- **PWA service worker:** vite-plugin-pwa `generateSW`, `registerType: 'prompt'`. `includeManifestIcons: false` is load-bearing (a png-glob collision otherwise breaks SW install — only caught via live SW eval). Verify SW changes in a real browser, not just build output.
- **Commit trailer:** `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`. Keep Rust and TS in separate commits.

---

## 4. Next workstreams (prioritized)

### A. Wave 3b Streams 3–5 — offline download subsystem ⭐ main event

**Plan:** `docs/longbox-wave3b-offline-plan.md` (Streams 3–5 are specified at task/interface level, ready to execute subagent-driven). This is the multi-day payload: it rebuilds, for the PWA, the offline downloads the deleted Expo app gave natively.

- **Stream 3 — storage foundation:** bump `offline/db.ts` to `DB_VERSION 2`, add `downloads` + `downloadQueue` stores; `downloadRecords.ts` (CRUD), `blobStore.ts` (Cache API blob store keyed by real `/api/v2/media/*` URLs), `persist.ts` (`navigator.storage.persist()`). Ships with no UI — fine.
- **Stream 4 — download orchestration:** `downloadManager.ts` singleton (enqueue/cancel/retry, concurrency 2, per-format fetch via `sdk.axios` so it works in both cookie- and token-auth), `useDownloads.ts` hooks, download button in `BookActionMenu.tsx`, `/downloads` scene + route + sidebar entry.
- **Stream 5 — offline-aware readers:** `resolveOfflineUrl.ts`; make `EntityImage.tsx` / PDF / EPUB readers check the blob store before the network; an offline reader entry that synthesizes the book object from a `DownloadRecord` so a downloaded book reads with the server stopped (progress writes fall through to the Stream 1 outbox).

**Design rationale (already decided):** app-layer storage (IndexedDB catalog + Cache API bytes), **not** a service-worker rewrite — the SW cache-first path would bypass token-mode `AuthImage`. Parity model is mapped to the old Expo `downloaded_files`/`download_queue`/`read_progress` schema in the plan's self-review.

**Recommended kickoff:** execute Stream 3 first (foundation, no user-facing risk), review + merge, then 4, then 5. Gate each with the plan's stated gate. Live-verify Stream 4 by downloading a real CBZ from the test library and Stream 5 by reading it with the server stopped.

**Test library / mount:** comics live on the Unraid NFS server `10.0.0.2` (`/mnt/comics`, read-only when mounted — ask the user to mount if needed). Sample comics with known CVDB tags were previously copied to the session scratchpad for parser/download tests.

### B. Metron validation — honest User-Agent + wiremock fixtures (deferred)

The Metron provider shipped **without live validation** (user said "forget about the metron validation for right now"). Two pieces remain:

1. **Honest User-Agent:** the client is `reqwest::Client::new()` (`metron.rs:43`) with no UA. Set a real identifying UA (e.g. `Longbox/<version> (+https://github.com/SaintedRogue/longbox)`) via `ClientBuilder::user_agent(...)`.
2. **Fixture tests:** add `wiremock`-backed tests that replay recorded Metron responses (cv_id lookup, search, credit buckets) so the provider is testable without hitting the network.

**Why decoupled from live hits:** `metron.cloud` sits behind **Anubis** (Xe Iaso's proof-of-work "AI firewall"); a burst of automated requests got the test IP challenged/blocked. Validate against fixtures, not the live API. Credentials are in `~/metron.env` (never echo the password). Task #12 tracks this.

### C. Post-Wave-2 hardening backlog (from the Stream E security audit)

Recorded in `docs/longbox-investigation.md` → "Appendix: post-Wave-2 hardening backlog":

- **At-rest key management (Medium, inherited):** `server_config.encryption_key` lives in the same SQLite DB as the ciphertexts it protects and is held in memory as plaintext. Now guards a reusable Metron `username:password`. Fix direction: derive/load the key from an env var or server-side secret outside the DB.
- **Response body-size cap (Info):** provider HTTP clients call `response.json()` with no size bound — cheap hardening.
- **`crowdin.yml`** — upstream translation config, unused by Longbox; remove when convenient.

---

## 5. Orientation — where things live

```
apps/server/     Axum server (also serves the web app)     core/            scanning, metadata, DB (dev.db lives in core/)
apps/web/        PWA entry (index.html, App.tsx)           crates/          migrations, models, graphql, integrations/
packages/browser React UI — scenes/, components/, offline/ docs/            design notes, ADRs, plans, THIS handoff
packages/{client,sdk,graphql,components,i18n}
```

Design/context docs, in reading order for a newcomer: this file → `docs/longbox-design-notes.md` → `docs/longbox-investigation.md` → `docs/longbox-phase2-plan.md` → `docs/adr/0001-router-and-scroll-restoration.md` → `docs/longbox-wave3b-offline-plan.md`.

---

## 6. Open decision for the driver

The only real fork in the road: **start Wave 3b Stream 3 (downloads) now**, or clear a smaller backlog item (Metron §4B or hardening §4C) first. Streams 3–5 are the larger, higher-value push and are fully specced — recommended default is to begin there subagent-driven, and slot the backlogs in between merges.
