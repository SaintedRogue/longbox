# Image Set Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the six Stump-era image assets with a Longbox set, produced by a committed, re-runnable capture script.

**Architecture:** A Python script drives Playwright against a running Longbox server, authenticating over the REST login endpoint and discovering library and book ids through GraphQL rather than hardcoding them. Raw captures land in a gitignored scratch directory; a second step composes the hero from an HTML template (device frames as CSS, screenshotted by Playwright) because there is no ImageMagick on this machine; a third quantises everything with PIL to meet the size budget.

**Tech Stack:** Python 3, playwright (python, installed), PIL 12.3, curl for probing. No new dependencies.

## Global Constraints

- Server URL comes from `LONGBOX_SCREENSHOT_URL`; never hardcode a private address — this repository is public.
- Credentials come from `longbox.env` (keys `url`, `user`, `pass`). That file is gitignored and holds real secrets: read it, never echo it, never commit it.
- Every committed PNG must be ≤400 KB.
- Committed filenames must not change: `docs/src/components/landing/Hero.tsx` selects `landing-dark.png`/`landing-light.png` by theme, and `smart-list.mdx` references `smart-list-example-filters.png`.
- Device scale factor 2 on all captures.
- Raw captures go to `.screenshots-scratch/` which must be gitignored.
- Prettier via lint-staged covers `docs/**` and `scripts/**`; run `npx prettier --write` on any markdown before committing or the pre-commit hook reverts the whole staged change.

## Known-good values (discovered 2026-08-12 against prod)

- Library: `89c32dc0-4b01-4b63-8135-c28b30909683` ("Comics")
- Book with rich metadata and 847 pages: `dc308110-2694-44fb-aaa7-ad13e80c0579` ("Absolute Carnage Omnibus")
- `media(filter:{isOmnibus:true})` returns 334 books — the omnibus shelf is populated.
- `orderBy` is a oneof: `orderBy:[{field:NAME,direction:ASC}]` is **rejected**. Omit `orderBy` entirely.

---

### Task 1: Capture script with auth, discovery, and one screen

**Files:**

- Create: `scripts/screenshots/capture.py`
- Modify: `.gitignore` (add `.screenshots-scratch/`)

**Interfaces:**

- Consumes: nothing.
- Produces: `capture.py` exposing `login(base_url, user, password) -> dict[str,str]` returning cookies, `discover(base_url, cookies) -> dict` returning `{"library_id": str, "book_id": str}`, and `capture(page, name, path, viewport)` writing `.screenshots-scratch/<name>.png`.

- [ ] **Step 1: Add the scratch dir to .gitignore**

```
.screenshots-scratch/
```

- [ ] **Step 2: Write the script**

Read credentials from `longbox.env`, log in over REST, discover ids over GraphQL, then capture the library browse screen at desktop size.

Key details that will otherwise cost time:

- Login is `POST /api/v2/auth/login` with `{"username","password"}` JSON, and sets a session cookie. GraphQL is at `/api/graphql` (not `/api/v2/graphql`).
- Covers load lazily, so `wait_until="networkidle"` is not enough. Wait for every `img` in the viewport to report `complete && naturalWidth > 0`.
- The sidebar shows the logged-in username; that is what produced the truncated `oromei` in Stump's shot. Nothing to fix, just verify it reads sensibly.

- [ ] **Step 3: Run it and confirm one PNG lands**

```bash
LONGBOX_SCREENSHOT_URL=http://<server>:10801 python3 scripts/screenshots/capture.py --only library-browse
```

Expected: `.screenshots-scratch/library-browse.png` exists, is a PNG, and is more than 100 KB.

- [ ] **Step 4: Open it and check it**

Read the PNG. Expected: the Comics library, real covers loaded (not placeholder blocks), no Stump wordmark, no clipped text.

- [ ] **Step 5: Commit**

```bash
git add scripts/screenshots/capture.py .gitignore
git commit -m "feat(screenshots): capture script with auth and discovery"
```

---

### Task 2: The remaining flat screens

**Files:**

- Modify: `scripts/screenshots/capture.py`

**Interfaces:**

- Consumes: `capture()`, `discover()` from Task 1.
- Produces: `SCREENS: list[Screen]` where `Screen` has `name: str`, `path: str`, `viewport: str` (`"desktop"` or `"phone"`), and optional `prepare: Callable[[Page], None]`.

- [ ] **Step 1: Add the screen table**

| name               | path                                |
| ------------------ | ----------------------------------- |
| `library-browse`   | `/libraries/{library_id}/series`    |
| `omnibus-shelf`    | `/libraries/{library_id}/omnibuses` |
| `release-calendar` | `/calendar`                         |
| `reader`           | `/books/{book_id}/reader`           |
| `book-detail`      | `/books/{book_id}`                  |

Also capture `omnibus-shelf` and `book-detail` at phone viewport, named `<name>-phone`, for the hero composite.

- [ ] **Step 2: Run all of them**

```bash
LONGBOX_SCREENSHOT_URL=http://<server>:10801 python3 scripts/screenshots/capture.py
```

Expected: seven PNGs in `.screenshots-scratch/`.

- [ ] **Step 3: Open each and check it**

Read every PNG. The reader especially: confirm a comic page actually rendered rather than a spinner. If the reader shows a loading state, increase its settle wait rather than accepting it.

- [ ] **Step 4: Commit**

```bash
git add scripts/screenshots/capture.py
git commit -m "feat(screenshots): capture the reader, omnibus shelf and calendar"
```

---

### Task 3: The hero composite

**Files:**

- Create: `scripts/screenshots/hero.html`
- Modify: `scripts/screenshots/capture.py`

**Interfaces:**

- Consumes: `.screenshots-scratch/library-browse.png` and `.screenshots-scratch/omnibus-shelf-phone.png`.
- Produces: `.screenshots-scratch/landing-dark.png` and `landing-light.png`, 2560 px wide.

- [ ] **Step 1: Write the HTML template**

Two CSS device frames on a transparent background: a desktop window (rounded corners, thin bezel, drop shadow) holding the desktop capture, and a phone (rounded corners, thicker bezel) holding the phone capture. The phone sits at the desktop frame's lower-left, offset so it overlaps **only the desktop bezel**, never its content area. Images are embedded as `file://` URLs so no server is needed.

- [ ] **Step 2: Screenshot the template**

Playwright loads `hero.html` with a transparent background (`omit_background=True`) and screenshots the composite element.

- [ ] **Step 3: Open it and check the overlap**

Read the PNG. Expected: no text clipped by the phone, both frames fully visible, no cropped edges. This is the exact defect in Stump's version — the phone covered "Invincible v03 — Perfect Strangers" mid-word.

- [ ] **Step 4: Produce the light variant**

Re-run capture with the app in light theme, then re-compose. Theme is a user preference, so set it through the UI or preferences API rather than a URL parameter.

- [ ] **Step 5: Commit**

```bash
git add scripts/screenshots/hero.html scripts/screenshots/capture.py
git commit -m "feat(screenshots): compose the hero from CSS device frames"
```

---

### Task 4: Social card and favicons

**Files:**

- Create: `scripts/screenshots/branding.py`
- Modify: `docs/public/og.png`, `docs/public/favicon.png`, `docs/public/favicon.ico`

**Interfaces:**

- Consumes: `.github/images/logo.svg`, `.github/images/banner.png`, `.screenshots-scratch/landing-dark.png`.
- Produces: `docs/public/og.png` (1200×630), `docs/public/favicon.png` (512×512), `docs/public/favicon.ico` (multi-size).

- [ ] **Step 1: Build the og card**

1200×630, Longbox's dark brand background, the logo lockup, the tagline "Your comics, bagged, boarded, and served." (matching the README), and the hero capture bleeding off the bottom edge. Render as HTML + Playwright for text control, matching the hero approach.

- [ ] **Step 2: Build the favicons**

Rasterise `logo.svg` at 512×512 for `favicon.png`; write `favicon.ico` with 16/32/48 sizes via PIL's `save(..., sizes=[...])`.

- [ ] **Step 3: Open all three and check them**

Read each. Expected: Longbox mark, no Stump robot, legible at 16 px for the ico.

- [ ] **Step 4: Commit**

```bash
git add scripts/screenshots/branding.py docs/public/og.png docs/public/favicon.png docs/public/favicon.ico
git commit -m "feat(branding): replace the Stump social card and favicons"
```

---

### Task 5: Optimise and install the assets

**Files:**

- Modify: `scripts/screenshots/capture.py` (add `--install`)
- Modify: `docs/public/images/*.png`
- Modify: `README.md:20` (alt text only)

**Interfaces:**

- Consumes: everything in `.screenshots-scratch/`.
- Produces: the committed asset set under `docs/public/`.

- [ ] **Step 1: Quantise with PIL**

Convert to palette mode with `Image.quantize(colors=256, method=Image.MEDIANCUT)` and save with `optimize=True`. Assert each output is ≤400 KB; fail loudly rather than committing a 1 MB file.

- [ ] **Step 2: Copy into place**

`landing-dark.png`, `landing-light.png`, `omnibus-shelf.png`, `reader.png`, `library-browse.png`, `release-calendar.png`, `smart-list-example-filters.png` into `docs/public/images/`.

- [ ] **Step 3: Update the README alt text**

Current: `alt="Screenshot of Longbox"`. Replace with something that describes the composite for a screen reader, e.g. `alt="Longbox on desktop and phone — the omnibus shelf and library browse"`.

- [ ] **Step 4: Verify no Stump provenance remains**

```bash
git ls-files 'docs/public/**' | while read f; do
  printf '%-56s ' "$f"; git log -1 --format='%s' -- "$f" | cut -c1-40
done
```

Expected: no row attributing a `docs/public` asset to an upstream Stump commit.

- [ ] **Step 5: Check sizes**

```bash
find docs/public -name '*.png' -size +400k
```

Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add docs/public README.md scripts/screenshots/capture.py
git commit -m "feat(images): a Longbox image set, captured from the running app"
```

---

### Task 6: Gate and ship

**Files:** none new.

- [ ] **Step 1: Run the frontend gate**

```bash
export PATH="$HOME/.npm-global/bin:$PATH"
yarn lint
```

Expected: exit 0. `docs/` is inside the frontend change-gate, so this must pass.

- [ ] **Step 2: Confirm the smart-list page still resolves its image**

```bash
grep -n 'smart-list-example-filters' docs/content/docs/guides/features/smart-list.mdx
ls -la docs/public/images/smart-list-example-filters.png
```

- [ ] **Step 3: Open a PR and merge after CI**

The documentation check is the relevant gate; Rust jobs will skip.

---

## Self-review

**Spec coverage:** capture script → Task 1–2; HTML composite → Task 3; og/favicons → Task 4; size budget and wiring → Task 5; verification (image inspection, `git log --follow` provenance, lint) → Tasks 1–6. The spec's "metadata review" screen is **deliberately deferred** — it requires triggering a live provider search whose ComicVine key is known to return 401, so it belongs with the documentation build-out that will actually use it. That is a scope reduction against the spec and must be called out to the user rather than silently dropped.

**Placeholders:** none. Every step names its command or its content.

**Type consistency:** `capture(page, name, path, viewport)` and `SCREENS` entries use `name`/`path`/`viewport` consistently across Tasks 1, 2, 3 and 5; output filenames in Task 5 match those in Tasks 2–3.
