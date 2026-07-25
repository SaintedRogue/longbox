# Intentional Offline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make "the server is unreachable and I want to keep reading" a guarantee you can see and control, instead of a lottery decided by an LRU that favours cover art over comic pages.

**Architecture:** Replace the indiscriminate passive read-through cache with a small declarative **intent** layer. Intents ("I'm reading this book", "keep this series ready") are stored in IndexedDB; a **reconciler** turns intents + reading progress into a desired set of books and diffs it against what is actually downloaded, driving the _existing_ download manager. Eviction only ever touches auto-kept content — explicitly downloaded books are never auto-released. Covers stop being cached by the app entirely and fall back to the browser HTTP cache, which now has correct ETag + `stale-while-revalidate` semantics.

**Tech Stack:** TypeScript, React 19 (react-compiler enabled), `idb` (IndexedDB), CacheStorage, zustand, `@tanstack/react-query`, gql.tada. Jest + Testing Library. **No Rust changes** — `readProgress`, `MediaFilterInput.readingStatus`, and the download pipeline all already exist.

## Global Constraints

- `yarn` is NOT on PATH. Use `npx -y yarn@1.22.21 ...`.
- `babel-plugin-react-compiler` is on and enforced by eslint. No conditional hooks, no mutating props/state, no reading refs during render.
- User-facing strings go through `packages/i18n` (`useLocaleContext` / `t(...)`); add keys to `packages/i18n/src/locales/en-US.json` only (en-US is the i18next fallback).
- **Explicit downloads are never auto-evicted.** This is the single hardest invariant in this plan.
- CacheStorage and IndexedDB are separate transactional domains — no write spanning both is atomic. Any new bookkeeping must be reconcilable after a crash, not assumed consistent.
- Adding an object store REQUIRES bumping `DB_VERSION` in `packages/browser/src/offline/db.ts` (currently `3` → `4`). Adding an optional _field_ to an existing record type does not.
- Decisions already made by the product owner, do not re-litigate:
  - Auto-keep scope: **whole book, in background**, on open.
  - Series rule: **opt-in per series**, default OFF everywhere, `keepAhead` default `2`.
  - Budget: **hard cap with automatic eviction**, default `5 GB`, priority order defined in Task 5.

---

## File Structure

**New:**

- `packages/browser/src/offline/offlineIntent.ts` — intent CRUD over IDB (data layer only)
- `packages/browser/src/offline/reconciler.ts` — desired-set computation + diff + enqueue/release
- `packages/browser/src/offline/budget.ts` — usage accounting + eviction ordering
- `packages/browser/src/offline/useOfflineIntent.ts` — React bindings for intents/availability
- `packages/browser/src/components/offline/OfflineBadge.tsx` — availability indicator
- `packages/browser/src/scenes/settings/app/offline/OfflineSettingsScene.tsx` — cap, usage, manage

**Modified:**

- `packages/browser/src/offline/db.ts` — `DB_VERSION` 3→4; add `offlineIntents` store; add `origin` to `DownloadRecord`
- `packages/browser/src/offline/downloadManager.ts` — thread `origin` through `DownloadJob`
- `packages/browser/src/offline/downloadRecords.ts` — persist/query by `origin`
- `packages/browser/src/scenes/book/reader/BookReaderScene.tsx` — declare a reading intent on open
- `packages/browser/src/scenes/series/tabs/settings/SeriesSettingsScene.tsx` — per-series toggle
- `packages/browser/src/components/thumbnail/ThumbnailImage.tsx`, `components/entity/EntityImage.tsx` — stop writing covers to the blob store (Task 9)
- `packages/browser/src/offline/resolveOfflineUrl.ts` — resolve only downloaded content (Task 9)

**Deleted in Task 9 (only after Tasks 1-8 are green):**

- `passiveCache.ts`, `passiveCacheRecords.ts`, `cacheOnViewOnce.ts`, `usePassiveCache.ts` and their tests

---

### Task 1: Download provenance

Everything downstream depends on being able to tell an auto-kept book from one the user explicitly asked for. Do this first and alone.

**Files:**

- Modify: `packages/browser/src/offline/db.ts`
- Modify: `packages/browser/src/offline/downloadRecords.ts`
- Modify: `packages/browser/src/offline/downloadManager.ts`
- Test: `packages/browser/src/offline/__tests__/downloadRecords.test.ts`

**Interfaces:**

- Consumes: nothing
- Produces:
  - `type DownloadOrigin = 'explicit' | 'auto'`
  - `DownloadRecord.origin?: DownloadOrigin` — **optional**; absent means `'explicit'`
  - `DownloadJob.origin?: DownloadOrigin`
  - `listDownloadRecordsByOrigin(origin: DownloadOrigin): Promise<DownloadRecord[]>`

- [ ] **Step 1: Write the failing test**

```ts
// packages/browser/src/offline/__tests__/downloadRecords.test.ts
it('treats a record with no origin as explicit, so pre-existing downloads are never auto-evicted', async () => {
  await putDownloadRecord({ bookId: 'legacy', title: 'Legacy', format: 'comic', sizeBytes: 1, downloadedAt: 1 })
  expect(await listDownloadRecordsByOrigin('explicit')).toHaveLength(1)
  expect(await listDownloadRecordsByOrigin('auto')).toHaveLength(0)
})

it('round-trips an explicit origin', async () => {
  await putDownloadRecord({ bookId: 'a', title: 'A', format: 'comic', sizeBytes: 1, downloadedAt: 1, origin: 'auto' })
  expect((await listDownloadRecordsByOrigin('auto')).map(r => r.bookId)).toEqual(['a'])
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx -y yarn@1.22.21 workspace @longbox/browser test downloadRecords`
Expected: FAIL — `listDownloadRecordsByOrigin is not a function`

- [ ] **Step 3: Implement**

In `db.ts` add to the `DownloadRecord` type:

```ts
/** Why this book is stored. Absent on records written before intentional-offline shipped;
 *  those are treated as 'explicit' so a legacy download is never auto-evicted. */
export type DownloadOrigin = 'explicit' | 'auto'
```

and `origin?: DownloadOrigin` as a field. No `DB_VERSION` bump — this is a new optional field on an existing store.

In `downloadRecords.ts`:

```ts
export async function listDownloadRecordsByOrigin(
	origin: DownloadOrigin,
): Promise<DownloadRecord[]> {
	const all = await listDownloadRecords()
	return all.filter((rec) => (rec.origin ?? 'explicit') === origin)
}
```

In `downloadManager.ts` add `origin?: DownloadOrigin` to `DownloadJob` and persist it when the record is written (find where `putDownloadRecord` is called on completion and pass `origin: job.origin ?? 'explicit'`).

- [ ] **Step 4: Run tests**

Run: `npx -y yarn@1.22.21 workspace @longbox/browser test downloadRecords`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/browser/src/offline/db.ts packages/browser/src/offline/downloadRecords.ts \
        packages/browser/src/offline/downloadManager.ts \
        packages/browser/src/offline/__tests__/downloadRecords.test.ts
git commit -m "feat(offline): record why a book is stored (explicit vs auto)"
```

---

### Task 2: Intent store

**Files:**

- Create: `packages/browser/src/offline/offlineIntent.ts`
- Modify: `packages/browser/src/offline/db.ts` (**DB_VERSION 3 → 4**, new store)
- Test: `packages/browser/src/offline/__tests__/offlineIntent.test.ts`

**Interfaces:**

- Consumes: Task 1's `DownloadOrigin`
- Produces:
  - `type OfflineIntent = { key: string; kind: 'reading' | 'series'; ref: string; keepAhead?: number; createdAt: number }`
  - `putIntent(i: OfflineIntent): Promise<void>`
  - `deleteIntent(key: string): Promise<void>`
  - `listIntents(): Promise<OfflineIntent[]>`
  - `getIntent(key: string): Promise<OfflineIntent | undefined>`
  - `intentKey(kind, ref): string` — `` `${kind}:${ref}` ``

- [ ] **Step 1: Write the failing test**

```ts
it('keys intents by kind and ref so a book and a series cannot collide', async () => {
  await putIntent({ key: intentKey('reading', 'x'), kind: 'reading', ref: 'x', createdAt: 1 })
  await putIntent({ key: intentKey('series', 'x'), kind: 'series', ref: 'x', keepAhead: 2, createdAt: 1 })
  expect(await listIntents()).toHaveLength(2)
})

it('is idempotent per key', async () => {
  const i = { key: intentKey('reading', 'x'), kind: 'reading' as const, ref: 'x', createdAt: 1 }
  await putIntent(i); await putIntent({ ...i, createdAt: 2 })
  expect(await listIntents()).toHaveLength(1)
})
```

- [ ] **Step 2: Run it and watch it fail** — `npx -y yarn@1.22.21 workspace @longbox/browser test offlineIntent`

- [ ] **Step 3: Implement.** In `db.ts` bump `DB_VERSION` to `4` and, inside the existing `upgrade()` block, add (following the existing guarded-create pattern so re-running is safe):

```ts
if (!db.objectStoreNames.contains('offlineIntents')) {
	db.createObjectStore('offlineIntents', { keyPath: 'key' })
}
```

Then write `offlineIntent.ts` with the CRUD above — thin wrappers over `getDB()`, matching the style of `downloadRecords.ts`.

- [ ] **Step 4: Run tests** — Expected: PASS. **Also re-run the full offline suite**: an incorrect `upgrade()` breaks every other store.

Run: `npx -y yarn@1.22.21 workspace @longbox/browser test offline`

- [ ] **Step 5: Commit**

```bash
git add packages/browser/src/offline/db.ts packages/browser/src/offline/offlineIntent.ts \
        packages/browser/src/offline/__tests__/offlineIntent.test.ts
git commit -m "feat(offline): add offline intent store"
```

---

### Task 3: Reconciler — desired set

Pure computation, no I/O. Keep it that way; it is the piece most worth testing.

**Files:**

- Create: `packages/browser/src/offline/reconciler.ts`
- Test: `packages/browser/src/offline/__tests__/reconciler.test.ts`

**Interfaces:**

- Consumes: `OfflineIntent` (Task 2), `DownloadRecord` (Task 1)
- Produces:
  - `type DesiredBook = { bookId: string; reason: 'reading' | 'series'; priority: number }`
  - `computeDesiredSet(input: { intents: OfflineIntent[]; readingBooks: { bookId: string; seriesId?: string; finished: boolean }[]; seriesUnread: Record<string, string[]> }): DesiredBook[]`
  - `diffDesired(desired: DesiredBook[], records: DownloadRecord[]): { toFetch: string[]; toRelease: string[] }`

`priority` is lower = keep harder. Reading intents get `0`; series issues get `1 + indexInKeepAhead`.

- [ ] **Step 1: Write the failing test**

```ts
it('drops a reading intent once the book is finished', () => {
  const desired = computeDesiredSet({
    intents: [{ key: 'reading:b1', kind: 'reading', ref: 'b1', createdAt: 1 }],
    readingBooks: [{ bookId: 'b1', finished: true }],
    seriesUnread: {},
  })
  expect(desired).toEqual([])
})

it('keeps only keepAhead unread issues, in order', () => {
  const desired = computeDesiredSet({
    intents: [{ key: 'series:s1', kind: 'series', ref: 's1', keepAhead: 2, createdAt: 1 }],
    readingBooks: [],
    seriesUnread: { s1: ['i1', 'i2', 'i3', 'i4'] },
  })
  expect(desired.map(d => d.bookId)).toEqual(['i1', 'i2'])
})

it('never proposes releasing an explicit download', () => {
  const { toRelease } = diffDesired([], [
    { bookId: 'keepme', title: 'K', format: 'comic', sizeBytes: 1, downloadedAt: 1, origin: 'explicit' },
    { bookId: 'dropme', title: 'D', format: 'comic', sizeBytes: 1, downloadedAt: 1, origin: 'auto' },
  ])
  expect(toRelease).toEqual(['dropme'])
})
```

- [ ] **Step 2: Run and watch fail** — `npx -y yarn@1.22.21 workspace @longbox/browser test reconciler`

- [ ] **Step 3: Implement** `computeDesiredSet` (reading intents where `!finished`, then `seriesUnread[ref].slice(0, keepAhead ?? 2)`) and `diffDesired` (`toFetch` = desired minus records; `toRelease` = auto-origin records not in desired — explicit records are filtered out before the diff, never after).

- [ ] **Step 4: Run tests** — Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/browser/src/offline/reconciler.ts packages/browser/src/offline/__tests__/reconciler.test.ts
git commit -m "feat(offline): compute the desired offline set from intents"
```

---

### Task 4: Reconciler — wiring to the download manager

**Files:**

- Modify: `packages/browser/src/offline/reconciler.ts`
- Test: `packages/browser/src/offline/__tests__/reconciler.test.ts`

**Interfaces:**

- Consumes: `enqueue`, `remove` from `downloadManager.ts`; `listDownloadRecords` from `downloadRecords.ts`
- Produces: `reconcile(deps: ReconcileDeps): Promise<{ fetched: string[]; released: string[] }>` where `ReconcileDeps` injects `{ fetchBookMeta, listSeriesUnread, enqueue, remove, listRecords, listIntents }` so it is testable without a network or a DB.

- [ ] **Step 1: Write the failing test**

```ts
it('enqueues missing books with origin auto and releases stale auto ones', async () => {
  const enqueue = jest.fn().mockResolvedValue({ status: 'enqueued' })
  const remove = jest.fn().mockResolvedValue(undefined)
  const result = await reconcile({
    listIntents: async () => [{ key: 'reading:b1', kind: 'reading', ref: 'b1', createdAt: 1 }],
    listRecords: async () => [{ bookId: 'old', title: 'O', format: 'comic', sizeBytes: 1, downloadedAt: 1, origin: 'auto' }],
    fetchBookMeta: async () => ({ bookId: 'b1', title: 'B1', format: 'comic', pageCount: 10, finished: false }),
    listSeriesUnread: async () => [],
    enqueue, remove,
  })
  expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({ bookId: 'b1', origin: 'auto' }))
  expect(remove).toHaveBeenCalledWith('old')
  expect(result).toEqual({ fetched: ['b1'], released: ['old'] })
})

it('is safe to run concurrently — a second call while one is in flight is a no-op', async () => {
  // assert the second invocation resolves without issuing duplicate enqueues
})
```

- [ ] **Step 2: Run and watch fail**

- [ ] **Step 3: Implement.** Guard with a module-level in-flight promise so overlapping triggers coalesce (mirror the `inFlightWrites` pattern already in `passiveCache.ts`). Never throw out of `reconcile` — log and return.

- [ ] **Step 4: Run tests** — Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/browser/src/offline/reconciler.ts packages/browser/src/offline/__tests__/reconciler.test.ts
git commit -m "feat(offline): drive the download manager from the desired set"
```

---

### Task 5: Budget and eviction

**Files:**

- Create: `packages/browser/src/offline/budget.ts`
- Test: `packages/browser/src/offline/__tests__/budget.test.ts`

**Interfaces:**

- Produces:
  - `DEFAULT_OFFLINE_CAP_BYTES = 5 * 1024 ** 3`
  - `computeUsage(records: DownloadRecord[]): { totalBytes: number; explicitBytes: number; autoBytes: number }`
  - `selectForEviction(records: DownloadRecord[], desired: DesiredBook[], capBytes: number, finishedBookIds: Set<string>): string[]`

Eviction order, confirmed by the product owner:

1. finished auto-kept books
2. auto-kept books furthest from the reading position (highest `priority` from Task 3)
3. followed-series issues beyond `keepAhead`
4. **never** `origin === 'explicit'`

- [ ] **Step 1: Write the failing test**

```ts
it('evicts finished auto books before unfinished ones', () => {
  const out = selectForEviction(
    [
      { bookId: 'fin', origin: 'auto', sizeBytes: 100, title: 'F', format: 'comic', downloadedAt: 1 },
      { bookId: 'cur', origin: 'auto', sizeBytes: 100, title: 'C', format: 'comic', downloadedAt: 1 },
    ],
    [{ bookId: 'cur', reason: 'reading', priority: 0 }],
    150, new Set(['fin']),
  )
  expect(out).toEqual(['fin'])
})

it('never evicts an explicit download even when that leaves us over cap', () => {
  const out = selectForEviction(
    [{ bookId: 'mine', origin: 'explicit', sizeBytes: 10_000, title: 'M', format: 'comic', downloadedAt: 1 }],
    [], 10, new Set(),
  )
  expect(out).toEqual([])
})
```

- [ ] **Step 2: Run and watch fail**

- [ ] **Step 3: Implement.** Sort auto records by `(finished desc, priority desc, downloadedAt asc)` and take until projected usage ≤ cap. Explicit records are excluded from the candidate list before sorting, and still counted in usage.

- [ ] **Step 4: Run tests** — Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/browser/src/offline/budget.ts packages/browser/src/offline/__tests__/budget.test.ts
git commit -m "feat(offline): enforce a hard offline budget with priority eviction"
```

---

### Task 6: Declare a reading intent on open

**Files:**

- Create: `packages/browser/src/offline/useOfflineIntent.ts`
- Modify: `packages/browser/src/scenes/book/reader/BookReaderScene.tsx`
- Test: `packages/browser/src/offline/__tests__/useOfflineIntent.test.tsx`

**Interfaces:**

- Produces: `useDeclareReadingIntent(bookId: string | undefined): void` and `useOfflineAvailability(bookId: string): { state: 'absent' | 'partial' | 'ready'; receivedBytes?: number; totalBytes?: number }`

- [ ] **Step 1: Write the failing test** — opening the reader writes a `reading:<id>` intent exactly once and triggers one reconcile; unmounting does not delete the intent (you may return to the book).

- [ ] **Step 2: Run and watch fail**

- [ ] **Step 3: Implement.** `useEffect` on `bookId`, `void putIntent(...)` then `void reconcile(...)`. Fire-and-forget — this must never block the reader from rendering, and must never throw into render.

- [ ] **Step 4: Run tests** — Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/browser/src/offline/useOfflineIntent.ts \
        packages/browser/src/scenes/book/reader/BookReaderScene.tsx \
        packages/browser/src/offline/__tests__/useOfflineIntent.test.tsx
git commit -m "feat(offline): keep the book you are reading available offline"
```

---

### Task 7: Series follow toggle

**Files:**

- Modify: `packages/browser/src/scenes/series/tabs/settings/SeriesSettingsScene.tsx`
- Modify: `packages/i18n/src/locales/en-US.json`
- Test: `packages/browser/src/scenes/series/tabs/settings/__tests__/SeriesSettingsScene.test.tsx`

Uses `MediaFilterInput.readingStatus` to resolve next-unread — no backend change. Default OFF; `keepAhead` default `2`, exposed as a number input.

- [ ] **Step 1: Write the failing test** — toggling on writes a `series:<id>` intent with `keepAhead`; toggling off deletes it and releases auto-kept issues of that series (never explicit ones).
- [ ] **Step 2: Run and watch fail**
- [ ] **Step 3: Implement** the toggle + `keepAhead` input, i18n keys under `seriesSettings.offline.*`, `aria-label` on both controls.
- [ ] **Step 4: Run tests**
- [ ] **Step 5: Commit** `feat(offline): opt a series into keeping unread issues offline`

---

### Task 8: Visibility — badge and settings

**Files:**

- Create: `packages/browser/src/components/offline/OfflineBadge.tsx`
- Create: `packages/browser/src/scenes/settings/app/offline/OfflineSettingsScene.tsx`
- Modify: `packages/browser/src/components/book/BookCard.tsx` (render the badge)
- Modify: `packages/i18n/src/locales/en-US.json`
- Test: `packages/browser/src/components/offline/__tests__/OfflineBadge.test.tsx`

Settings scene shows: cap (editable, default 5 GB), used vs available, a per-book list with origin and size, and a manual release action. This is the answer to "what can I read on the plane".

- [ ] **Step 1: Write the failing test** — badge renders `ready` / `partial (n/m)` / nothing for absent; has an accessible name.
- [ ] **Step 2: Run and watch fail**
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run tests**
- [ ] **Step 5: Commit** `feat(offline): show what is available offline and let it be managed`

---

### Task 9: Retire the passive read-through cache

**Do not start until Tasks 1-8 are merged and verified in a browser.** This removes the current safety net; the replacement must demonstrably work first.

**Files:**

- Modify: `packages/browser/src/components/thumbnail/ThumbnailImage.tsx`, `components/entity/EntityImage.tsx`, `components/entity/AuthImage.tsx` — drop `cacheOnViewOnce` / `cacheAlreadyFetched` calls
- Modify: `packages/browser/src/offline/resolveOfflineUrl.ts` — resolve only against downloaded content
- Modify: `packages/browser/src/hooks/usePreloadPage.ts` — keep reading from the blob store, stop writing passive entries
- Delete: `passiveCache.ts`, `passiveCacheRecords.ts`, `cacheOnViewOnce.ts`, `usePassiveCache.ts` + their tests
- Modify: `packages/browser/src/offline/db.ts` — DB_VERSION 4→5, drop `passiveCacheEntries` / `passiveCacheMeta`

Covers now come from the browser HTTP cache (`max-age=600, stale-while-revalidate=604800` + ETag, shipped 2026-07-25). A cover missing offline is cosmetic — `ThumbnailPlaceholder` already handles it.

- [ ] **Step 1: Write the failing test** — a cover load writes nothing to CacheStorage; a downloaded book's pages still resolve offline.
- [ ] **Step 2: Run and watch fail**
- [ ] **Step 3: Implement**, including an `upgrade()` migration that deletes the two retired stores. Delete their blobs from CacheStorage too, or they leak permanently — but **only** blobs not referenced by any `DownloadRecord`.
- [ ] **Step 4: Run the full suite** — `npx -y yarn@1.22.21 workspace @longbox/browser test`
- [ ] **Step 5: Commit** `refactor(offline): retire the passive read-through cache`

---

## Verification before merge

- `npx -y yarn@1.22.21 lint` and `... test` clean
- Browser check with the network throttled to offline: open a book, let it keep, kill the server, confirm you can still read it; confirm an explicitly downloaded book survives an eviction pass that drops auto content.
- Confirm the DB upgrade path works from a **v3** database (the shipped version), not just a fresh one.

## Open question for the product owner

Auto-keep fires on _open_. A 1.5 GB compendium opened by accident starts a large background fetch. Options: start after N seconds or N pages read; or cap auto-keep per book and fall back to a window for very large books. Recommend deferring until real usage shows whether it is a problem.
