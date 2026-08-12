# Image set refresh

Replace the six Stump-era image assets still shipping in this repository with a
Longbox set, captured from the running server by a committed script.

## Why

Longbox left the `stumpapp/stump` fork network on 2026-08-12. Six image assets did
not come with it in spirit — every one traces by `git log --follow` to an upstream
commit, and they are what a visitor sees first:

| File                                                | Where it surfaces               | What it shows                                   |
| --------------------------------------------------- | ------------------------------- | ----------------------------------------------- |
| `docs/public/og.png`                                | Social card for any shared link | Stump wordmark, logo, tagline, `localhost:3000` |
| `docs/public/favicon.ico`                           | Docs site tab                   | Stump's mark                                    |
| `docs/public/favicon.png`                           | Docs site tab                   | Stump's mark                                    |
| `docs/public/images/landing-dark.png`               | README hero + docs `Hero.tsx`   | Stump's UI, an "Invincible (2003)" library      |
| `docs/public/images/landing-light.png`              | docs `Hero.tsx` (light theme)   | as above                                        |
| `docs/public/images/smart-list-example-filters.png` | `smart-list.mdx`                | Stump's UI (traces to upstream #490)            |

`og.png` is the most damaging: it carries Stump's name and logo, so sharing a
Longbox docs link in Slack or Discord renders a Stump card.

The landing screenshots are also simply wrong now — captured before the reader,
the release calendar, the metadata review grid, and the omnibus shelf existed.

## The deliverable is a script, not a folder of PNGs

`docs/superpowers/plans/2026-07-17-stump-to-longbox-rebrand.md` contains this,
still unchecked:

> `- [ ] Step 1: Capture landing-dark.png / landing-light.png (theme-switched) at ~1600px wide from the running app.`

The task has been attempted once and abandoned, because a manual capture session
is tedious and invisible once skipped. So the artefact that lands is a **committed,
re-runnable capture script**, and the PNGs are its output. Screens can then be
refreshed per release instead of decaying for another year.

## Decisions taken

- **The screenshots show the real library.** Publisher cover art appears in project
  imagery, as it does for Stump, Kavita and Komga. Explicitly the owner's call.
- **The hero is a desktop + phone composite**, because a single installable PWA
  covering desktop and mobile is a real differentiator worth showing in one frame.
- **Six screens**: hero, omnibus shelf, reader, metadata review, library browse,
  release calendar.

## Architecture

### `scripts/screenshots/capture.py`

Playwright (python; already installed) against a server named by
`LONGBOX_SCREENSHOT_URL`. Point it at the server's own address rather than the
public hostname — that answers directly and removes the reverse proxy as a
variable. Taking the host from the environment also keeps a private address out of
this repository, which is public.

Authentication is REST: `POST /api/v2/auth/login` with credentials read from
`longbox.env`. That file is gitignored and holds real secrets — it is read, never
echoed and never committed, and the script takes credentials from the environment
so it carries none itself.

Two viewports, both at device scale factor 2 so the output is crisp on retina:

| Target  | Viewport    |
| ------- | ----------- |
| desktop | 1600 × 1000 |
| phone   | 390 × 844   |

Per screen the script navigates, waits for cover images to finish decoding (not
merely for the network to idle — covers arrive lazily), then captures. Raw output
goes to a gitignored scratch directory; only the finished assets are committed.

### `scripts/screenshots/hero.html`

The composite is HTML screenshotted by Playwright rather than an image-library
montage: there is no ImageMagick on the build box, and expressing the device frames
as CSS means they are versioned as source rather than baked into pixels.

The phone sits **beside** the desktop frame's lower left with a deliberate gutter,
overlapping only the desktop's own bezel. Stump's composite overlapped the content
area, which is what clipped "Invincible v03 — Perfect Strangers" mid-word and left
a truncated `oromei` username visible in the sidebar.

### Output

Committed to `docs/public/`, keeping the existing filenames so `Hero.tsx` needs no
change:

- `images/landing-dark.png`, `images/landing-light.png` — hero composite, both
  themes. Both are required: `Hero.tsx` selects on `resolvedTheme` and preloads the
  opposite one.
- `images/omnibus-shelf.png`, `images/reader.png`, `images/metadata-review.png`,
  `images/library-browse.png`, `images/release-calendar.png` — dark only. Left in
  place for the documentation build-out to consume.
- `images/smart-list-example-filters.png` — recaptured, same filename, same
  reference from `smart-list.mdx`.
- `og.png` — 1200 × 630, composed from `.github/images/logo.svg` and the hero
  capture. The logo is Longbox's own, so the card is built from the real brand
  rather than invented.
- `favicon.png` and `favicon.ico` — derived from `.github/images/logo.svg`.

### Size budget

Palette-quantised PNG via PIL, target **≤400 KB** per image. The current hero is
1.1 MB, which is the largest file in the repository's docs assets.

## Wiring

- README hero: same path, so only the `alt` text changes — it currently reads
  "Screenshot of Longbox", which is accurate but wasted.
- `docs/src/components/landing/Hero.tsx`: no change, filenames preserved.
- `docs/content/docs/guides/features/smart-list.mdx`: no change, filename preserved.

## Verification

1. Every generated image opened and inspected before commit: no Stump wordmark, no
   clipped text, no truncated usernames, the intended theme, covers fully loaded.
2. `git log --follow` over every file in `docs/public/` to prove none still traces
   to an upstream Stump commit.
3. `yarn lint` and the documentation CI check, since `docs/` is in the frontend
   change-gate.
4. Prettier via lint-staged covers `docs/**`, which `yarn lint` does not — a
   hand-written markdown file fails the pre-commit hook otherwise.

## Out of scope

This is the first of three specs agreed for the documentation refresh:

1. **This one** — the image set.
2. **README correctness and de-forking** — six root-relative `/docs/...` links that
   GitHub resolves to `github.com/docs/...` and 404s; the claim that offline
   downloads are "on the pull list" when they shipped; the "peek overlay" feature
   that `ADR-0002` reversed; the metadata section naming only Metron.
3. **Documentation build-out** — nine feature areas with no page at all (release
   calendar, search, loose-file organizer, offline downloads, characters,
   collections, scheduled jobs, enrichment pool, omnibus shelf), the comparative
   Stump framing across fifteen `docs/content` pages, and 2,727 lines of obsolete
   working documents, two of which the README links to.

Spec 3 absorbs the de-forking of `docs/content` so those fifteen files are rewritten
once rather than edited twice.
