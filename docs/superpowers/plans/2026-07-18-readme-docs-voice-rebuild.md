# README & Documentation Voice Rebuild — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the README and documentation in a consistent "Longbox Archivist" voice, codified once and applied to the README (full voice), the docs chrome (full voice), and the deep guides (voiced framing, neutral body) — de-Stumping every page along the way, without touching product code.

**Architecture:** Author the voice as a committed source-of-truth doc first (`docs/longbox-voice-notes.md`), then rewrite the three flagship surfaces by hand (voice-notes, README, Overview) so the voice is pinned exactly, then apply a mechanical treatment recipe to the remaining chrome pages and the 37 deep guides in section batches. Each task ends with a validity gate (`fumadocs-mdx` compile for MDX, grep assertions for README invariants) and a commit.

**Tech Stack:** Markdown (`README.md`, `docs/README.md`, voice-notes), fumadocs MDX (`docs/content/docs/**/*.mdx`), fumadocs-mdx + tsc for validity, prettier via husky/lint-staged pre-commit.

## Global Constraints

- **Branch:** all work lands on `docs/voice-rebuild` (already created; spec already committed there).
- **No product source touched.** Only `README.md`, `docs/README.md`, `docs/longbox-voice-notes.md`, and files under `docs/content/docs/**`. Final task asserts `git diff --name-only main` shows nothing outside those.
- **Voice source of truth:** `docs/longbox-voice-notes.md` (Task 1). Every later task reads it first.
- **Preserve upstream attribution verbatim:** the fork-of-Stump credit, the MIT `LICENSE`, and attribution links to `stumpapp/stump`. Never "fix" those to Longbox (per `CLAUDE.md`).
- **Fix only functional stale links:** roadmap / issues / star-history pointing at `stumpapp/stump` → `SaintedRogue/longbox`. Attribution links stay.
- **Metaphor seasons, never renames.** In step-by-step text the real product noun (Library, Series, Book, Collection, Reading List, Smart List) always wins; the comic word is a one-time gloss.
- **Commands, paths, and code fences stay byte-for-byte exact** in every rewrite.
- **Caption-box device is markdown-only.** In `.md` files use `> **LABEL** — …`. In `.mdx` files the idiom is the fumadocs `<Callout>` component — put the voice in a **bold voiced label** as the callout's first line; never inject raw markdown blockquote caption-boxes into MDX.
- **Fixed caption-box / callout label set** (do not invent new ones): `MINT CONDITION` (beta/data-safety), `BAGGED & BOARDED` (offline/durability), `PULL LIST` (roadmap), `HOUSE RULES` (config/permissions), `CONTINUITY` (compatibility/attribution), `FROM THE LONGBOX` (tips).
- **MDX validity gate:** `yarn workspace @longbox/docs types:check` must pass after any `docs/content` change.

---

## File Structure

**Created:**

- `docs/longbox-voice-notes.md` — the codified voice (verbal identity), companion to `docs/longbox-design-notes.md`.

**Modified — flagship (hand-written full voice):**

- `README.md`
- `docs/content/docs/index.mdx` (Overview)

**Modified — chrome (full voice, smaller):**

- `docs/README.md`
- `docs/content/docs/getting-started/installation/index.mdx`
- `docs/content/docs/apps/web/index.mdx`
- `docs/content/docs/developer/cli/index.mdx`
- `docs/content/docs/guides/features/book-clubs/index.mdx`
- `docs/content/docs/guides/integrations/metadata-fetching/index.mdx`

**Modified — deep guides (voiced framing, neutral body), 37 files in 9 section batches:**

- getting-started/installation: `binaries.mdx`, `docker.mdx`, `source.mdx`
- apps/web: `layout.mdx`, `readers.mdx`, `themes.mdx`
- developer: `api.mdx`, `cli/account.mdx`, `contributing.mdx`
- guides/fundamentals: `background-jobs.mdx`, `books.mdx`, `libraries.mdx`, `progress.mdx`, `scanner.mdx`, `series.mdx`, `tags.mdx`, `thumbnails.mdx`
- guides/features: `api-keys.mdx`, `email.mdx`, `file-explorer.mdx`, `opds.mdx`, `reading-list.mdx`, `smart-list.mdx`, `upload.mdx`
- guides/features/book-clubs: `books.mdx`, `rbac.mdx`, `social-features.mdx`
- guides/access-control: `age-restrictions.mdx`, `library-access.mdx`, `oidc.mdx`, `permissions.mdx`, `tag-restrictions.mdx`, `users.mdx`
- guides/configuration: `server-config.mdx`
- guides/integrations: `kobo.mdx`, `koreader.mdx`, `metadata-fetching/providers.mdx`

---

## Task 1: Codify the voice (`docs/longbox-voice-notes.md`)

**Files:**

- Create: `docs/longbox-voice-notes.md`

**Interfaces:**

- Produces: the voice source of truth every later task reads. Defines lexicon, the fixed label set, the markdown-vs-MDX caption-box rule, register rules, don'ts, and one worked deep-guide example.

- [ ] **Step 1: Write the file**

Create `docs/longbox-voice-notes.md` with exactly this content:

````markdown
# Longbox verbal identity notes

The companion to `longbox-design-notes.md`. That doc governs how Longbox
_looks_; this one governs how it _talks_. New docs and UI copy should extend
this direction, not restart it.

## Ethos, one sentence

Longbox treats the digital comics you own the way a collector treats the
physical ones — bagged, boarded, filed, and yours — and runs entirely on your
own hardware.

## The voice: "The Longbox Archivist"

Warm, tactile, preservation-minded, ownership-first. It speaks to a collector
about their collection. It is quietly obsessive in the good way — the person who
alphabetizes their run and knows which issue is bagged where. It is never
corporate, never breathless (except where noted), never condescending.

- **"You"** is the collector. **"We"** is the project.
- Loud comic-shop lettering (all-caps hype, SFX energy) is allowed **only** in
  the README hero tagline and one divider splash. Nowhere else.
- Deep guide bodies are neutral, clear, and imperative. The voice lives only in
  the intro sentence, the section names, and the callout asides.

## The lexicon

Metaphor **seasons**; it never renames real product nouns. In instructions the
real UI concept always wins (Library, Series, Book, Collection, Reading List,
Smart List); the comic word is a one-time gloss, not a rename.

| Comic word                               | Used for                                 | Guardrail                                                   |
| ---------------------------------------- | ---------------------------------------- | ----------------------------------------------------------- |
| your longbox / the shelf                 | the whole running server                 | —                                                           |
| issue · run                              | a book · a series                        | Gloss once ("a series — your run of a title"); don't rename |
| bagged & boarded                         | offline durability, backups, data safety | —                                                           |
| pulled / the pulled issue                | the active book / peek overlay           | established brand motif                                     |
| your box, your rules · no cloud landlord | the self-host ownership pitch            | carry the "why" in plain language                           |
| cracking the box / the spine             | getting started, first run               | —                                                           |

## Signature devices

- **Caption-box callout.** In **markdown** files (`README.md`, `docs/README.md`,
  this file): `> **LABEL** — one line.` In **MDX** files (everything under
  `docs/content`): use the fumadocs `<Callout>` component with a **bold voiced
  label** as the first line — never inject a raw markdown blockquote.
- **Fixed label set** (do not invent new labels):
  - `MINT CONDITION` — beta status, data safety, backups
  - `BAGGED & BOARDED` — offline, durability, sync-on-reconnect
  - `PULL LIST` — roadmap / planned work
  - `HOUSE RULES` — configuration, permissions, access control
  - `CONTINUITY` — compatibility, requirements, attribution
  - `FROM THE LONGBOX` — tips / nice-to-know asides
- **Panel divider** between major README sections: `— · — · —`
- **Voiced section names with a plain gloss**, so scannability survives:
  `## » Cracking the box open (getting started)`

## Hard don'ts

- Don't rename real product concepts in step-by-step text.
- Don't bury a required step under a metaphor.
- Don't carry meaning in ASCII art alone — the caption-box **label is real
  text** (screen-reader safe).
- **Don't touch upstream attribution.** The fork-of-Stump credit, the MIT
  `LICENSE`, and attribution links to `stumpapp/stump` stay exactly as they are.
- Don't invent product behavior to fit a metaphor. Accuracy wins.

## Worked example — a deep guide (voiced framing, neutral body)

Deep guides get three moves and nothing more: a voiced one-line intro, voiced
section names (with a plain gloss where the name isn't self-evident), and the
voice folded into callouts that already exist. The step-by-step body is left
neutral and accurate.

**Before** (`guides/fundamentals/libraries.mdx`):

```mdx
There are a couple key concepts to go over regarding how Longbox represents
libraries:
```

**After:**

```mdx
A **Library** is where a run lives on disk — point Longbox at a folder and it
files everything inside. A couple of concepts shape how it reads that shelf:
```

Section name **before**: `## Supported Patterns`
Section name **after**: `## » How the shelf gets sorted (supported patterns)`

The file tree examples, the Steps, the Tabs, and the how-to body underneath stay
exactly as they are.
````

- [ ] **Step 2: Verify prettier-clean**

Run: `cd /home/rogue/longbox && npx prettier --check docs/longbox-voice-notes.md`
Expected: `All matched files use Prettier code style!` (or the file listed as already formatted). If it reports issues, run `npx prettier --write docs/longbox-voice-notes.md` and re-check.

- [ ] **Step 3: Commit**

```bash
cd /home/rogue/longbox
git add docs/longbox-voice-notes.md
git commit -m "docs: codify the Longbox Archivist voice (verbal identity notes)"
```

---

## Task 2: Rebuild the README (full voice)

**Files:**

- Modify: `README.md` (full rewrite of prose; banner, badges, screenshot, code fences, and License section preserved verbatim)

**Interfaces:**

- Consumes: voice from Task 1.
- Produces: the repo front door in Archivist voice. Anchors used by the TOC must match the new section headings.

- [ ] **Step 1: Replace the file contents**

Write `README.md` with exactly this content:

````markdown
<p align="center">
  <img alt="Longbox — self-hosted comics, manga & digital books" src="./.github/images/banner.png" width="720" />
</p>

<p align="center">
  <a href="https://github.com/SaintedRogue/longbox/blob/main/LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-d98a3d?labelColor=211d18" /></a>
  <a href="https://github.com/SaintedRogue/longbox/stargazers"><img alt="Stars" src="https://img.shields.io/github/stars/SaintedRogue/longbox?color=d98a3d&labelColor=211d18" /></a>
  <a href="https://github.com/SaintedRogue/longbox/commits/main"><img alt="Last commit" src="https://img.shields.io/github/last-commit/SaintedRogue/longbox?color=2f6f6a&labelColor=211d18" /></a>
  <img alt="Rust" src="https://img.shields.io/badge/Rust-211d18?logo=rust&logoColor=d98a3d" />
  <img alt="React" src="https://img.shields.io/badge/React-211d18?logo=react&logoColor=61dafb" />
  <img alt="PWA" src="https://img.shields.io/badge/PWA--first-211d18?logo=pwa&logoColor=f3efe8" />
</p>

<p align="center">
  <b>Your comics, bagged, boarded, and served.</b><br/>
  A fast, self-hosted longbox for every issue you own — comics, manga, and digital books — with a Rust core, an installable web app, and full <a href="https://opds.io/">OPDS</a> support. A PWA-first fork of <a href="https://github.com/stumpapp/stump">Stump</a>.
</p>

<p align="center">
  <img alt="Screenshot of Longbox" src="./docs/public/images/landing-dark.png" width="90%" />
</p>

<!-- prettier-ignore -->
<details>
  <summary><b>Table of Contents</b></summary>

- [What is Longbox?](#what-is-longbox)
- [What's in this box that Stump's isn't](#whats-in-this-box-that-stumps-isnt)
- [What's inside](#whats-inside)
- [Cracking the box open](#cracking-the-box-open)
- [For the shop out back (developers)](#for-the-shop-out-back-developers)
- [How the box is packed](#how-the-box-is-packed)
- [If this box isn't for you](#if-this-box-isnt-for-you)
- [License & Attribution](#license--attribution)

</details>

## What is Longbox?

Longbox is a free, open-source media server for the comics, manga, and books you
already own. Point it at your files and it does what a good collector does:
scans the shelf, reads the metadata off every issue, and serves the whole run to
a fast built-in reader, to any [OPDS](https://opds.io/) client, and to your
e-ink device — all from a single self-hosted binary. No cloud landlord, no
subscription, no one else's server. Your box, your rules.

Under the hood it's [Rust](https://www.rust-lang.org/) +
[Axum](https://github.com/tokio-rs/axum) + [SeaORM](https://www.sea-ql.org/SeaORM/)
doing the scanning and serving, with a [React](https://react.dev/) app up front.

Longbox began as a fork of [Stump](https://github.com/stumpapp/stump) by Aaron
Leopold, whose excellent Rust core and fast scanner we kept and built on. Where
Stump ships desktop and mobile apps alongside the web UI, **Longbox goes all-in
on a single installable PWA** — and spends that focus on navigation, comic
metadata, and offline reading.

> **MINT CONDITION** — Longbox is pre-`1.0` and should be treated as beta. We
> handle your files like mint back-issues and avoid breaking or data-losing
> changes where we can, but make no guarantees. Pin versions and keep your own
> backups until we hit a clean `1.0`.

— · — · —

## What's in this box that Stump's isn't

The things Longbox adds on top of the Stump core:

- **🗂️ One longbox, everywhere.** The Tauri desktop and Expo mobile apps are
  gone — a single installable, offline-capable PWA covers desktop and mobile.
  Dropping the native apps also makes the whole repository uniformly
  [MIT](./LICENSE).
- **🧭 Navigation that keeps your place.** Scroll position is restored on
  back/forward, book details open as a **peek overlay** over the browse grid (the
  "pulled issue" — you never lose your spot on the shelf), and breadcrumbs plus
  back/forward controls make it easy to find your way home. _(See
  [`docs/adr/0001`](./docs/adr/0001-router-and-scroll-restoration.md).)_
- **🏷️ Deeper comic metadata.** A [Metron](https://metron.cloud) provider brings
  CC BY-SA metadata and ComicVine/GCD cross-references into the enrichment
  framework, ComicVine IDs are recovered from ComicTagger/Kavita tags
  (`[Issue ID N]` and `[CVDB N]`), and edits can be written **back to
  `ComicInfo.xml`** inside the archive (opt-in, CBZ).
- **📥 Bagged & boarded offline reading.** Reading progress made offline is
  queued locally (IndexedDB) and synced automatically on reconnect, so a dropped
  connection never loses your place. Full offline downloads are
  [on the pull list](./docs/longbox-wave3b-offline-plan.md).
- **📱 Proper installability.** Maskable icons, a full iOS launch-screen set, and
  a themed splash — Longbox installs and launches like a native app.
- **📦 A fresh identity.** A hand-drawn line-mark and brand system (see
  [`docs/longbox-design-notes.md`](./docs/longbox-design-notes.md)).

## What's inside

Inherited from the Stump core and carried forward:

- [OPDS](https://opds.io/) [v1.2](https://specs.opds.io/opds-1.2) (including
  [OPDS PSE](https://github.com/anansi-project/opds-pse)) and
  [v2.0](https://specs.opds.io/opds-2.0.html)
- EPUB, PDF, CBZ/ZIP, and CBR/RAR — with a built-in reader for every format
- Annotations and highlights for EPUB
- OIDC authentication and multi-user accounts with permissions, age
  restrictions, and access control
- [Kobo](/docs/content/docs/guides/integrations/kobo.mdx) and
  [KoReader](/docs/content/docs/guides/integrations/koreader.mdx) sync
- A handful of [built-in themes](/docs/content/docs/apps/web/themes.mdx) (light,
  dark, and more)
- 32 locales
- Multiple installation methods, including Docker and pre-built binaries

The [documentation](/docs/content/docs) has the full run.

## Cracking the box open

Installation guides live in
[the docs](/docs/content/docs/getting-started/installation/index.mdx) (Docker and
pre-built binaries).

To crack it open locally for development:

```bash
yarn install          # install JS deps
yarn web build        # build the web app once
cargo run -p longbox_server   # run the server (serves the built web app)
# or, for hot-reloading the web UI:
yarn dev:web
```

## For the shop out back (developers)

The developer guide is in
[the docs](/docs/content/docs/developer/contributing.mdx); please review
[CONTRIBUTING.md](./.github/CONTRIBUTING.md) first.

Contributions are very welcome — good places to start:

- **UI/UX** — even small polish goes a long way
- **Tests** — broader coverage, especially around metadata and readers
- **Translations** — help expand and fix locale coverage
- **CI / release automation** and other devops
- Chipping away at `TODO`/`FIXME` comments

Take a look at the [open issues](https://github.com/SaintedRogue/longbox/issues)
to see what's on the pull list.

## How the box is packed

Managed with yarn workspaces + cargo workspaces:

```bash
apps/
  server/   # Axum server (also serves the web app)
  web/      # installable React PWA
core/       # file processing, scanning, metadata internals
crates/     # supporting Rust crates
  migrations/  models/  graphql/  integrations/  ...
packages/   # shared TypeScript packages (browser UI, sdk, components, i18n, ...)
docs/       # documentation + design notes, ADRs, and plans
```

## If this box isn't for you

Longbox is far from the only server in this space. If it isn't your fit, these
are worth a look:

- [Kavita](https://github.com/Kareadita/Kavita)
- [Komga](https://github.com/gotson/komga)
- [Codex](https://github.com/ajslater/codex)
- [Storyteller](https://gitlab.com/storyteller-platform/storyteller)
- [audiobookshelf](https://github.com/advplyr/audiobookshelf) (_audiobooks & podcasts_)

## License & Attribution

All code in this repository is licensed under the [MIT License](https://www.tldrlegal.com/license/mit-license).

Longbox is a fork of [**Stump**](https://github.com/stumpapp/stump) by Aaron Leopold and contributors — thank you for the Rust core and fast scanner this project is built on.
````

- [ ] **Step 2: Assert the code fences and commands are byte-for-byte intact**

Run:

```bash
cd /home/rogue/longbox
grep -qF 'cargo run -p longbox_server   # run the server (serves the built web app)' README.md \
  && grep -qF 'yarn web build        # build the web app once' README.md \
  && grep -qF 'yarn dev:web' README.md \
  && echo "COMMANDS OK" || echo "COMMANDS DRIFTED — FIX BEFORE COMMIT"
```

Expected: `COMMANDS OK`

- [ ] **Step 3: Assert License & Attribution and badges are unchanged**

Run:

```bash
cd /home/rogue/longbox
grep -qF 'All code in this repository is licensed under the [MIT License](https://www.tldrlegal.com/license/mit-license).' README.md \
  && grep -qF 'Longbox is a fork of [**Stump**](https://github.com/stumpapp/stump) by Aaron Leopold and contributors' README.md \
  && grep -qF 'src="./.github/images/banner.png"' README.md \
  && echo "ATTRIBUTION + BANNER OK" || echo "ATTRIBUTION DRIFTED — FIX BEFORE COMMIT"
```

Expected: `ATTRIBUTION + BANNER OK`

- [ ] **Step 4: Assert TOC anchors match headings**

Every `## ` heading's GitHub anchor (lowercase, spaces→`-`, punctuation dropped) must appear in the TOC. Eyeball the TOC list against the eight `##` headings; they were authored to match. Confirm no heading lacks a TOC entry and no TOC entry lacks a heading.

- [ ] **Step 5: Commit**

```bash
cd /home/rogue/longbox
git add README.md
git commit -m "docs(readme): rebuild in the Longbox Archivist voice"
```

---

## Task 3: Rebuild the Overview page (full voice + de-Stump)

**Files:**

- Modify: `docs/content/docs/index.mdx`

**Interfaces:**

- Consumes: voice from Task 1.
- Produces: the docs landing page in full voice, with the original author's first-person "I" reframed to the fork's "we", the roadmap link repointed to `SaintedRogue/longbox`, and the misleading upstream star-history reference removed.

- [ ] **Step 1: Replace the file contents**

Write `docs/content/docs/index.mdx` with exactly this content:

```mdx
---
title: Overview
---

## What is Longbox?

Longbox is an open-source, self-hostable media server for the digital books you
own — ebooks, comics, manga, the lot. It's built to be _easy to run_ and _easy
to live in_.

The short version of how it works:

- Run Longbox on a computer or NAS (Network Attached Storage).
- Point it at your libraries — the folders where your run lives on disk.
- Read your collection through the web app or any compatible OPDS client.

Longbox **is not** a tool for fetching or downloading media. It hosts and serves
**your own files** — think of it as a personal Netflix for the comics, manga, and
books already on your shelf, running on a box in your home. Your box, your rules.

## Why it exists

Longbox is a fork of [Stump](https://github.com/stumpapp/stump), which grew out
of a simple itch: self-hosted OPDS servers like [Komga](https://komga.org) are
excellent, and building one in Rust was a great way to learn what goes into them.
The goals we carry forward from that start:

- Small footprint and low resource usage.
- Efficiency and performance even on modest hardware (a Raspberry Pi is plenty) —
  the bar isn't "fastest on the shelf," it's "you never _notice_ it working."
- An interface that's intuitive, easy on the eyes, and easy to use.
- Wide format support (PDF, EPUB, CBZ/CBR).

There's a lot of surface area to Longbox now. Many decisions come from a mix of
real personal use and community feedback — so if you have an idea or a request,
please don't hesitate to open an issue.

## Compatibility

> **CONTINUITY** — Longbox runs on all major browsers and operating systems.
> 1 GB of RAM and disk is generally enough, and it runs well on low-powered
> ARM single-board computers like a Raspberry Pi.

## The pull list (roadmap)

To track active or planned work, take a look at
[GitHub issues](https://github.com/SaintedRogue/longbox/issues).

## If this box isn't for you

Longbox isn't the first or only digital-book media server, and it won't be the
right fit for everyone. If it isn't yours — or you just want to see what else
lives in the Rust and self-hosting spaces — these are worth a look:

- [audiobookshelf](https://github.com/advplyr/audiobookshelf) (_audiobooks, podcasts_)
- [Codex](https://github.com/ajslater/codex)
- [Kavita](https://github.com/Kareadita/Kavita)
- [Komga](https://github.com/gotson/komga)
```

- [ ] **Step 2: Assert de-Stumping happened**

Run:

```bash
cd /home/rogue/longbox
! grep -qE 'stumpapp/stump/issues|star-history' docs/content/docs/index.mdx \
  && grep -qF 'github.com/SaintedRogue/longbox/issues' docs/content/docs/index.mdx \
  && echo "DE-STUMP OK" || echo "STALE LINK REMAINS — FIX BEFORE COMMIT"
```

Expected: `DE-STUMP OK`
(The one remaining `stumpapp/stump` link — the fork attribution in "Why it exists" — is intentional and stays.)

- [ ] **Step 3: Verify MDX still compiles**

Run: `cd /home/rogue/longbox && yarn workspace @longbox/docs types:check`
Expected: exits 0 (no MDX/type errors).

- [ ] **Step 4: Commit**

```bash
cd /home/rogue/longbox
git add docs/content/docs/index.mdx
git commit -m "docs: rebuild Overview in voice, de-Stump roadmap + star-history"
```

---

## Task 4: Rewrite the remaining chrome pages (full voice)

**Files:**

- Modify: `docs/README.md`
- Modify: `docs/content/docs/getting-started/installation/index.mdx`
- Modify: `docs/content/docs/apps/web/index.mdx`
- Modify: `docs/content/docs/developer/cli/index.mdx`
- Modify: `docs/content/docs/guides/features/book-clubs/index.mdx`
- Modify: `docs/content/docs/guides/integrations/metadata-fetching/index.mdx`

**Interfaces:**

- Consumes: voice from Task 1.
- Produces: all six section-landing surfaces in full voice, first-person "I" reframed to "we", MDX components preserved.

- [ ] **Step 1: `docs/README.md`** — this is a generic Create-Fumadocs stub. Replace its body prose only (keep the `npm run dev` block exact):

Write `docs/README.md` as:

````markdown
# docs

The Longbox documentation app — a [Fumadocs](https://github.com/fuma-nama/fumadocs)
site (TanStack Start) that serves the guides in `content/docs`. If you're writing
docs, read `../longbox-voice-notes.md` first: it's the shelf label for how Longbox
talks.

Run the development server:

```bash
npm run dev
# or
pnpm dev
# or
yarn dev
```
````

- [ ] **Step 2: `getting-started/installation/index.mdx`** — add a voiced intro; keep the frontmatter, the three method links, and the community-packages note exactly. Replace file with:

```mdx
---
title: Installation
description: How to install Longbox and get it up and running
---

Getting the box on the shelf is quick. Almost everything here concerns the
Longbox **server**, which installs three ways:

- [Pre-built binaries](/docs/getting-started/installation/binaries)
- [Docker](/docs/getting-started/installation/docker)
- [Manual build from source](/docs/getting-started/installation/source)

There are also community-maintained routes that the Longbox developer doesn't
officially support, but that other collectors keep running:

- [Community packages](/docs/getting-started/installation/source#community-packages) (e.g., the AUR package)
```

- [ ] **Step 3: `apps/web/index.mdx`** — voice the intro + section, reframe first-person "I" to "we", keep the `<Callout>` (fold in a voiced label). Replace file with:

```mdx
---
title: Web App
description: The default, browser-based interface for Longbox
---

The reader you'll actually live in: a single-page app built with
[React](https://react.dev/) that ships with the server. No install, no app store —
just open the box in a browser.

## » Finding your way in (access)

Open the web app at the host machine's IP and the configured port. If Longbox is
running on your own machine on the default port, that's `http://localhost:10801`.
From another machine on the same network, use `http://{machine_ip}:10801`.

Reaching it from a different network is more involved and a bit beyond this guide.
We'd love to gather curated tutorials for common setups (reverse proxy, VPN, and
so on) — Tailscale and Caddy are one good combination, but there are many ways to
get there.

<Callout type="idea">
	**FROM THE LONGBOX** — Got a setup you'd like a guide for, or willing to share yours as a proper
	how-to write-up? Please reach out.
</Callout>
```

- [ ] **Step 4: `developer/cli/index.mdx`** — read the current file first, then add a single voiced intro line above its existing content and voice its section headings with a gloss. Keep every command, flag, and code block exact. (This file was not pre-imaged; apply the deep-guide recipe from Task 1's worked example — voiced intro + voiced section names — since it's a small landing.)

Run first: `cat docs/content/docs/developer/cli/index.mdx`
Then apply: one voiced intro sentence (e.g. "The `longbox` CLI is the back-room counter — account chores and server tasks without the web app.") and gloss any non-obvious `##` headings. Body/commands unchanged.

- [ ] **Step 5: `guides/features/book-clubs/index.mdx`** — read first, add a voiced intro sentence, voice section names, preserve all MDX components and body.

Run first: `cat docs/content/docs/guides/features/book-clubs/index.mdx`
Then apply the same recipe.

- [ ] **Step 6: `guides/integrations/metadata-fetching/index.mdx`** — voice the intro; keep the experimental `<Callout type="warn">` but fold in a voiced label. Replace file with:

```mdx
---
title: Metadata Fetching
---

<Callout type="warn">
	**CONTINUITY** — This integration is highly experimental. Please use it with caution and report
	any issues you encounter.
</Callout>

Longbox can pull metadata for your run from external providers — Hardcover, Open
Library, Anilist, and ComicVine — to fill in the details on every issue.
```

- [ ] **Step 7: Verify all MDX compiles**

Run: `cd /home/rogue/longbox && yarn workspace @longbox/docs types:check`
Expected: exits 0.

- [ ] **Step 8: Assert docs/README dev block intact**

Run: `cd /home/rogue/longbox && grep -qF 'npm run dev' docs/README.md && echo OK`
Expected: `OK`

- [ ] **Step 9: Commit**

```bash
cd /home/rogue/longbox
git add docs/README.md docs/content/docs/getting-started/installation/index.mdx docs/content/docs/apps/web/index.mdx docs/content/docs/developer/cli/index.mdx docs/content/docs/guides/features/book-clubs/index.mdx docs/content/docs/guides/integrations/metadata-fetching/index.mdx
git commit -m "docs: rewrite section-landing chrome pages in voice"
```

---

## Deep-guide recipe (Tasks 5–13)

Every deep-guide task applies the **same three moves** and nothing more. This
recipe is the complete instruction for those tasks — do not improvise beyond it.

**Before editing any file, read `docs/longbox-voice-notes.md`.** Then, per file:

1. **Voiced one-line intro.** Rewrite (or prepend) the opening sentence so it
   leads in the Archivist voice. Keep it to one or two sentences. The very next
   line returns to the existing neutral body.
2. **Voiced section names with a plain gloss.** For each `## ` / `### ` heading
   whose plain name isn't self-evident, prefix `» ` and append a
   `(plain gloss)` so scanners still find it. Self-evident headings (e.g.
   `## Docker`) may be left alone. **Do not** change heading depth or add/remove
   headings — anchors and the sidebar depend on them.
3. **Voice inside existing callouts only.** Where a `<Callout>` already exists,
   prefix its text with a **bold label from the fixed set** that fits its purpose
   (`HOUSE RULES`, `MINT CONDITION`, `CONTINUITY`, `FROM THE LONGBOX`,
   `BAGGED & BOARDED`, `PULL LIST`). Do **not** add new callouts.

**Never touch:** frontmatter keys, code fences, commands, flags, file paths, env
var names, `<Steps>`/`<Files>`/`<Tabs>` structures, tables, or any step-by-step
body text. Reframe any first-person author "I" to "we" where it appears in prose.

**Per-task gate (identical for Tasks 5–13):**

- Run `yarn workspace @longbox/docs types:check` → exits 0.
- Run `git diff --stat` and confirm only that batch's files changed.
- Commit with the batch's message.

---

## Task 5: Deep guides — getting-started/installation

**Files:**

- Modify: `docs/content/docs/getting-started/installation/binaries.mdx`
- Modify: `docs/content/docs/getting-started/installation/docker.mdx`
- Modify: `docs/content/docs/getting-started/installation/source.mdx`

- [ ] **Step 1:** Read `docs/longbox-voice-notes.md`, then read all three files.
- [ ] **Step 2:** Apply the deep-guide recipe to each. Keep every command, image tag, env var, and code block byte-for-byte.
- [ ] **Step 3:** Run `cd /home/rogue/longbox && yarn workspace @longbox/docs types:check` → expect exit 0.
- [ ] **Step 4:** `git diff --stat` shows only these three files.
- [ ] **Step 5:** Commit:

```bash
git add docs/content/docs/getting-started/installation/binaries.mdx docs/content/docs/getting-started/installation/docker.mdx docs/content/docs/getting-started/installation/source.mdx
git commit -m "docs(install): voiced framing on binaries/docker/source guides"
```

---

## Task 6: Deep guides — apps/web

**Files:**

- Modify: `docs/content/docs/apps/web/layout.mdx`
- Modify: `docs/content/docs/apps/web/readers.mdx`
- Modify: `docs/content/docs/apps/web/themes.mdx`

- [ ] **Step 1:** Read the voice notes, then all three files.
- [ ] **Step 2:** Apply the deep-guide recipe to each.
- [ ] **Step 3:** `yarn workspace @longbox/docs types:check` → exit 0.
- [ ] **Step 4:** `git diff --stat` shows only these three files.
- [ ] **Step 5:** Commit:

```bash
git add docs/content/docs/apps/web/layout.mdx docs/content/docs/apps/web/readers.mdx docs/content/docs/apps/web/themes.mdx
git commit -m "docs(web): voiced framing on layout/readers/themes guides"
```

---

## Task 7: Deep guides — developer

**Files:**

- Modify: `docs/content/docs/developer/api.mdx`
- Modify: `docs/content/docs/developer/cli/account.mdx`
- Modify: `docs/content/docs/developer/contributing.mdx`

- [ ] **Step 1:** Read the voice notes, then all three files.
- [ ] **Step 2:** Apply the deep-guide recipe. In `contributing.mdx`, reframe any first-person author voice to "we"; keep any `stumpapp/stump` **attribution** links, fix only functional stale links (issues/roadmap) to `SaintedRogue/longbox`.
- [ ] **Step 3:** `yarn workspace @longbox/docs types:check` → exit 0.
- [ ] **Step 4:** `git diff --stat` shows only these three files.
- [ ] **Step 5:** Commit:

```bash
git add docs/content/docs/developer/api.mdx docs/content/docs/developer/cli/account.mdx docs/content/docs/developer/contributing.mdx
git commit -m "docs(developer): voiced framing on api/cli/contributing guides"
```

---

## Task 8: Deep guides — guides/fundamentals

**Files:**

- Modify: `docs/content/docs/guides/fundamentals/background-jobs.mdx`
- Modify: `docs/content/docs/guides/fundamentals/books.mdx`
- Modify: `docs/content/docs/guides/fundamentals/libraries.mdx`
- Modify: `docs/content/docs/guides/fundamentals/progress.mdx`
- Modify: `docs/content/docs/guides/fundamentals/scanner.mdx`
- Modify: `docs/content/docs/guides/fundamentals/series.mdx`
- Modify: `docs/content/docs/guides/fundamentals/tags.mdx`
- Modify: `docs/content/docs/guides/fundamentals/thumbnails.mdx`

- [ ] **Step 1:** Read the voice notes, then all eight files.
- [ ] **Step 2:** Apply the deep-guide recipe. For `libraries.mdx`, use the exact worked example in the voice notes (intro + `» How the shelf gets sorted (supported patterns)`); leave all `<Files>`/`<Tabs>`/`<Steps>` trees and the `<Callout>` about pattern names intact (fold a `FROM THE LONGBOX` label into that callout). `books.mdx` and `series.mdx` may gloss "issue"/"run" once in the intro only.
- [ ] **Step 3:** `yarn workspace @longbox/docs types:check` → exit 0.
- [ ] **Step 4:** `git diff --stat` shows only these eight files.
- [ ] **Step 5:** Commit:

```bash
git add docs/content/docs/guides/fundamentals/
git commit -m "docs(fundamentals): voiced framing on the eight fundamentals guides"
```

---

## Task 9: Deep guides — guides/features (top level)

**Files:**

- Modify: `docs/content/docs/guides/features/api-keys.mdx`
- Modify: `docs/content/docs/guides/features/email.mdx`
- Modify: `docs/content/docs/guides/features/file-explorer.mdx`
- Modify: `docs/content/docs/guides/features/opds.mdx`
- Modify: `docs/content/docs/guides/features/reading-list.mdx`
- Modify: `docs/content/docs/guides/features/smart-list.mdx`
- Modify: `docs/content/docs/guides/features/upload.mdx`

- [ ] **Step 1:** Read the voice notes, then all seven files.
- [ ] **Step 2:** Apply the deep-guide recipe. `opds.mdx` intro is a good spot for the "read your run on any OPDS client / e-ink device" framing; keep all spec links and endpoints exact.
- [ ] **Step 3:** `yarn workspace @longbox/docs types:check` → exit 0.
- [ ] **Step 4:** `git diff --stat` shows only these seven files.
- [ ] **Step 5:** Commit:

```bash
git add docs/content/docs/guides/features/api-keys.mdx docs/content/docs/guides/features/email.mdx docs/content/docs/guides/features/file-explorer.mdx docs/content/docs/guides/features/opds.mdx docs/content/docs/guides/features/reading-list.mdx docs/content/docs/guides/features/smart-list.mdx docs/content/docs/guides/features/upload.mdx
git commit -m "docs(features): voiced framing on the feature guides"
```

---

## Task 10: Deep guides — guides/features/book-clubs

**Files:**

- Modify: `docs/content/docs/guides/features/book-clubs/books.mdx`
- Modify: `docs/content/docs/guides/features/book-clubs/rbac.mdx`
- Modify: `docs/content/docs/guides/features/book-clubs/social-features.mdx`

- [ ] **Step 1:** Read the voice notes, then all three files.
- [ ] **Step 2:** Apply the deep-guide recipe. `rbac.mdx` callouts, if any, suit a `HOUSE RULES` label.
- [ ] **Step 3:** `yarn workspace @longbox/docs types:check` → exit 0.
- [ ] **Step 4:** `git diff --stat` shows only these three files.
- [ ] **Step 5:** Commit:

```bash
git add docs/content/docs/guides/features/book-clubs/books.mdx docs/content/docs/guides/features/book-clubs/rbac.mdx docs/content/docs/guides/features/book-clubs/social-features.mdx
git commit -m "docs(book-clubs): voiced framing on the book-club guides"
```

---

## Task 11: Deep guides — guides/access-control

**Files:**

- Modify: `docs/content/docs/guides/access-control/age-restrictions.mdx`
- Modify: `docs/content/docs/guides/access-control/library-access.mdx`
- Modify: `docs/content/docs/guides/access-control/oidc.mdx`
- Modify: `docs/content/docs/guides/access-control/permissions.mdx`
- Modify: `docs/content/docs/guides/access-control/tag-restrictions.mdx`
- Modify: `docs/content/docs/guides/access-control/users.mdx`

- [ ] **Step 1:** Read the voice notes, then all six files.
- [ ] **Step 2:** Apply the deep-guide recipe. Access-control callouts suit the `HOUSE RULES` label. Keep every permission string, scope name, and OIDC field exact.
- [ ] **Step 3:** `yarn workspace @longbox/docs types:check` → exit 0.
- [ ] **Step 4:** `git diff --stat` shows only these six files.
- [ ] **Step 5:** Commit:

```bash
git add docs/content/docs/guides/access-control/
git commit -m "docs(access-control): voiced framing on the access-control guides"
```

---

## Task 12: Deep guides — guides/configuration

**Files:**

- Modify: `docs/content/docs/guides/configuration/server-config.mdx`

- [ ] **Step 1:** Read the voice notes, then the file.
- [ ] **Step 2:** Apply the deep-guide recipe. This page is env-var/config heavy — **every env var name, default, and code block stays exact**; voice lives only in the intro + section names. Config callouts suit `HOUSE RULES`.
- [ ] **Step 3:** `yarn workspace @longbox/docs types:check` → exit 0.
- [ ] **Step 4:** `git diff --stat` shows only this file.
- [ ] **Step 5:** Commit:

```bash
git add docs/content/docs/guides/configuration/server-config.mdx
git commit -m "docs(config): voiced framing on the server-config guide"
```

---

## Task 13: Deep guides — guides/integrations

**Files:**

- Modify: `docs/content/docs/guides/integrations/kobo.mdx`
- Modify: `docs/content/docs/guides/integrations/koreader.mdx`
- Modify: `docs/content/docs/guides/integrations/metadata-fetching/providers.mdx`

- [ ] **Step 1:** Read the voice notes, then all three files.
- [ ] **Step 2:** Apply the deep-guide recipe. `kobo.mdx`/`koreader.mdx` sync intros suit the "bagged & boarded, read anywhere" framing; keep every sync endpoint and setup step exact. `providers.mdx` — keep provider names/fields exact.
- [ ] **Step 3:** `yarn workspace @longbox/docs types:check` → exit 0.
- [ ] **Step 4:** `git diff --stat` shows only these three files.
- [ ] **Step 5:** Commit:

```bash
git add docs/content/docs/guides/integrations/kobo.mdx docs/content/docs/guides/integrations/koreader.mdx docs/content/docs/guides/integrations/metadata-fetching/providers.mdx
git commit -m "docs(integrations): voiced framing on kobo/koreader/providers guides"
```

---

## Task 14: Final verification (full build + link scan + scope check)

**Files:** none modified — verification only.

- [ ] **Step 1: Full docs build**

Run: `cd /home/rogue/longbox && yarn workspace @longbox/docs build`
Expected: build completes with exit 0 (all MDX compiled and bundled).

- [ ] **Step 2: Internal-link scan**

Confirm no internal `/docs/...` link was broken by heading renames. Run:

```bash
cd /home/rogue/longbox
grep -rhoE '\]\(/docs/[^)#]+' docs/content | sed -E 's/^\]\(//' | sort -u
```

For each printed path, confirm a matching file exists under `docs/content` (paths map to `.mdx`; section roots map to their `index.mdx`). Any path with no file is a broken link — fix the link, re-run `types:check`, and amend the relevant commit.

- [ ] **Step 3: Scope check — no product source touched**

Run:

```bash
cd /home/rogue/longbox
git diff --name-only main | grep -vE '^(README\.md|docs/)' || echo "SCOPE OK — only README + docs changed"
```

Expected: `SCOPE OK — only README + docs changed` (no other paths printed).

- [ ] **Step 4: Attribution preserved**

Run:

```bash
cd /home/rogue/longbox
grep -qF 'Longbox is a fork of [**Stump**](https://github.com/stumpapp/stump)' README.md \
  && grep -qF 'fork of [Stump](https://github.com/stumpapp/stump)' docs/content/docs/index.mdx \
  && echo "ATTRIBUTION PRESERVED" || echo "ATTRIBUTION MISSING — INVESTIGATE"
```

Expected: `ATTRIBUTION PRESERVED`

- [ ] **Step 5: Voice consistency spot-check**

Open three random deep guides and confirm each has: a voiced intro, at least one voiced/glossed section name where headings weren't self-evident, and an untouched step-by-step body. No page should have the loud comic-shop register (that's README-hero-only).

- [ ] **Step 6: Final review handoff**

Report the branch (`docs/voice-rebuild`), commit count, and the `git diff --stat main` summary for the user to review before merge.

---

## Self-Review

**Spec coverage:**

- Voice codified (`docs/longbox-voice-notes.md`) → Task 1. ✅
- README full voice, commands/License verbatim → Task 2 (with grep assertions). ✅
- Overview full voice + de-Stump (roadmap link, star-history removal, "I"→"we") → Task 3. ✅
- Remaining chrome pages full voice → Task 4. ✅
- Deep guides voiced framing/neutral body (all 37, enumerated) → Tasks 5–13. ✅
- MDX validity, internal links, no source touched, attribution preserved → Task 14. ✅
- Fixed caption-box label set, markdown-vs-MDX callout rule → Global Constraints + Task 1. ✅

**Placeholder scan:** Flagship surfaces (voice-notes, README, Overview) and the small chrome pages carry full final content. Deep-guide tasks reference a complete recipe (defined once, with a full worked example in Task 1) rather than "TBD" — the recipe is the actual instruction, not a placeholder. Two chrome files (`developer/cli/index.mdx`, `book-clubs/index.mdx`) are handled by "read-then-apply-recipe" because they weren't pre-imaged; their recipe is fully specified. ✅

**Type/name consistency:** Validity command is `yarn workspace @longbox/docs types:check` everywhere; full build is `yarn workspace @longbox/docs build`. Label set is identical across Global Constraints, Task 1, and the deep-guide tasks. Branch name `docs/voice-rebuild` is consistent. ✅
