# Longbox — Workstream Handoff

_Last updated: 2026-07-16 (after Wave 3b completion). Read this first, then the referenced plans/memory._

## 0. Snapshot

|                     |                                                                                                                                                                                                                                     |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Repo root**       | `~/longbox` (relocated from `~/Downloads/longbox` on 2026-07-16)                                                                                                                                                                    |
| **Origin**          | `https://github.com/SaintedRogue/longbox` (`upstream` = `stumpapp/stump`)                                                                                                                                                           |
| **`main` HEAD**     | `196ad835` — `Merge offline boot resilience: degrade to an offline shell on network error` (pushed)                                                                                                                                 |
| **What Longbox is** | A PWA-first fork of [Stump](https://github.com/stumpapp/stump): a fast self-hosted comics/manga/ebook server. Rust (Axum + SeaORM) backend, React 19 installable PWA, OPDS. Desktop/mobile native apps removed → whole repo is MIT. |

**The whole Wave 3b offline download + reading subsystem (Streams 3–5) is DONE, merged, pushed, and
live-verified end-to-end** (download a real CBZ → read it with the server stopped). A follow-up to make
**paged-mode** offline reading work is in progress. See §4 for what's actually next.

⚠️ **Working-tree note:** two rebrand files are uncommitted from a concurrent session —
`core/src/config/stump_shadow_text.txt` (startup banner) and `docker/Dockerfile` (LABELs). Not part of
Wave 3b; leave for that session or commit separately.

---

## 1. What's already shipped

| Area                                        | State                         | Key locations                                                                                                                                                                        |
| ------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Rebrand + identity**                      | ✅                            | `README.md`, `.github/images/*`, `packages/browser/src/components/LongboxMark.tsx`, `docs/longbox-design-notes.md`                                                                   |
| **Fork mechanics**                          | ✅                            | cargo `longbox_core`/`longbox_server` (lib names kept `stump_*` → zero churn); `@stump/*` npm scopes unchanged                                                                       |
| **ComicVine ID recovery**                   | ✅                            | `core/src/filesystem/media/metadata.rs` — `[Issue ID N]`/`[CVDB N]` tags, `4000-N` web fallback                                                                                      |
| **Wave 3a — navigation**                    | ✅ live-verified              | `useScrollRestoration.ts`, `AppRouter.tsx`. ADR `docs/adr/0001-*`                                                                                                                    |
| **Wave 3b S1 — progress outbox**            | ✅ live-verified              | `packages/browser/src/offline/{db,progressOutbox,useProgressOutbox}.ts`                                                                                                              |
| **Wave 3b S2 — iOS splash/install**         | ✅                            | `packages/browser/public/assets/splash/*`, `apps/web/src/index.html`                                                                                                                 |
| **Wave 3b S3 — offline storage foundation** | ✅                            | `offline/{db.ts (DB v2),downloadRecords.ts,blobStore.ts,persist.ts}` — IndexedDB catalog + Cache-API blob store (`longbox-offline-v1`)                                               |
| **Wave 3b S4 — download orchestration**     | ✅ live-verified              | `offline/{downloadManager.ts,downloadFetcher.ts,downloadStore.ts,useDownloads.ts}`, `scenes/book/OfflineDownloadButton.tsx`, `scenes/downloads/DownloadsScene.tsx` + route + sidebar |
| **Wave 3b S5 — offline-aware readers**      | ✅ live-verified              | `offline/resolveOfflineUrl.ts`, `EntityImage.tsx` (cache-first), PDF/EPUB byte paths, `scenes/downloads/{OfflineBookReaderScene,synthesizeReaderBook,DownloadsRouter}.tsx`           |
| **Offline boot resilience**                 | ✅ live-verified              | `AppLayout.tsx` (ERR_NETWORK → offline mode, not redirect) + `OfflineAppShell.tsx`                                                                                                   |
| **Metron provider + validation**            | ✅ shipped, ⚠️ IP-banned live | `crates/integrations/metadata/src/providers/metron.rs`, `src/types/validation.rs` — honest UA + wiremock fixtures (53 tests). See §4B + memory `metron-ip-ban`.                      |

**Offline subsystem architecture (as built):** app-layer storage — IndexedDB catalog (records + queue)

- Cache API bytes keyed by real `/api/v2/media/*` URLs — NOT a service-worker rewrite (SW cache-first
  would bypass token-mode `AuthImage`). Download fetches via `sdk.axios` (carries cookie OR bearer). The
  offline reader synthesizes the book object from a `DownloadRecord`; progress writes fall through to the
  S1 outbox. **Boot resilience:** a network failure (`ERR_NETWORK`) renders a chrome-less `OfflineAppShell`
  (the `/downloads/*` routes read only local data); a 401 still redirects to login.

---

## 2. Build / test / run

All commands from `~/longbox`. Yarn is `npx -y yarn@1.22.21` (no global yarn).

```bash
# JS
npx -y yarn@1.22.21 install
npx -y yarn@1.22.21 workspace @stump/browser test    # Jest (NOT vitest — see §3)
npx -y yarn@1.22.21 web build                          # build the PWA -> apps/web/dist (a BUILD ARTIFACT)
npx tsc -b packages/browser/tsconfig.json              # typecheck the browser pkg

# Rust
cargo build -p longbox_server
cargo test -p metadata_integrations

# Run the server (debug): serves the built web app on :10801
STUMP_CONFIG_DIR=$HOME/.stump ./target/debug/longbox_server
```

**Debug DB note:** debug builds bake the DB path at compile time = `<root>/core/dev.db`. If a binary
can't find `dev.db` after a move, `touch core/src/database.rs && cargo build -p longbox_server` re-bakes it.

**Live-verify recipe** (server + auth + /mnt/comics library + headless Playwright): saved to session
**memory** `longbox-live-verify-setup` — read it before attempting a live verify. Key gotchas: the served
app is `apps/web/dist`, so **rebuild `web build` after ANY packages/browser change** or you verify a stale
app; the SW is `registerType:'prompt'` so it only controls the page after a reload — wait for
`navigator.serviceWorker.controller` before simulating offline. Comics are at `/mnt/comics` (NFS `10.0.0.2`).

---

## 3. Development workflow & gotchas

**Flow used for Waves 3b S3–S6 (keep it):** subagent-driven (superpowers:subagent-driven-development) —
one **feature branch per stream** off `main` (NOT worktrees — the lerna bug below made branch-per-stream
cleaner), fresh implementer subagent per task, spec+quality review per task, fix loop, merge, then
live-verify. Progress tracked in `.superpowers/sdd/progress.md` (gitignored; recover from `git log`).

- **Test runner is Jest, not vitest** (the wave3b plan says vitest — wrong). `packages/browser` uses `jest` + `fake-indexeddb`.
- **Rebuild the web app after browser changes** — the server serves `apps/web/dist`; a stale dist silently verifies old code (this bit us twice mid-Wave-3b).
- **Worktree + lerna bug:** inside a worktree, `yarn check-types`/`web build` resolve to the main checkout. Prefer branch-per-stream in the main checkout, or use direct `npx tsc -b`/`npx vite build` in a worktree.
- **Pre-commit** (husky + lint-staged): prettier `--check` on staged JS/TS/MD/JSON, `cargo fmt --check` on `.rs`. Run prettier / `cargo fmt` first, or the commit is rejected. Generated `graphql.ts` and locale JSON must be prettier-clean too.
- **PWA service worker:** vite-plugin-pwa `generateSW`, `registerType:'prompt'`, `includeManifestIcons:false` is load-bearing. Verify SW behavior in a real browser.
- **Commit trailer:** `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`. Keep Rust and TS in separate commits.

---

## 4. Next workstreams (prioritized)

### A. Paged-mode offline reading ⭐ IN PROGRESS (this session)

The offline reader currently forces **continuous-vertical** mode: `ImageBasedReader`'s paged
`handleChangePage` calls `navigate('/books/:id/reader?page=N')` on every page turn, which leaves the
offline route for a server-dependent one. `synthesizeReaderBook.ts` sets `ReadingMode.ContinuousVertical`
to sidestep it. Follow-up (branch off `196ad835`): add a prop to `ImageBasedReader` that suppresses the
URL-page-sync navigation, have `OfflineBookReaderScene` pass it, and let the offline reader respect the
user's persisted reading preferences (reader store `settings` — persisted, available offline) instead of
forcing continuous. Re-verify paged offline with the live-verify recipe.

### B. Deferred offline pieces

- **EPUB server-down reading:** `EpubJsReader` also needs the server-parsed `epubById` (spine/toc) which
  isn't synthesizable from a `DownloadRecord`. S5 added the cached-BYTES path (loads a downloaded epub's
  ArrayBuffer when online); full server-down EPUB needs client-side epub parsing. Comics + PDF work fully offline.
- **Minor backlogs** from per-task reviews (in `.superpowers/sdd/progress.md`): S3 `persist.ts` try/catch
  for a present-but-erroring API; blobStore DI-fallback/throw branch untested; `downloadRecords` stores
  `totalBytes: undefined`; various test-hygiene items.

### C. Metron live validation — blocked on IP (deferred)

Provider now has an honest User-Agent + wiremock fixture tests (53 passing). **Live validation is blocked:**
the real egress IP is firewall-banned by Metron (`metron.cloud` behind Anubis PoW). See memory `metron-ip-ban`
— test via VPN, stay compliant (no rotating proxies). Creds in `~/metron.env` (never echo the password).

### D. Post-Wave-2 hardening backlog

`docs/longbox-investigation.md` → "post-Wave-2 hardening backlog": at-rest key management (encryption_key
in the same DB as ciphertexts — now guards the Metron creds); provider `response.json()` size cap; remove
unused `crowdin.yml`.

---

## 5. Orientation — where things live

```
apps/server/     Axum server (serves the web app)     core/            scanning, metadata, DB (dev.db in core/)
apps/web/        PWA entry + build output (dist/)     crates/          migrations, models, graphql, integrations/metadata
packages/browser React UI:                            docs/            design notes, ADRs, plans, THIS handoff
  src/offline/          the whole offline subsystem (db, records, blobStore, manager, fetcher, store, hooks, resolveOfflineUrl)
  src/scenes/downloads/ DownloadsScene, OfflineBookReaderScene, synthesizeReaderBook, DownloadsRouter
  src/AppLayout.tsx + OfflineAppShell.tsx   offline boot resilience
packages/{client,sdk,graphql,components,i18n}
```

Reading order for a newcomer: this file → `docs/longbox-design-notes.md` → `docs/longbox-investigation.md`
→ `docs/longbox-wave3b-offline-plan.md` (Streams 3–5 spec; note the "vitest"→jest correction) → session
memory (`longbox-live-verify-setup`, `metron-ip-ban`).

---

## 6. Open decision for the driver

Wave 3b's offline subsystem is complete and proven. The immediate thread is **paged-mode offline (§4A)**.
After that, the biggest open choices are: **EPUB server-down reading** (needs client-side epub parsing —
real effort), the **hardening backlog** (§4D), or resuming **Metron live validation** once a compliant
egress path (VPN) is available. No item is blocking; pick by appetite.
