# Loose-File Organizer (Frontend) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A web UI for the loose-file organizer — a per-library "auto-organize on scan" toggle plus a manual scan→review→apply dialog — built on the existing library-settings + `ProviderMatchDialog` patterns.

**Architecture:** A new `Settings → Organizer` sub-tab (mirrors `scanner`/`thumbnails`) holds the `autoOrganizeLooseFiles` toggle + an "Organize loose files" action that opens `OrganizeLooseFilesDialog`. The dialog fires `planOrganizeLooseFiles` (a backend job), the existing job-event subscription invalidates the `organizePreview` query on completion, and the dialog renders proposed moves (include/exclude) → `applyOrganizeLooseFiles`.

**Tech Stack:** React 19, Vite, Tailwind 4, React Router 6, `@tanstack/react-query`, gql.tada codegen, `@longbox/{components,client,graphql,i18n}`, jest + RTL.

**Spec:** `docs/superpowers/specs/2026-07-20-loose-file-organizer-frontend-design.md`. **Depends on** the backend GraphQL surface on this same branch (`feat/loose-file-organizer`).

## Global Constraints

- **Codegen:** any new/changed `graphql(...)` document requires re-running `yarn workspace @longbox/graphql codegen` and committing the regenerated `packages/graphql/src/client/*`. `yarn` is at `~/.npm-global/bin/yarn` (not on the default PATH — `export PATH="$HOME/.npm-global/bin:$PATH"`).
- **Gates:** `yarn lint` (eslint + prettier + tsc check-types across 5 projects) and `yarn test` (jest) must pass. Prettier via the pre-commit hook enforces formatting on staged TS.
- **react-compiler is ON** (enforced by eslint-plugin-react-compiler): follow Rules of React — no conditional hooks, no mutating props/state; use `useState` for state that drives render (a past bug used `useRef` where `useState` was needed).
- **Settings toggles save-on-click** via `patch({ config })` — no submit button.
- **i18n:** every `t(key)` must have a matching entry in `@longbox/i18n` or it renders the raw key. Add keys in the same task that references them.
- Do NOT touch the backend Rust or the workspace manifest. This is frontend-only.

## File Structure

**Create:**

- `packages/browser/src/scenes/library/tabs/settings/options/organizer/OrganizerScene.tsx`
- `.../options/organizer/OrganizerFeaturesPatchForm.tsx`
- `.../options/organizer/OrganizerActionsSection.tsx`
- `.../options/organizer/OrganizeLooseFilesDialog.tsx`
- `.../options/organizer/index.ts`
- `.../options/organizer/__tests__/toDecisions.test.ts` (unit test for the decision mapping)

**Modify:**

- `packages/browser/src/scenes/library/tabs/settings/LibrarySettingsRouter.tsx` (fragment + lazy route)
- `packages/browser/src/components/library/createOrUpdate/schema.ts` (schema + formDefaults)
- `packages/browser/src/scenes/library/tabs/settings/routes.ts` (sidebar entry)
- `packages/browser/src/hooks/useCoreEvent.ts` (job-output invalidation)
- `packages/sdk/src/constants.ts` (`organizePreview` cache key)
- `@longbox/i18n` locale file(s) (new strings)
- `packages/graphql/src/client/*` (regenerated — do not hand-edit)

---

### Task F1: Plumb `autoOrganizeLooseFiles` through the config types

**Files:**

- Modify: `packages/browser/src/scenes/library/tabs/settings/LibrarySettingsRouter.tsx`
- Modify: `packages/browser/src/components/library/createOrUpdate/schema.ts`
- Regenerate: `packages/graphql/src/client/*`

**Interfaces:**

- Produces: `library.config.autoOrganizeLooseFiles` (via the fragment) and the `autoOrganizeLooseFiles` form field + default. Consumed by Task F2.

- [ ] **Step 1: Add the field to the `LibrarySettingsConfig` fragment**

In `LibrarySettingsRouter.tsx`, inside the `fragment LibrarySettingsConfig on Library { config { ... } }` selection, add `autoOrganizeLooseFiles` next to `writeComicinfo`/`watch`:

```graphql
			writeComicinfo
			watch
			autoOrganizeLooseFiles
```

- [ ] **Step 2: Add to the zod schema + form defaults**

In `packages/browser/src/components/library/createOrUpdate/schema.ts`, in the `buildSchema(...)` object, add right after `writeComicinfo: z.boolean().default(false),`:

```ts
		autoOrganizeLooseFiles: z.boolean().default(false),
```

And in `formDefaults(...)`, right after `writeComicinfo: library?.config.writeComicinfo ?? false,`:

```ts
	autoOrganizeLooseFiles: library?.config.autoOrganizeLooseFiles ?? false,
```

- [ ] **Step 3: Regenerate the GraphQL client**

```bash
export PATH="$HOME/.npm-global/bin:$PATH"
yarn workspace @longbox/graphql codegen
```

This regenerates `LibrarySettingsConfigFragment` (and `CreateOrUpdateLibraryInput.config`) so `library.config.autoOrganizeLooseFiles` type-checks. (The server schema already has the field.)

- [ ] **Step 4: Verify types**

```bash
export PATH="$HOME/.npm-global/bin:$PATH"
yarn workspace @longbox/browser check-types
```

Expected: passes (no `autoOrganizeLooseFiles` type errors).

- [ ] **Step 5: Commit**

```bash
export PATH="$HOME/.npm-global/bin:$PATH"
git add packages/browser/src/scenes/library/tabs/settings/LibrarySettingsRouter.tsx \
        packages/browser/src/components/library/createOrUpdate/schema.ts \
        packages/graphql
git commit -m "feat(organizer-ui): plumb autoOrganizeLooseFiles through library config types"
```

(Trailer as in the backend commits.)

---

### Task F2: `Settings → Organizer` tab + auto-organize toggle

**Files:**

- Create: `.../options/organizer/OrganizerFeaturesPatchForm.tsx`, `OrganizerScene.tsx`, `index.ts`
- Modify: `.../settings/routes.ts`, `.../settings/LibrarySettingsRouter.tsx`
- Modify: `@longbox/i18n` locale file

**Interfaces:**

- Consumes F1's config field/schema.
- Produces: a working `/library/:id/settings/organize` tab with the toggle. The actions section (button + dialog) is added in Task F3.

- [ ] **Step 1: The toggle form**

Create `.../options/organizer/OrganizerFeaturesPatchForm.tsx` (mirrors `ScannerFeaturesPatchForm.tsx` but for the single field; saves on click):

```tsx
import { zodResolver } from '@hookform/resolvers/zod'
import { CheckBox, Form } from '@longbox/components'
import { useLocaleContext } from '@longbox/i18n'
import { useCallback, useMemo } from 'react'
import { useForm, useWatch } from 'react-hook-form'

import { buildSchema, CreateOrUpdateLibrarySchema, formDefaults } from '@/components/library/createOrUpdate'

import { useLibraryManagement } from '../../context'

export default function OrganizerFeaturesPatchForm() {
	const { t } = useLocaleContext()
	const { library, patch } = useLibraryManagement()

	const schema = useMemo(() => buildSchema([], library), [library])
	const form = useForm<CreateOrUpdateLibrarySchema>({
		defaultValues: formDefaults(library),
		reValidateMode: 'onChange',
		resolver: zodResolver(schema),
	})

	const autoOrganizeLooseFiles = useWatch({ control: form.control, name: 'autoOrganizeLooseFiles' })

	const handleToggle = useCallback(() => {
		const next = !autoOrganizeLooseFiles
		form.setValue('autoOrganizeLooseFiles', next)
		patch({ config: { autoOrganizeLooseFiles: next }, scanAfterPersist: false })
	}, [autoOrganizeLooseFiles, form, patch])

	return (
		<Form form={form} onSubmit={() => {}} fieldsetClassName="space-y-12">
			<CheckBox
				id="autoOrganizeLooseFiles"
				label={t(getKey('autoOrganizeLooseFiles.label'))}
				description={t(getKey('autoOrganizeLooseFiles.description'))}
				checked={autoOrganizeLooseFiles}
				onClick={handleToggle}
				{...form.register('autoOrganizeLooseFiles')}
			/>
		</Form>
	)
}

const LOCALE_KEY = 'librarySettingsScene.options/organize.sections.features'
const getKey = (key: string) => `${LOCALE_KEY}.${key}`
```

- [ ] **Step 2: The scene + barrel**

Create `.../options/organizer/OrganizerScene.tsx`:

```tsx
import OrganizerActionsSection from './OrganizerActionsSection'
import OrganizerFeaturesPatchForm from './OrganizerFeaturesPatchForm'

export default function OrganizerScene() {
	return (
		<div className="gap-12 flex flex-col">
			<OrganizerActionsSection />
			<OrganizerFeaturesPatchForm />
		</div>
	)
}
```

Create `.../options/organizer/index.ts`:

```ts
export { default } from './OrganizerScene'
```

Note: `OrganizerActionsSection` is created in Task F3. For F2 to compile/type-check standalone, create a minimal placeholder now and flesh it out in F3:

```tsx
// OrganizerActionsSection.tsx (placeholder — completed in Task F3)
export default function OrganizerActionsSection() {
	return null
}
```

- [ ] **Step 3: Register the route + sidebar entry**

In `.../settings/routes.ts`, add a sibling to the Scanning/Thumbnails items in the `Configuration` group's `items` array (import the icon, e.g. `FolderTree` from `lucide-react`, at the top):

```ts
		{
			icon: FolderTree,
			label: 'Organize',
			localeKey: 'options/organize',
			permissions: [UserPermission.ManageLibrary],
			to: 'settings/organize',
		},
```

In `LibrarySettingsRouter.tsx`, add the lazy import near the other `options/*` lazies:

```tsx
const LibraryOrganizeScene = lazy(() => import('./options/organizer'))
```

and the route inside `<Routes>` (next to `thumbnails`/`scanning`):

```tsx
				<Route path="organize" element={<LibraryOrganizeScene />} />
```

- [ ] **Step 4: i18n strings**

Add to the app's locale file (find where `librarySettingsScene.options/scanning` keys live in `@longbox/i18n` — likely `packages/i18n/src/locales/en/*.json` or a TS locale module; mirror the sibling `options/scanning`/`options/thumbnails` structure). Add:

- `librarySettingsScene.options/organize` — the sidebar `localeKey` label (mirror how `options/scanning`'s label is resolved).
- `librarySettingsScene.options/organize.sections.features.autoOrganizeLooseFiles.label` = "Auto-organize loose files on scan"
- `...features.autoOrganizeLooseFiles.description` = "After each scan, automatically move loose files that confidently match a known series into their own folder. Uncertain files are left in place."

Read an existing `options/scanning` locale block first and match its exact nesting/format.

- [ ] **Step 5: Verify**

```bash
export PATH="$HOME/.npm-global/bin:$PATH"
yarn workspace @longbox/browser check-types
yarn lint
```

Expected: pass. Manually confirm (if running the app) the new "Organize" tab appears under a library's settings and the toggle flips + persists — otherwise rely on Task F5's live check.

- [ ] **Step 6: Commit**

```bash
git add packages/browser packages/i18n
git commit -m "feat(organizer-ui): add Organizer settings tab with auto-organize toggle"
```

---

### Task F3: `OrganizeLooseFilesDialog` + actions section + decision mapping

**Files:**

- Create: `.../options/organizer/OrganizeLooseFilesDialog.tsx`
- Create: `.../options/organizer/__tests__/toDecisions.test.ts`
- Modify: `.../options/organizer/OrganizerActionsSection.tsx` (replace the placeholder)
- Regenerate: `packages/graphql/src/client/*`
- Modify: `@longbox/i18n`

**Interfaces:**

- Consumes: F4's `organizePreview` invalidation + cache key (do F4 before F3), F1's types.
- Produces: the manual scan→review→apply UI.

- [ ] **Step 1: The dialog + decision mapping**

Create `.../options/organizer/OrganizeLooseFilesDialog.tsx`:

```tsx
import { useGraphQL, useGraphQLMutation, useSDK } from '@longbox/client'
import { Badge, Button, CheckBox, Dialog, Text } from '@longbox/components'
import { graphql, OrganizeBucket, OrganizeDecisionInput } from '@longbox/graphql'
import { useLocaleContext } from '@longbox/i18n'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import { ConfidenceBadge } from '@/components/metadata/metadataMatching'

const planMutation = graphql(`
	mutation OrganizeLooseFilesPlan($libraryId: ID!) {
		planOrganizeLooseFiles(libraryId: $libraryId)
	}
`)

const applyMutation = graphql(`
	mutation OrganizeLooseFilesApply($libraryId: ID!, $decisions: [OrganizeDecisionInput!]!) {
		applyOrganizeLooseFiles(libraryId: $libraryId, decisions: $decisions)
	}
`)

const previewQuery = graphql(`
	query OrganizePreview($libraryId: ID!) {
		organizePreview(libraryId: $libraryId) {
			proposedMoves {
				src
				dst
				canonicalName
				year
				externalId
				provider
				confidence
				bucket
				existingSeriesId
			}
			unmatched {
				src
				parsedSeries
				reason
			}
		}
	}
`)

type ProposedMove = NonNullable<
	OrganizePreviewQuery['organizePreview']
>['proposedMoves'][number]

/** Map the checked proposed moves into apply decisions. Pure — unit tested. */
export function toDecisions(moves: ProposedMove[], checked: Set<string>): OrganizeDecisionInput[] {
	return moves
		.filter((m) => checked.has(m.src))
		.map((m) => ({
			src: m.src,
			seriesId: m.existingSeriesId ?? null,
			canonicalName: m.canonicalName,
			year: m.year ?? null,
			externalId: m.externalId,
			provider: m.provider,
		}))
}

const basename = (p: string) => p.split('/').pop() ?? p

type Props = { libraryId: string; open: boolean; onOpenChange: (open: boolean) => void }

export default function OrganizeLooseFilesDialog({ libraryId, open, onOpenChange }: Props) {
	const { t } = useLocaleContext()
	const { sdk } = useSDK()

	const [checked, setChecked] = useState<Set<string>>(new Set())
	const [awaitingPlan, setAwaitingPlan] = useState(false)
	const prevFetching = useRef(false)

	const { data, isFetching } = useGraphQL(
		previewQuery,
		sdk.cacheKey('organizePreview', [libraryId]),
		{ libraryId },
		{ enabled: open },
	)
	const preview = data?.organizePreview ?? null
	const proposed = preview?.proposedMoves ?? []
	const unmatched = preview?.unmatched ?? []

	const { mutateAsync: plan } = useGraphQLMutation(planMutation)
	const { mutateAsync: apply, isPending: isApplying } = useGraphQLMutation(applyMutation)

	// Default-check Confident moves whenever a fresh preview arrives.
	useEffect(() => {
		if (preview) {
			setChecked(
				new Set(
					proposed
						.filter((m) => m.bucket === OrganizeBucket.Confident)
						.map((m) => m.src),
				),
			)
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [preview])

	// A refetch (triggered by the plan job completing → cache invalidation) has landed.
	useEffect(() => {
		if (prevFetching.current && !isFetching) {
			setAwaitingPlan(false)
		}
		prevFetching.current = isFetching
	}, [isFetching])

	const handleScan = useCallback(async () => {
		setAwaitingPlan(true)
		try {
			await plan({ libraryId })
			toast.success(t(getKey('scanStarted')))
		} catch (error) {
			setAwaitingPlan(false)
			toast.error(t(getKey('scanFailed')), {
				description: error instanceof Error ? error.message : undefined,
			})
		}
	}, [plan, libraryId, t])

	const toggle = useCallback((src: string) => {
		setChecked((prev) => {
			const next = new Set(prev)
			if (next.has(src)) next.delete(src)
			else next.add(src)
			return next
		})
	}, [])

	const handleApply = useCallback(async () => {
		const decisions = toDecisions(proposed, checked)
		if (decisions.length === 0) return
		try {
			await apply({ libraryId, decisions })
			toast.success(t(getKey('applyStarted')))
			onOpenChange(false)
		} catch (error) {
			toast.error(t(getKey('applyFailed')), {
				description: error instanceof Error ? error.message : undefined,
			})
		}
	}, [apply, libraryId, proposed, checked, onOpenChange, t])

	const busy = awaitingPlan || isFetching
	const checkedCount = checked.size

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<Dialog.Content size="xl" className="flex max-h-[85vh] flex-col">
				<Dialog.Header>
					<Dialog.Title>{t(getKey('title'))}</Dialog.Title>
					<Dialog.Description>{t(getKey('description'))}</Dialog.Description>
					<Dialog.Close />
				</Dialog.Header>

				<div className="gap-4 min-h-0 flex flex-col">
					<div className="gap-2 flex items-center">
						<Button size="sm" onClick={handleScan} isLoading={busy}>
							{preview ? t(getKey('rescan')) : t(getKey('scan'))}
						</Button>
						{busy && (
							<Text size="sm" variant="muted">
								{t(getKey('scanning'))}
							</Text>
						)}
					</div>

					<div className="min-h-0 flex-1 overflow-y-auto">
						<PreviewBody
							preview={preview}
							busy={busy}
							proposed={proposed}
							unmatched={unmatched}
							checked={checked}
							onToggle={toggle}
							t={t}
						/>
					</div>
				</div>

				<Dialog.Footer>
					<Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
						{t(getKey('cancel'))}
					</Button>
					<Button
						size="sm"
						onClick={handleApply}
						isLoading={isApplying}
						disabled={checkedCount === 0 || busy}
					>
						{t(getKey('apply'), { count: checkedCount })}
					</Button>
				</Dialog.Footer>
			</Dialog.Content>
		</Dialog>
	)
}

function PreviewBody({
	preview,
	busy,
	proposed,
	unmatched,
	checked,
	onToggle,
	t,
}: {
	preview: unknown
	busy: boolean
	proposed: ProposedMove[]
	unmatched: { src: string; parsedSeries?: string | null; reason: string }[]
	checked: Set<string>
	onToggle: (src: string) => void
	t: (key: string) => string
}) {
	if (busy && !preview) {
		return (
			<Text size="sm" variant="muted" className="py-10 text-center">
				{t(getKey('scanning'))}
			</Text>
		)
	}
	if (!preview) {
		return (
			<Text size="sm" variant="muted" className="py-10 text-center">
				{t(getKey('idle'))}
			</Text>
		)
	}
	if (proposed.length === 0 && unmatched.length === 0) {
		return (
			<Text size="sm" variant="muted" className="py-10 text-center">
				{t(getKey('empty'))}
			</Text>
		)
	}
	return (
		<div className="gap-6 flex flex-col">
			{proposed.length > 0 && (
				<div className="gap-2 flex flex-col">
					<Text size="sm" className="font-medium">
						{t(getKey('proposedHeading'))}
					</Text>
					{proposed.map((m) => (
						<MoveRow
							key={m.src}
							move={m}
							checked={checked.has(m.src)}
							onToggle={() => onToggle(m.src)}
						/>
					))}
				</div>
			)}
			{unmatched.length > 0 && (
				<div className="gap-2 flex flex-col">
					<Text size="sm" className="font-medium">
						{t(getKey('unmatchedHeading'))}
					</Text>
					{unmatched.map((u) => (
						<div key={u.src} className="p-2 rounded-lg border border-border bg-background">
							<Text size="sm" className="truncate">
								{u.src.split('/').pop()}
							</Text>
							<Text size="xs" variant="muted">
								{u.reason}
							</Text>
						</div>
					))}
				</div>
			)}
		</div>
	)
}

function MoveRow({
	move,
	checked,
	onToggle,
}: {
	move: ProposedMove
	checked: boolean
	onToggle: () => void
}) {
	const isAmbiguous = move.bucket === OrganizeBucket.Ambiguous
	const target = move.year ? `${move.canonicalName} (${move.year})` : move.canonicalName
	return (
		<div className="gap-3 p-2 flex items-center rounded-lg border border-border bg-background">
			<CheckBox id={move.src} checked={checked} onClick={onToggle} />
			<div className="min-w-0 flex-1">
				<Text size="sm" className="truncate">
					{move.src.split('/').pop()} → {target}
				</Text>
				<div className="gap-1.5 mt-1 flex items-center">
					<Badge size="xs">{move.provider}</Badge>
					<ConfidenceBadge confidence={move.confidence} />
					{isAmbiguous && (
						<Badge variant="warning" size="xs">
							Review
						</Badge>
					)}
				</div>
			</div>
		</div>
	)
}

const LOCALE_KEY = 'librarySettingsScene.options/organize.dialog'
const getKey = (key: string) => `${LOCALE_KEY}.${key}`
```

Notes for the implementer:

- `OrganizePreviewQuery` / `OrganizeBucket` / `OrganizeDecisionInput` are codegen types from `@longbox/graphql` — they exist only after Step 3 (codegen). If the `ProposedMove`/`OrganizePreviewQuery` type import path differs, use the exact generated name (check `packages/graphql/src/client/graphql.ts` after codegen).
- `basename` is defined but the rows use `.split('/').pop()` inline — keep one; prefer the `basename` helper and replace the inline calls, or drop the helper. Resolve the unused-var lint.
- `Dialog.Footer` — confirm it exists in the `Dialog` compound (the exploration lists `.Footer`); if not, use a plain `<div className="mt-4 gap-2 flex justify-end">`.
- `CheckBox` here is used WITHOUT react-hook-form (plain controlled) — confirm `CheckBox` accepts bare `checked`/`onClick` (the `TableColumnsBottomDrawer`/`UserPermissionsTable` usages confirm it does).
- The `t(getKey('apply'), { count })` interpolation: confirm the locale `t` supports a count/interpolation arg (the i18n lib is `@longbox/i18n`); if not, compose the label as `` `${t(getKey('apply'))} (${checkedCount})` ``.
- react-compiler: `prevFetching` ref is a mutable tracker read/written only in an effect (not in render) — allowed. `checked`/`awaitingPlan` are `useState` (render-driving) — correct.

- [ ] **Step 2: Wire the actions section to open the dialog**

Replace `.../options/organizer/OrganizerActionsSection.tsx` (the F2 placeholder):

```tsx
import { Button, Label, Text } from '@longbox/components'
import { useLocaleContext } from '@longbox/i18n'
import { useState } from 'react'

import { useLibraryManagement } from '../../context'
import OrganizeLooseFilesDialog from './OrganizeLooseFilesDialog'

export default function OrganizerActionsSection() {
	const { t } = useLocaleContext()
	const { library } = useLibraryManagement()
	const [open, setOpen] = useState(false)

	return (
		<div className="gap-y-3 flex flex-col">
			<div>
				<Label className="text-base">{t(getKey('organize.heading'))}</Label>
				<Text variant="muted">{t(getKey('organize.description'))}</Text>
			</div>
			<div>
				<Button size="sm" onClick={() => setOpen(true)}>
					{t(getKey('organize.heading'))}
				</Button>
			</div>
			<OrganizeLooseFilesDialog libraryId={library.id} open={open} onOpenChange={setOpen} />
		</div>
	)
}

const LOCALE_BASE = 'librarySettingsScene.options/organize.sections'
const getKey = (key: string) => `${LOCALE_BASE}.${key}`
```

- [ ] **Step 3: Regenerate the client (new documents)**

```bash
export PATH="$HOME/.npm-global/bin:$PATH"
yarn workspace @longbox/graphql codegen
```

- [ ] **Step 4: The decision-mapping unit test**

Create `.../options/organizer/__tests__/toDecisions.test.ts` (mirror `components/library/createOrUpdate/__tests__/schema.test.ts` conventions — pure, no render):

```ts
import { toDecisions } from '../OrganizeLooseFilesDialog'

const move = (over: Partial<Parameters<typeof toDecisions>[0][number]>) =>
	({
		src: '/lib/Batman 001.cbz',
		dst: '/lib/Batman (2016)/Batman 001.cbz',
		canonicalName: 'Batman',
		year: 2016,
		externalId: 'cv-1',
		provider: 'comicvine',
		confidence: 0.92,
		bucket: 'CONFIDENT',
		existingSeriesId: null,
		...over,
	}) as Parameters<typeof toDecisions>[0][number]

describe('toDecisions', () => {
	it('includes only checked moves and maps fields', () => {
		const a = move({ src: '/lib/a.cbz' })
		const b = move({ src: '/lib/b.cbz' })
		const out = toDecisions([a, b], new Set(['/lib/a.cbz']))
		expect(out).toHaveLength(1)
		expect(out[0]).toMatchObject({
			src: '/lib/a.cbz',
			canonicalName: 'Batman',
			year: 2016,
			externalId: 'cv-1',
			provider: 'comicvine',
			seriesId: null,
		})
	})

	it('threads existingSeriesId as seriesId', () => {
		const m = move({ existingSeriesId: 'series-123' })
		const [d] = toDecisions([m], new Set([m.src]))
		expect(d.seriesId).toBe('series-123')
	})

	it('returns empty when nothing checked', () => {
		expect(toDecisions([move({})], new Set())).toEqual([])
	})
})
```

- [ ] **Step 5: i18n strings**

Add under `librarySettingsScene.options/organize`:

- `sections.organize.heading` = "Organize loose files"
- `sections.organize.description` = "Scan for comic files that aren't in a series folder, review the matches, and move them into place."
- `dialog.title` = "Organize loose files"
- `dialog.description` = "Review the proposed moves and apply the ones you want."
- `dialog.scan` = "Scan for loose files", `dialog.rescan` = "Re-scan", `dialog.scanning` = "Scanning… this can take a while with provider lookups.", `dialog.scanStarted` = "Scan started", `dialog.scanFailed` = "Couldn't start the scan", `dialog.idle` = "Scan to find loose files that can be organized.", `dialog.empty` = "No loose files found.", `dialog.proposedHeading` = "Proposed moves", `dialog.unmatchedHeading` = "Couldn't match (left in place)", `dialog.cancel` = "Cancel", `dialog.apply` = "Apply", `dialog.applyStarted` = "Applying…", `dialog.applyFailed` = "Couldn't apply the moves".

- [ ] **Step 6: Verify + commit**

```bash
export PATH="$HOME/.npm-global/bin:$PATH"
yarn workspace @longbox/browser check-types
yarn workspace @longbox/browser test --testPathPattern=toDecisions
yarn lint
git add packages/browser packages/graphql packages/i18n
git commit -m "feat(organizer-ui): loose-file organize dialog (scan → review → apply)"
```

Expected: check-types clean, the 3 `toDecisions` tests pass, lint clean.

---

### Task F4: Invalidate `organizePreview` / `series` / `media` on organize-job completion

**Do this BEFORE Task F3's dialog can auto-refresh** (the dialog relies on this invalidation).

**Files:**

- Modify: `packages/sdk/src/constants.ts`
- Modify: `packages/browser/src/hooks/useCoreEvent.ts`
- Regenerate: `packages/graphql/src/client/*`

**Interfaces:**

- Produces: `sdk.cacheKeys.organizePreview` + auto-invalidation of the preview/series/media queries when an `OrganizeLooseFilesOutput` job completes.

- [ ] **Step 1: Add the cache key**

In `packages/sdk/src/constants.ts`, add to the `cacheKeys` `as const` map (alphabetical-ish, near `media`/`series`):

```ts
	organizePreview: 'organizePreview',
```

- [ ] **Step 2: Select the organize output in the subscription**

In `packages/browser/src/hooks/useCoreEvent.ts`, add to the `... on JobOutput { output { __typename ... } }` selection (next to `LibraryScanOutput`/`SeriesScanOutput`):

```graphql
					... on OrganizeLooseFilesOutput {
						moved
						proposedMoves
					}
```

- [ ] **Step 3: Handle it in `handleJobOutput`**

In `handleJobOutput`, extend the key set so an organize output invalidates the preview (always) plus series/media when files were moved. Add before the `const keys = [...]` (or inline into it):

```ts
	const organizedMoved = match(output)
		.with({ __typename: 'OrganizeLooseFilesOutput' }, ({ moved }) => moved)
		.otherwise(() => 0)
	const isOrganize = output.__typename === 'OrganizeLooseFilesOutput'
```

and extend the `keys` array:

```ts
	const keys = [
		sdk.cacheKeys.scanHistory,
		sdk.cacheKeys.getStats,
		'missingEntities',
		...(affectedBooks > 0 ? [sdk.cacheKeys.recentlyAddedMedia, sdk.cacheKeys.media] : []),
		...(affectedSeries > 0 ? [sdk.cacheKeys.recentlyAddedSeries, sdk.cacheKeys.series] : []),
		...(isOrganize ? [sdk.cacheKeys.organizePreview] : []),
		...(organizedMoved > 0 ? [sdk.cacheKeys.media, sdk.cacheKeys.series] : []),
	] as string[]
```

(`match`/`P` are already imported from `ts-pattern` in this file.)

- [ ] **Step 4: Regenerate + verify**

```bash
export PATH="$HOME/.npm-global/bin:$PATH"
yarn workspace @longbox/graphql codegen
yarn workspace @longbox/browser check-types
yarn lint
```

Expected: the subscription union now includes `OrganizeLooseFilesOutput`; types clean.

- [ ] **Step 5: Commit**

```bash
git add packages/sdk packages/browser packages/graphql
git commit -m "feat(organizer-ui): invalidate organize preview + series/media on job completion"
```

---

### Task F5: Frontend preflight + verification

**Files:** none (verification only)

- [ ] **Step 1: Full frontend gates**

```bash
export PATH="$HOME/.npm-global/bin:$PATH"
yarn lint
yarn test
```

Expected: both green (lint = eslint+prettier+check-types across 5 projects; test = jest incl. the new `toDecisions` test).

- [ ] **Step 2: Production build sanity**

```bash
export PATH="$HOME/.npm-global/bin:$PATH"
yarn workspace @longbox/web build
```

Expected: builds without error (catches any Vite/tree-shaking/type issues the dev gates miss).

- [ ] **Step 3: Schema/client drift check (belt-and-suspenders)**

```bash
cargo dump-schema -- --check   # exit 0 — no server schema change from frontend work
git status --short              # regenerated client already committed; tree clean
```

- [ ] **Step 4: Live verification (recommended, may be environment-gated)**

Per the `longbox-live-verify-setup` memory: build the web dist, run the server against a library seeded with loose files, and drive **Settings → Organizer**: flip the toggle (confirm it persists), open the dialog, "Scan for loose files", confirm the preview renders buckets, select + Apply, and confirm the file moved + a new series appears. NOTE: provider-confirmed scanning needs a reachable provider (Metron is IP-banned on the real egress — use a ComicVine/cached path or accept that most files defer to Unmatched). If a live run isn't feasible here, document that this manual step remains before shipping.

- [ ] **Step 5: Commit any preflight fixes**

```bash
git add -A
git commit -m "chore(organizer-ui): satisfy frontend preflight"
```

---

## Self-Review

**Spec coverage:** toggle (F1+F2) ✓; Organizer tab (F2) ✓; scan→review→apply dialog with include/exclude + read-only Unmatched (F3) ✓; job-subscription-driven preview refresh (F4) ✓; explicit Scan button + ScanLibrary/ManageLibrary gating (F2/F3) ✓; codegen for all new documents (F1/F3/F4) ✓; i18n (F2/F3) ✓; tests + gates (F3/F5) ✓.

**Ordering:** F1 → F2 → **F4 → F3** (F3's dialog auto-refresh depends on F4's invalidation + cache key) → F5.

**Placeholder scan:** the only intentional placeholder is `OrganizerActionsSection` in F2 (a `return null` stub) explicitly replaced in F3 — called out in both tasks.

**Known verify-time adjustments (flagged inline):** exact codegen type names (`OrganizePreviewQuery`, `ProposedMove`), `Dialog.Footer` existence, `CheckBox` bare-controlled usage, `t(...)` interpolation support, the `@longbox/i18n` locale file location/format, and the `lucide-react` icon name — each noted in its task.

## Execution Handoff

Execute with **superpowers:subagent-driven-development** (same branch `feat/loose-file-organizer`, continuing the SDD ledger). Fresh implementer per task, task review after each, final whole-branch review folds into the existing one.
