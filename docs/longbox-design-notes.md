# Longbox visual identity notes

Later UI work should extend this direction, not restart it.

## Concept: "the longbox as physical object"

The brand object is the comic longbox — the long cardboard box collectors store
bagged-and-boarded issues in. The logo is a hand-drawn **line-mark**: an
isometric longbox rendered as a clean open wireframe (five visible faces — left
end, front, lid top, lid front rim, lid left rim — plus a handle slot), no
fills. It reads as a single crisp glyph at any size on any background.

> Supersedes the earlier amber filled-box "badge" concept (Wave 1→2). The
> line-mark is the canonical logo from the icon pack in
> `~/Downloads/longbox_icon_design.zip`; the amber-cardboard _identity_ carries
> forward, the specific filled artwork does not.

## Logo files

- `.github/images/logo.svg` — master line-mark (200 viewBox, `stroke="currentColor"`,
  no container). The one source of truth; recolor by setting `color`/`stroke`.
- `.github/images/logo-lockup.svg` — mark + "longbox" wordmark stacked (Archivo
  800). ⚠️ Uses live `<text>` — renders correctly only where Archivo is loaded.
  **Outline the text before using in production** (no Archivo/fonttools was
  available when this landed, so it stays as a live-text source asset; the app
  itself never uses it — it renders "Longbox" as its own styled heading).
- `.github/images/logo.png` — a self-contained ink-tile render for the README
  (opaque, so it reads on both GitHub light/dark themes).
- `packages/components`/`packages/browser` in-app glyph:
  `packages/browser/src/components/LongboxMark.tsx` inlines the mark as
  `stroke="currentColor"`, so login header + mobile top bar adopt the active
  theme's foreground automatically — no per-theme asset. `simplified` drops the
  handle slot for small sizes.
- `packages/browser/public/assets/longbox-{16,180,192,512}.png`,
  `longbox-512-maskable.png`, `longbox-mark.png`, `longbox.ico` — filled app-icon
  tiles rasterized from the mark via rsvg-convert: **ink `#211d18` rounded tile +
  cream `#f3efe8` mark**. `longbox-16.png` and the small `.ico` sizes drop the
  handle slot (illegible < ~24px); `-maskable` is full-bleed square with the
  mark at ~60% (Android safe zone); `-180` is square (Apple applies its own
  mask). Named `longbox-*` (not `favicon-*`) deliberately: `/assets` is served
  immutable for a year and these files aren't content-hashed, so any future art
  change must also **rename** the files to bust returning browsers' caches.
- `packages/browser/public/assets/longbox-splash.svg` — the ink-tile mark with a
  SMIL opacity pulse, used as the app-shell loading splash.

## Palette

From the icon pack handoff. In-app UI keeps using the existing theme tokens; the
palette below is for brand assets and may inform (not replace) accent choices.

| Role              | Hex       | Usage                                                   |
| ----------------- | --------- | ------------------------------------------------------- |
| Ink               | `#211d18` | default mark on light bg; app-icon tile background      |
| Cream             | `#f3efe8` | reversed mark on dark/brand bg; neutral tile background |
| Amber (cardboard) | `#d98a3d` | primary brand accent; recommended alt tile background   |
| Teal              | `#2f6f6a` | secondary accent; alt tile background                   |

Recommended container backgrounds (rounded square, radius ≈ 22% of size):
neutral cream, amber, teal, or ink (use the reversed cream mark on amber/teal/ink).
The shipped app-icon/favicon tiles use **ink + cream mark**; the manifest
`background_color` matches (`#211d18`) so PWA launch doesn't flash white.

## Sizing & clear space

- Legible down to ~24px; below that, drop the handle-slot detail (`simplified`
  on `LongboxMark`, or the small `.svg` variants for rasters).
- Keep clear space ≈ the lid height (~⅕ of icon height) on all sides.
- Scale via `width`/`height` / `h-*`/`w-*`, never by editing paths.

## Motifs for UI work

- "Pulled issue": the peek overlay is the pulled issue — a restrained left-edge
  accent + subtle tilt-in entrance (shipped in Stream D, below). No skeuomorphism.
- Geometry: the mark is all straight strokes + rounded joins; echo that with
  rounded-join line icons and clean isometric framing where a brand cue helps.
- Both light and dark themes must work: the in-app glyph is `currentColor`, and
  filled brand tiles carry their own ink background — never place a cream mark on
  white without its tile.

## Applied: the book peek overlay (Stream D)

First real UI surface built on this identity, in
`packages/browser/src/scenes/book/BookPeekSheet.tsx` +
`BookOverviewContent.tsx` (`variant="sheet"`). Decisions below extend rather
than restate the motifs above — read those first.

- **"Pulled issue" edge, not a top bar.** The sheet slides in from the right
  (`position="right"`), so the seam where it visually separates from the
  "box" (the still-mounted browse grid behind it) is its **left** edge, not
  its top. That edge gets a `border-l-2 border-l-brand-500/70` accent instead
  of the shared `Sheet`'s neutral `border-border/80` — a thin terracotta-ish
  seam, using the static `brand-*` scale (`--color-brand-500`, `#c48259`)
  rather than a per-theme token on purpose: it's meant to read as the same
  accent color regardless of which of the 8 themes is active, the same way
  the top-loading progress bar (`#nprogress .bar`, `bg-brand-500`) already
  does. This is the one deliberate "brand constant" in an otherwise
  full-theme-token surface — don't reach for it as a general-purpose accent
  color in unrelated UI; it's specifically the "this is the pulled/active
  issue" signifier established here and by the progress bar.
- **Tilt-in entrance, composed not bespoke.** Rather than a new `@keyframes`,
  the tilt rides tw-animate-css's existing `enter` composition: the shared
  `sheetVariants` already sets `data-[state=open]:animate-in
data-[state=open]:slide-in-from-right`; BookPeekSheet's own `className`
  adds `data-[state=open]:spin-in-2` on top (sets `--tw-enter-rotate: 2deg`,
  combined into the same `enter` keyframe alongside the translate/opacity
  already in play — no extra animation, no new CSS). 2° reads as "settling
  into place," not a gimmick; brand assets use 7–9° tilts but that's for
  static artwork, not motion applied to real content full of text and
  controls. This override is scoped to `BookPeekSheet`'s own
  `SheetPrimitive.Content` className, not the shared `sheetVariants` — other
  `Sheet`/`SheetPrimitive` consumers (e.g. `EntityOverviewSheet`) are
  untouched.
- **Hero cover gets more room, less width fights it for it.** Page variant
  keeps the existing `tablet:flex-row` two-column layout (cover+actions
  beside metadata) since the full page has room for it. Sheet variant forces
  a single centered column at all widths (drops the `tablet:flex-row`
  branch) and widens the cover's cap from `max-w-50` (page) to `max-w-56` —
  in a right-hand sheet, a wide two-column split fights the panel's own
  width instead of complementing it; a taller single-column "poster" read
  suits the pulled-issue framing better.
- **Section divider, not implicit spacing.** The full page separates the
  hero block from the Metadata section with `BooksAfterCursor` (a "more from
  this series" rail) sitting between them; the sheet variant omits that rail
  entirely (see D1) so it needs its own seam — `border-t border-border pt-4`
  ahead of the Metadata heading, using the plain per-theme `border` token
  (unlike the brand-accent left edge, this is just a content-organization
  divider, not a brand signifier).
- **Known gap, not solved here:** `BookOverviewSceneHeader`'s internal
  responsive classes (`sm:grid-cols-3`, badge wrapping, etc.) key off
  **viewport** width via Tailwind breakpoints, not the sheet's actual pixel
  width — a `size="xl"` sheet (`w-5/6`) on a wide viewport still gets the
  "desktop" breakpoint layout even though the panel itself is narrower than
  a full page. It degrades acceptably (flex-wrap and grid fallbacks keep it
  from overflowing) but isn't container-query-correct. Fixing that properly
  means converting that header to container queries or sheet-aware props —
  out of scope for this stream; flagging for whoever touches that header
  next.
