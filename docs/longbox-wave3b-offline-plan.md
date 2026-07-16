# Longbox Wave 3b — Offline & Durable-Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Rebuild, for the web PWA, the offline capabilities the deleted Expo app provided natively: durable reading-progress sync, offline-readable downloaded books, and a proper installable/splash experience.

**Architecture:** App-layer storage (not service-worker runtime caching): an **IndexedDB catalog** (via `idb`) holds structured records — a progress outbox, download records, and a download queue — and the **Cache API** holds the actual bytes (comic page images and whole epub/pdf files) keyed by their real `/api/v2/media/*` URLs. Readers become "offline-aware": their existing fetch paths check the store first and fall back to the network. This is controllable (only explicit downloads are stored), works in both session- and token-auth modes (the download worker fetches with the SDK's auth and stores opaque blobs), and needs no service-worker rewrite — mirroring how the Expo app read from local storage.

**Tech Stack:** `idb` (tiny IndexedDB promise wrapper), Cache API, `navigator.storage.persist()`, existing zustand store factories (`@stump/client`), existing `updateMediaProgress` GraphQL mutation, `vite-plugin-pwa` (unchanged), `rsvg-convert` for iOS splash asset generation.

## Global Constraints

- Yarn is `npx -y yarn@1.22.21`; verify TS with per-package `npx tsc -b` when in a worktree (lerna resolves to the main checkout otherwise). Pre-commit runs prettier `--check` on staged JS/TS/MD/JSON and `cargo fmt` on `.rs`.
- Web app auth defaults to **session (cookie)** mode (`apps/web/src/App.tsx` passes no `authMethod`); token/api-key mode also exists (`sdk.isTokenAuth`). Offline fetch must handle both: fetch via `sdk.axios`/`sdk.execute` (which already carry the right auth) and store the resulting blob.
- Media URLs (`@stump/sdk`): pages `{origin}/api/v2/media/{id}/page/{n}`, whole file `{origin}/api/v2/media/{id}/file`, thumbnail `{origin}/api/v2/media/{id}/thumbnail`. `/file` honors Range and requires `UserPermission::DownloadFile`; `/page` requires only an authenticated user.
- The progress mutation is `updateMediaProgress(id, input: MediaProgressInput)`; input is `{ paged: { page, elapsedSecondsDelta } }` or `{ epub: { epubcfi, percentage, isComplete, elapsedSecondsDelta } }`. Reuse it verbatim for outbox replay.
- Brand assets keep `longbox-*` names (immutable-cached, not content-hashed) — any new asset must use a fresh name.
- Commits end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`. Keep Rust/TS in separate commits; the whole of Wave 3b is TS-only except (optionally) none.
- i18n: user-facing strings added to `packages/i18n/src/locales/en-US.json` + `en-GB.json` only.

## Recommended sequencing

Five streams, ordered by value-per-risk. **Streams 1 and 2 are small, self-contained, and shippable immediately; Streams 3–5 are the multi-day download subsystem and should run as a dedicated subagent-driven execution after 1–2 merge.**

| Stream                         | What                                                                             | Depends on                          | Size   |
| ------------------------------ | -------------------------------------------------------------------------------- | ----------------------------------- | ------ |
| 1. Progress outbox             | Durable IndexedDB queue for failed progress mutations, flush on `online`/startup | nothing                             | small  |
| 2. iOS splash + install polish | `apple-touch-startup-image` set, status-bar meta, install affordance             | nothing                             | small  |
| 3. Offline storage foundation  | `idb` catalog schema + Cache API blob store + `persist()`                        | nothing (but 3–5 are one subsystem) | medium |
| 4. Download orchestration      | Queue manager, downloads store, download button + Downloads view                 | 3                                   | large  |
| 5. Offline-aware readers       | Readers read pages/epub/pdf from the store; offline reading works                | 3, 4                                | medium |

Streams 1 and 2 are fully specified below. Streams 3–5 are specified at the interface/task level (file structure, types, per-task deliverables, verification) — enough to execute subagent-driven, with the parity model from the Expo teardown baked in.

---

# STREAM 1 — Reading-progress outbox (durable sync)

**Why first:** Wave 1/Stream B made progress mutations retry with backoff and toast on failure, but a failure that outlives the retries (offline, closed tab) still loses the update. The Expo app kept an `UNSYNCED/SYNCING/SYNCED/ERROR` row per book and flushed on reconnect. This stream ports that as a small IndexedDB outbox, making the existing readers durable with a minimal change to their `onError`.

**File structure:**

- Create `packages/browser/src/offline/db.ts` — the shared `idb` database (one DB, versioned; this stream creates the `progressOutbox` store; Stream 3 adds more stores in a later version bump).
- Create `packages/browser/src/offline/progressOutbox.ts` — enqueue / list / delete / flush logic, framework-agnostic (testable in isolation).
- Create `packages/browser/src/offline/useProgressOutbox.ts` — a hook that wires flush to the `online` event + app mount, using `useSDK()` to replay via `sdk.execute`.
- Modify `packages/browser/src/scenes/book/reader/BookReaderScene.tsx` and `components/readers/epub/EpubJsReader.tsx` — on terminal `onError`, enqueue instead of only toasting.
- Modify `packages/browser/src/AppLayout.tsx` — mount `useProgressOutbox()`.
- Test `packages/browser/src/offline/__tests__/progressOutbox.test.ts` (vitest + `fake-indexeddb`).

### Task 1.1: Add `idb` + `fake-indexeddb`, create the shared DB module

**Files:** Create `packages/browser/src/offline/db.ts`; modify `packages/browser/package.json` (deps `idb@^8`, devDeps `fake-indexeddb@^6`).

**Interfaces:**

- Produces: `getDB(): Promise<IDBPDatabase<LongboxOfflineDB>>` and the `LongboxOfflineDB` schema type. In this stream the schema has one store: `progressOutbox` (keyPath `bookId`).

- [ ] **Step 1: Add deps** — `npx -y yarn@1.22.21 workspace @stump/browser add idb@^8` and `... add -D fake-indexeddb@^6`. Verify they land in `packages/browser/package.json`.

- [ ] **Step 2: Write the DB module**

```ts
// packages/browser/src/offline/db.ts
import { type DBSchema, type IDBPDatabase, openDB } from 'idb'

export type OutboxStatus = 'UNSYNCED' | 'SYNCING' | 'ERROR'

/** One durable progress record per book, awaiting sync to the server. */
export type ProgressOutboxRecord = {
	bookId: string
	/** Discriminated by reader kind, mirrors MediaProgressInput. */
	kind: 'paged' | 'epub'
	page?: number
	epubcfi?: string
	percentage?: number
	isComplete?: boolean
	/** Accumulated unsynced elapsed seconds to add on the server (additive, safe to replay). */
	elapsedSecondsDelta: number
	status: OutboxStatus
	updatedAt: number
	failureReason?: string
}

export interface LongboxOfflineDB extends DBSchema {
	progressOutbox: {
		key: string
		value: ProgressOutboxRecord
		indexes: { 'by-status': OutboxStatus }
	}
}

const DB_NAME = 'longbox-offline'
const DB_VERSION = 1

export function getDB(): Promise<IDBPDatabase<LongboxOfflineDB>> {
	return openDB<LongboxOfflineDB>(DB_NAME, DB_VERSION, {
		upgrade(db) {
			if (!db.objectStoreNames.contains('progressOutbox')) {
				const store = db.createObjectStore('progressOutbox', { keyPath: 'bookId' })
				store.createIndex('by-status', 'status')
			}
		},
	})
}
```

- [ ] **Step 3: Verify** — `npx tsc -b tsconfig.json` in `packages/browser` is clean. Commit: `feat(offline): shared IndexedDB module + progress outbox schema`.

### Task 1.2: Outbox operations (TDD)

**Files:** Create `packages/browser/src/offline/progressOutbox.ts`; Test `packages/browser/src/offline/__tests__/progressOutbox.test.ts`.

**Interfaces:**

- Consumes: `getDB`, `ProgressOutboxRecord` from `./db`.
- Produces:
  - `enqueueProgress(record: Omit<ProgressOutboxRecord, 'status' | 'updatedAt'>): Promise<void>` — upserts by `bookId`, **accumulating** `elapsedSecondsDelta` into any existing unsynced row (so repeated failures don't lose time), status `UNSYNCED`.
  - `listUnsynced(): Promise<ProgressOutboxRecord[]>`
  - `markSynced(bookId: string): Promise<void>` (deletes the row)
  - `markError(bookId: string, reason: string): Promise<void>`
  - `toMutationInput(r: ProgressOutboxRecord): { id: string; input: MediaProgressInput }` — rebuilds the exact GraphQL variables.

- [ ] **Step 1: Failing tests** (vitest; `fake-indexeddb/auto` imported at top to polyfill IndexedDB):

```ts
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'

import { deleteDB } from 'idb'
import { enqueueProgress, listUnsynced, markSynced, toMutationInput } from '../progressOutbox'

describe('progressOutbox', () => {
	beforeEach(async () => {
		await deleteDB('longbox-offline')
	})

	it('enqueues a paged record and lists it', async () => {
		await enqueueProgress({ bookId: 'b1', kind: 'paged', page: 5, elapsedSecondsDelta: 30 })
		const rows = await listUnsynced()
		expect(rows).toHaveLength(1)
		expect(rows[0]).toMatchObject({ bookId: 'b1', page: 5, elapsedSecondsDelta: 30, status: 'UNSYNCED' })
	})

	it('accumulates elapsed delta on repeated enqueue for the same book', async () => {
		await enqueueProgress({ bookId: 'b1', kind: 'paged', page: 5, elapsedSecondsDelta: 30 })
		await enqueueProgress({ bookId: 'b1', kind: 'paged', page: 8, elapsedSecondsDelta: 12 })
		const rows = await listUnsynced()
		expect(rows).toHaveLength(1)
		expect(rows[0].page).toBe(8) // latest position wins
		expect(rows[0].elapsedSecondsDelta).toBe(42) // time accumulates
	})

	it('markSynced removes the row', async () => {
		await enqueueProgress({ bookId: 'b1', kind: 'paged', page: 5, elapsedSecondsDelta: 30 })
		await markSynced('b1')
		expect(await listUnsynced()).toHaveLength(0)
	})

	it('toMutationInput rebuilds paged and epub variables', async () => {
		const paged = toMutationInput({ bookId: 'b1', kind: 'paged', page: 5, elapsedSecondsDelta: 30, status: 'UNSYNCED', updatedAt: 0 })
		expect(paged).toEqual({ id: 'b1', input: { paged: { page: 5, elapsedSecondsDelta: 30 } } })
		const epub = toMutationInput({ bookId: 'b2', kind: 'epub', epubcfi: 'x', percentage: 0.5, isComplete: false, elapsedSecondsDelta: 10, status: 'UNSYNCED', updatedAt: 0 })
		expect(epub).toEqual({ id: 'b2', input: { epub: { epubcfi: 'x', percentage: 0.5, isComplete: false, elapsedSecondsDelta: 10 } } })
	})
})
```

- [ ] **Step 2: Run to fail** — `npx vitest run src/offline/__tests__/progressOutbox.test.ts` in `packages/browser` → FAIL (module not found). (Confirm vitest is the browser package's test runner first via `package.json` scripts; the repo uses vitest per existing `__tests__` dirs.)

- [ ] **Step 3: Implement** `progressOutbox.ts` — the upsert reads any existing row and sums `elapsedSecondsDelta`, overwrites position fields with the latest, sets `status:'UNSYNCED'`, `updatedAt: Date.now()`. `toMutationInput` switches on `kind`. (Full implementation; no placeholders — the test above pins every field.)

- [ ] **Step 4: Run to pass**; then **Commit**: `feat(offline): progress outbox operations`.

### Task 1.3: Flush hook + reader wiring

**Files:** Create `packages/browser/src/offline/useProgressOutbox.ts`; modify `BookReaderScene.tsx`, `EpubJsReader.tsx`, `AppLayout.tsx`.

**Interfaces:**

- Consumes: `listUnsynced`, `markSynced`, `markError`, `toMutationInput`; `useSDK()` (`sdk.execute(document, variables)`); the progress mutation document (import the same `graphql(...)` doc the reader already defines, or a shared one).
- Produces: `useProgressOutbox()` — on mount and on `window` `online` events, flush all unsynced rows (mark `SYNCING`, `sdk.execute`, `markSynced` on success / `markError` on failure). Serialize flushes with an in-flight guard.

- [ ] **Step 1:** Implement `useProgressOutbox`: a `useEffect` that defines `flush()` (guarded by a `useRef` boolean), calls it once on mount, and adds/removes an `online` listener. Replays via `sdk.execute(UPDATE_PROGRESS_DOC, toMutationInput(row))`. Use the existing mutation document — extract the `UpdateReadProgress` document to a shared `packages/browser/src/offline/progressMutation.ts` and import it in both readers and the flush hook (DRY).

- [ ] **Step 2:** In both readers' terminal `onError` (where `supersededByNewerUpdate` is false and retries are exhausted — `BookReaderScene.tsx:113-118`, `EpubJsReader.tsx` equivalent), call `enqueueProgress({ bookId, kind, ...position, elapsedSecondsDelta })` **before** the toast. Keep the toast (now "saved offline, will sync"). Add the two i18n keys.

- [ ] **Step 3:** Mount `useProgressOutbox()` in `AppLayout` (next to `useScrollRestoration()`).

- [ ] **Step 4: Verify** typecheck + `web build`. **Live-verify:** open a book, kill the server, turn pages until the retries exhaust → confirm an `progressOutbox` IndexedDB row exists (DevTools / `indexedDB` eval); restart the server → within the flush (toggle `online` or reload) the row clears and the server shows the progress. **Commit** (two: TS logic, then i18n if separated).

### Stream 1 gate

- `npx vitest run` for the outbox, typecheck, web build, live offline→online flush test.
- `superpowers:requesting-code-review` → merge.

---

# STREAM 2 — iOS splash + install polish

**Why:** The PWA audit (investigation §3) and the icon-pack handoff both flagged missing iOS launch screens. iOS does not scale a single splash; it needs one `apple-touch-startup-image` per device resolution/orientation. Today there are none (falls back to `background_color`). Maskable is already shipped.

**File structure:**

- Create `packages/browser/public/assets/splash/longbox-splash-<w>x<h>.png` — generated ink-tile splash per iOS device size.
- Modify `apps/web/src/index.html` — add the `apple-touch-startup-image` `<link>` set + `apple-mobile-web-app-status-bar-style`.
- (No manifest change; maskable already present.)

### Task 2.1: Generate splash assets

**Files:** Create `packages/browser/public/assets/splash/*.png`.

- [ ] **Step 1:** From the brand ink tile + centered mark (reuse the generator approach from the icon-pack commit `c1587c54`), render the current iOS launch sizes at both orientations. Minimum device set (portrait `WxH` @ device pixels): 1170×2532, 1284×2778, 1179×2556, 1290×2796, 1125×2436, 1242×2688, 828×1792, 1242×2208, 750×1334, 640×1136, 1620×2160, 1668×2388, 2048×2732 (and landscape swaps). Background `#211d18`, the line-mark centered at ~28% width in cream `#f3efe8`. Script it with `rsvg-convert -w W -h H` over a per-size SVG (ink rect + centered mark group), same math as the icon tiles.

- [ ] **Step 2:** Verify each PNG exists and is the exact pixel size (`file`/`identify`). Keep total added weight reasonable (these are ~10–40KB each, precached via the existing png glob — acceptable; note the count in the commit).

### Task 2.2: Wire the link tags + status bar

**Files:** Modify `apps/web/src/index.html`.

- [ ] **Step 1:** After the existing `apple-touch-icon` line, add `<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />` and one `<link rel="apple-touch-startup-image" media="(device-width:...px) and (device-height:...px) and (-webkit-device-pixel-ratio:...) and (orientation:portrait|landscape)" href="/assets/splash/longbox-splash-WxH.png" />` per generated asset. (Generate the tag block programmatically from the same size table to avoid transcription errors.)

- [ ] **Step 2: Verify** `web build`; boot and `curl -s / | grep apple-touch-startup-image | wc -l` matches the asset count. Live iOS simulator verification is optional/manual (note it as a manual follow-up — headless can't fully verify iOS splash). **Commit**: `feat(pwa): iOS launch screens (apple-touch-startup-image) + status-bar style`.

### Stream 2 gate

- Build clean, SW still evaluates (re-run the `node`-eval sw.js check from prior waves), tag count matches assets. Merge.

---

# STREAM 3 — Offline storage foundation

The core of the download subsystem. Ports the Expo `downloaded_files` + `download_queue` model to IndexedDB, and a Cache-API blob store keyed by real media URLs.

**File structure:**

- Modify `packages/browser/src/offline/db.ts` — bump `DB_VERSION` to 2, add stores: `downloads` (keyPath `bookId`), `downloadQueue` (keyPath `id`, autoIncrement, index `by-status`). Extend `LongboxOfflineDB`.
- Create `packages/browser/src/offline/downloadRecords.ts` — CRUD over `downloads`/`downloadQueue` (parity with `DownloadRepository`).
- Create `packages/browser/src/offline/blobStore.ts` — Cache API wrapper: `putUrl(url, response)`, `matchUrl(url): Promise<Response|undefined>`, `deleteBook(bookId, urls)`, `estimateUsage()`; a single named cache `longbox-offline-v1`.
- Create `packages/browser/src/offline/persist.ts` — `ensurePersisted(): Promise<boolean>` wrapping `navigator.storage.persist()`/`persisted()`, and `storageEstimate()`.
- Test `packages/browser/src/offline/__tests__/downloadRecords.test.ts` (fake-indexeddb).

**Key types (Produces):**

```ts
export type DownloadRecord = {
	bookId: string
	seriesId?: string
	title: string
	format: 'cbz' | 'cbr' | 'epub' | 'pdf'
	pageCount?: number          // comics
	fileUrl?: string            // epub/pdf: the /file URL cached
	pageUrls?: string[]         // comics: the /page URLs cached, in order
	thumbnailUrl?: string
	metadataJson?: unknown      // denormalized MediaMetadata for offline display
	sizeBytes: number
	downloadedAt: number
}
export type QueueStatus = 'pending' | 'downloading' | 'completed' | 'failed'
export type DownloadQueueItem = {
	id?: number
	bookId: string
	title: string
	format: DownloadRecord['format']
	status: QueueStatus
	receivedBytes: number
	totalBytes?: number
	failureReason?: string
	createdAt: number
}
```

**Tasks (each ends with tests + commit):**

- [ ] **3.1** DB v2 migration (add stores) + a migration test asserting v1 `progressOutbox` data survives the upgrade. Commit.
- [ ] **3.2** `downloadRecords.ts` CRUD (TDD: put/get/list/delete for both stores, `by-status` query, dedup rule "enqueue returns existing if already downloaded"). Commit.
- [ ] **3.3** `blobStore.ts` over Cache API (TDD with the Cache API — jsdom lacks it; use a thin injectable `CacheStorage` or test against `@vitest/web`/happy-dom with a Cache polyfill, or unit-test the URL/key logic and integration-test the rest live). Commit.
- [ ] **3.4** `persist.ts` (`ensurePersisted`, `storageEstimate`) — thin wrappers, tested by mocking `navigator.storage`. Commit.

### Stream 3 gate

- Vitest for records + persist; typecheck; build. Merge (foundation ships without UI — no user-facing change yet, which is fine).

---

# STREAM 4 — Download orchestration

**File structure:**

- Create `packages/browser/src/offline/downloadManager.ts` — a singleton, parity with the Expo `DownloadQueueManager`: `enqueue(book)`, `cancel(bookId)`, `retry(bookId)`, `remove(bookId)`, `subscribe(cb)`, concurrency cap (2). Per-format execution:
  - **comics**: resolve page count from the book, loop `1..N` fetching each `bookPageURL` via `sdk.axios.get(url, { responseType: 'blob' })` (carries auth in both modes), `blobStore.putUrl(url, new Response(blob))`, update `receivedBytes`/progress after each page; also cache the thumbnail.
  - **epub/pdf**: single `sdk.axios.get(downloadURL, { responseType: 'blob' })` → `blobStore.putUrl(fileUrl, ...)`.
  - On completion, write the `DownloadRecord` (with `pageUrls`/`fileUrl`, `sizeBytes` summed, denormalized metadata) and mark the queue item `completed`; on error mark `failed` with reason. Call `ensurePersisted()` once on first enqueue.
- Create `packages/browser/src/offline/useDownloads.ts` — reactive hooks: `useIsDownloaded(bookId)`, `useDownloadState(bookId)` (subscribes to the manager), `useDownloadsList()`.
- Create `packages/client/src/stores/download.ts` + re-export via `packages/browser/src/stores/index.ts` — a lightweight zustand store for the in-memory active-download progress map (durable state lives in IndexedDB; the store is just reactive progress, mirroring how Expo split live progress from the DB).
- Modify `packages/browser/src/scenes/book/BookActionMenu.tsx` — add a "Download for offline" / "Remove download" toggle button beside the existing direct download, wired to the manager + `useDownloadState`, showing progress.
- Create `packages/browser/src/scenes/downloads/DownloadsScene.tsx` + route (`/downloads`) + a sidebar entry — lists `DownloadRecord`s with size, a remove action, and links into the offline reader.

**Tasks:**

- [ ] **4.1** `downloadManager` core (enqueue/state machine/concurrency/subscribe) — unit-test the state transitions with a stubbed fetcher + in-memory blobStore. Commit.
- [ ] **4.2** Per-format execution (comics page loop; epub/pdf single file) — test with a stub `sdk.axios` returning fake blobs; assert `pageUrls` recorded and `blobStore` populated. Commit.
- [ ] **4.3** `useDownloads` hooks + download store. Commit.
- [ ] **4.4** BookActionMenu button (download/cancel/remove + progress) + i18n. Commit.
- [ ] **4.5** `/downloads` scene + route + sidebar entry. Commit.

### Stream 4 gate

- Vitest for manager; typecheck; build; **live**: download a real CBZ from the test library (offline share copy), watch progress complete, confirm a `downloads` record + Cache entries exist, remove it and confirm cleanup. Merge.

---

# STREAM 5 — Offline-aware readers

Make the three readers read from the store when a book is downloaded (and always, transparently, when offline).

**File structure:**

- Create `packages/browser/src/offline/resolveOfflineUrl.ts` — `offlineBlobUrl(url: string): Promise<string | null>` = `blobStore.matchUrl(url)` → `URL.createObjectURL(blob)` (cached per-url; revoke on unmount).
- Modify `packages/browser/src/components/entity/EntityImage.tsx` — before the network `<img>`/`AuthImage`, check `offlineBlobUrl(src)`; if present, render that blob URL. (This transparently makes the comic reader + thumbnail strip offline-capable.)
- Modify `packages/browser/src/components/readers/pdf/NativePDFViewer.tsx` — try `blobStore.matchUrl(downloadURL)` before the network `fetch`.
- Modify `packages/browser/src/components/readers/epub/EpubJsReader.tsx` — if downloaded, pass the cached blob's `ArrayBuffer` to `new Book(arrayBuffer, { openAs: 'epub' })` instead of the URL (epubjs accepts an ArrayBuffer).
- Create `packages/browser/src/scenes/book/reader/OfflineBookReaderScene.tsx` (or fold into existing) — an entry that builds the reader's expected book object from the `DownloadRecord` when the server is unreachable, so a downloaded book is readable with no network (parity with Expo's `offline/[fileId]/read.tsx`, which synthesized the GraphQL-shaped object from local rows).

**Tasks:**

- [ ] **5.1** `resolveOfflineUrl` (TDD the caching/revocation logic). Commit.
- [ ] **5.2** EntityImage offline path — comic pages + thumbnails read from cache when present. Live-verify a downloaded comic reads with the server stopped. Commit.
- [ ] **5.3** PDF + EPUB offline paths. Live-verify. Commit.
- [ ] **5.4** Offline reader entry that synthesizes the book object from the `DownloadRecord` (so `/downloads` → read works fully offline, including progress writes going to the Stream 1 outbox). Live-verify end-to-end offline. Commit.

### Stream 5 gate

- Full offline reading verified with the server stopped (comic, epub, pdf); progress made offline flushes on reconnect (Stream 1). Merge.

---

## Self-review

- **Spec coverage:** IndexedDB catalog (Streams 1, 3), Cache API blob store (Stream 3), `navigator.storage.persist` (Stream 3.4), progress outbox with reconnect flush (Stream 1), iOS splash/maskable (Stream 2 — maskable already shipped in the icon pack) — all mapped to tasks.
- **Auth-mode correctness:** downloads fetch via `sdk.axios` (carries cookie or bearer), storing opaque blobs — works in both session and token mode, unlike a naive SW cache-first which the token-mode `AuthImage` (axios+blob) would bypass. This is the reason for the app-layer design over SW runtime caching (recorded in the architecture note).
- **Parity with Expo:** `DownloadRecord`≈`downloaded_files`, `DownloadQueueItem`≈`download_queue` (`pending/downloading/completed/failed` + `failureReason` + concurrency 2), `ProgressOutboxRecord`≈`read_progress` (`UNSYNCED/SYNCING/ERROR` + `elapsedSecondsDelta`/accumulation), reuse of `updateMediaProgress` for replay — matches the teardown.
- **Type consistency:** `bookId` (string) is the key everywhere; `elapsedSecondsDelta` is additive and accumulates on re-enqueue; `format` enum is shared between `DownloadRecord` and `DownloadQueueItem`.
- **Deferred (not in this plan):** OPDS offline downloads, bookmarks/annotations offline sync (Expo had these; out of scope until the core lands), and true SW background-sync (app-layer `online`-flush is used instead — more portable than the Chrome-only Background Sync API).
