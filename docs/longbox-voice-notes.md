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
  - `MINT CONDITION` — data safety, backups
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
