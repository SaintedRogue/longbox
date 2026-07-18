# README & Documentation Voice Rebuild — Design

**Date:** 2026-07-18
**Status:** Approved (design), pending spec review
**Author:** Michael Ahrendt (with Claude)

---

## Goal

Rebuild the README and documentation around a distinctive, consistent voice that
captures Longbox's ethos — a self-hosted comics/manga/book server built for
people who _own_ their collection. Develop a reusable "way of speaking" (a verbal
identity) and apply it, so ~45 doc pages plus the README sound like one person
wrote them, while staying accurate and usable.

This is a **prose/voice** rebuild. No product code, Rust, or TypeScript source is
touched. Only Markdown/MDX content and one new voice-notes doc.

---

## The three settled decisions

1. **Scope** — Full voice on the README and the docs "chrome" (overview/landing
   pages, section intros, taglines, callouts). Deep technical guides keep the
   voice in their _framing_ (intro sentence, section names, caption-box asides)
   but the step-by-step **body stays clear and neutral**. De-Stump every page
   touched along the way.
2. **Voice** — **The Longbox Archivist**: warm, tactile, preservation-minded,
   ownership-first. Absorbs loud comic-shop lettering only in the README hero and
   one divider splash; grounded by self-host ownership substance.
3. **Staging** — **Tasteful devices**: caption-box blockquote callouts, one
   recurring panel divider, voiced section names with a plain-language gloss. No
   ASCII sound-effects scattered around.

---

## Part 1 — The voice, codified (`docs/longbox-voice-notes.md`)

New file, the verbal companion to the existing visual identity in
`docs/longbox-design-notes.md`. This is the source of truth every rewrite follows.

**Ethos, one sentence:** _Longbox treats the digital comics you own the way a
collector treats the physical ones — bagged, boarded, filed, and yours — and runs
entirely on your own hardware._

### The lexicon

Metaphor **seasons**; it never renames real product nouns. In instructions, the
real UI concept (Library, Series, Book, Collection, Reading List, Smart List)
always wins; the comic word is a one-time gloss, not a rename.

| Comic word                               | Used for                                 | Guardrail                                                                   |
| ---------------------------------------- | ---------------------------------------- | --------------------------------------------------------------------------- |
| your longbox / the shelf                 | the whole running server                 | —                                                                           |
| issue · run                              | a book · a series                        | Instructions keep real nouns; gloss once ("a series — your run of a title") |
| bagged & boarded                         | offline durability, backups, data safety | —                                                                           |
| pulled / the pulled issue                | the active book / peek overlay           | already an established brand motif                                          |
| your box, your rules · no cloud landlord | the self-host ownership pitch            | the "why," carried in plain language                                        |
| cracking the box / the spine             | getting started, first run               | —                                                                           |

### Signature devices

- **Caption-box callouts** — `> **LABEL** — one line.` Fixed label set (do not
  invent new labels ad hoc):
  - `MINT CONDITION` — data safety, backups
  - `BAGGED & BOARDED` — offline, durability, sync-on-reconnect
  - `PULL LIST` — roadmap / planned work
  - `HOUSE RULES` — configuration, permissions, access control
  - `CONTINUITY` — compatibility, requirements, attribution
  - `FROM THE LONGBOX` — tips / nice-to-know asides
- **Panel divider** between major README sections: `— · — · —`
- **Voiced section names with a plain gloss**, so scannability survives:
  `## » Cracking the box open (getting started)`

### Register rules

- **Everyday:** warm archivist — "you" (the collector), "we" (the project).
- **Loud (comic-shop lettering):** allowed **only** in the README hero tagline and
  one divider splash. Never in guide bodies.
- **Deep-guide bodies:** neutral, clear, imperative. Voice lives only in the intro
  sentence, caption-box asides, and section names.

### Hard don'ts

- Don't rename real product concepts in step-by-step text.
- Don't bury a required step under a metaphor.
- Don't carry meaning in ASCII art alone — the caption-box **label is always real
  text** (screen-reader safe).
- **Don't touch upstream attribution.** The fork-of-Stump credit, the MIT
  `LICENSE`, and attribution links to `stumpapp/stump` stay exactly as they are
  (per `CLAUDE.md`).
- Don't invent product behavior to fit a metaphor. Accuracy wins.

---

## Part 2 — README rebuild map

Structure stays (it's well-organized). Banner + badges stay as-is (already on the
amber/teal/ink palette). Voice changes; a few functional links get fixed.

1. **Hero tagline** → _"Your comics, bagged, boarded, and served. A self-hosted
   longbox for every issue you own."_
2. **What is Longbox?** → voiced; keeps the honest fork origin.
3. **What's different in this fork** → same 6 differentiators; headers reworded to
   voice (e.g. "One longbox, everywhere," "Bagged & boarded offline reading").
4. **No beta notice.** The old beta warning is dropped from the README front
   door; `MINT CONDITION` stays in the label set for data-safety/backup asides.
5. **Features · Getting Started · Developer Guide · Repository Structure** → voiced
   framing + section names. **All commands, paths, and code fences stay
   byte-for-byte exact.**
6. **Similar Projects** → voiced intro ("If your box isn't for you…"); list
   unchanged.
7. **License & Attribution** → **unchanged, verbatim.**

---

## Part 3 — Docs rebuild plan

### Full voice ("chrome")

- `docs/content/docs/index.mdx` (Overview)
- Section landing/index pages: `getting-started/installation/index.mdx`,
  `apps/web/index.mdx`, the `guides/*` landing pages, `developer` landing.
- `docs/README.md`

### De-Stump as I go

- Reframe the Overview's first-person "I" (original author) into the fork's "we" +
  honest origin.
- **Fix functional stale links:** the roadmap and `star-history` links currently
  point at `stumpapp/stump`. Roadmap → `SaintedRogue/longbox/issues`. The
  `star-history` growth chart of _upstream_ is misleading for the fork — replace
  it with the roadmap/issues link rather than repoint the chart.
- **Attribution links stay.** Distinguish functional links (fix) from attribution
  links (keep).

### Voiced-framing-only (deep guides, ~40 pages)

Each deep guide gets:

- a voiced one-line intro,
- voiced section names where natural,
- caption-box asides where a callout already exists or naturally fits,

…while the **step-by-step body stays clear and neutral** — no renamed concepts,
no buried steps. Likely fanned out across parallel agents during implementation,
all following `docs/longbox-voice-notes.md`.

### Guardrails throughout

- Technical accuracy is king; no invented behavior.
- No product/source files touched.
- MDX components (`<Callout>`, `<Steps>`, `<Files>`, `<Tabs>`) preserved and valid.
- Preserve upstream attribution everywhere.

---

## Success criteria

- `docs/longbox-voice-notes.md` exists and is committed; it fully defines the
  lexicon, devices, register, and don'ts above.
- README reads in the Archivist voice end to end; all commands/paths/code fences
  unchanged; License & Attribution verbatim.
- Every "chrome" doc page reads in full voice; no first-person Stump-author "I"
  remains; functional stale `stumpapp/stump` links fixed; attribution links kept.
- Every deep guide has voiced framing (intro + section names + asides) with a
  neutral, accurate body.
- Docs site still builds (MDX valid); no broken internal links introduced.
- No product code changed.

---

## Out of scope

- Any Rust/TypeScript source changes.
- New brand artwork or logo changes (visual identity is already settled).
- New documentation _content_/features (this is a voice rebuild of existing
  content, not new guides).
- Translations / i18n of the new voice.
