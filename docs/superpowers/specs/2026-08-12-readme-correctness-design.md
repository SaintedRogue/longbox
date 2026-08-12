# README correctness, and standing on our own

Make the README true, make its links work, and describe Longbox without reference
to the project it forked from.

Second of three specs for the documentation refresh. The first replaced the
[image set](./2026-08-12-image-set-refresh-design.md); the third rewrites
`docs/content`.

## Why

The README is the front door, and it is currently wrong in four ways that a
visitor can catch.

### Six links that 404

Every link into the docs is root-relative — `](/docs/content/docs/...)`. GitHub
leaves those alone, so they resolve against `github.com`, not the repository.
Confirmed against GitHub's own markdown API: `/docs/…` renders as `href="/docs/…"`
while `./docs/…` resolves correctly. Affected: the docs index (twice), `kobo.mdx`,
`koreader.mdx`, `themes.mdx`, `installation/index.mdx`, `developer/contributing.mdx`.

### Three false claims

| Claim                                         | Reality                                                                                     |
| --------------------------------------------- | ------------------------------------------------------------------------------------------- |
| "Full offline downloads are on the pull list" | Shipped. `packages/browser/src/offline/`, `DownloadsScene.tsx`, `OfflineDownloadButton.tsx` |
| "book details open as a **peek overlay**"     | Reversed by `ADR-0002`, "Book detail is a page, not a peek overlay"                         |
| Metadata: a Metron provider                   | Metron, ComicVine and League of Comic Geeks, plus a multi-source enrichment pool            |

The offline one is the worst of the three: it tells a reader that a finished
feature does not exist.

### Contributors are sent to another project

`.github/pull_request_template.md` links twice to
`stumpapp/stump/blob/main/.github/CONTRIBUTING.md`. Longbox has its own
`.github/CONTRIBUTING.md`.

### It is framed as a fork throughout

Eight mentions across the tagline, an entire comparative section, and the
attribution. Longbox left the fork network on 2026-08-12.

## Decisions taken

- **No mention of Stump in the README.** MIT requires the copyright and permission
  notice be retained, and `LICENSE` does retain `Copyright (c) 2022 Aaron Leopold`
  — so the licence is satisfied by that file alone. The README describes Longbox on
  its own terms.
- **`CLAUDE.md` and the voice notes are corrected in the same pass**, because both
  currently instruct a future session to reintroduce what this removes.

## Changes

### `README.md`

1. **Tagline** — ends at "full OPDS support".
2. **Merge the two feature sections.** "What's in this box that Stump's isn't" and
   "What's inside" existed only to separate ours from inherited. With the comparison
   gone the split has no meaning, so they become one grouped list — reading and
   formats, metadata, offline and installability, navigation, access and sharing,
   server. This also gives the shipped features that are currently missing
   (release calendar, search, the loose-file organizer, collections, characters,
   scheduled jobs) somewhere to live.
3. **Correct the three claims**, citing `ADR-0002` for the navigation one.
4. **Root-relative links become `./`-relative.**
5. **License section** keeps the MIT statement and drops the credit line.
6. **Table of contents** regenerated against the new headings.

### `CLAUDE.md`

The attribution rule currently reads "don't 'fix' those to Longbox" over a list
that includes the "fork of Stump" credit. Rewrite it to distinguish what is
retained — the MIT `LICENSE` with its upstream copyright, and the `crates/email`
sample data — from the comparative framing that has been deliberately removed, and
note that the repository has left the fork network.

### `docs/longbox-voice-notes.md`

The lexicon lists "pulled / the pulled issue" as meaning "the active book / peek
overlay", marked "established brand motif". `ADR-0002` removed the peek overlay, so
the motif is re-pointed at the active book alone.

### `.github/pull_request_template.md`

Both contributing links point at this repository's own guidelines.

## Verification

1. Every link in the README resolved: file links checked against the filesystem,
   and the rendered output checked through GitHub's markdown API so root-relative
   regressions are caught rather than assumed.
2. `grep -ci stump README.md` returns 0.
3. Each retained claim checked against the code that implements it.
4. `yarn lint`, and prettier over the markdown — lint-staged covers `docs/**` and
   the repository root, which `yarn lint` does not.

## Out of scope

The 54 Stump mentions across fifteen `docs/content` pages, the nine missing feature
pages, and 2,727 lines of obsolete working documents. All belong to spec 3, which
rewrites those files — editing them here would mean touching them twice.
