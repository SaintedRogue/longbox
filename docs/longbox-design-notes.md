# Longbox visual identity notes

Seeded at the Wave 1→2 boundary alongside the logo work. Stream D (peek overlay)
and later UI work should extend this direction, not restart it.

## Concept: "the longbox as physical object"

The brand object is the comic longbox — the long cardboard box collectors store
bagged-and-boarded issues in. The logo is a minimalist side view: an amber
cardboard box with a label chip, cream boards/issues standing inside, and one
terracotta issue pulled up at a slight tilt (the issue you're reading).

## Logo files

- `.github/images/logo.svg` — master badge (512 viewBox, dark rounded square)
- `.github/images/logo-small.svg` — simplified variant for ≤48px (three issues,
  no label chip); used for favicon-16 and the .ico sizes
- `packages/browser/public/assets/longbox-{16,180,192,512}.png`,
  `longbox-mark.png`, `longbox.ico` — rasterized from the masters via
  rsvg-convert; `longbox-512-maskable.png` shrinks the glyph to 80% so circular
  Android masks don't clip the box corners. Named `longbox-*` (not `favicon-*`)
  deliberately: `/assets` is served immutable for a year and these files aren't
  content-hashed, so any future art change must also rename the files.
- `packages/browser/public/assets/longbox-splash.svg` — badge with a SMIL
  opacity pulse, used as the app-shell loading splash

## Palette

| Role                    | Hex       | Usage                                |
| ----------------------- | --------- | ------------------------------------ |
| Ink (badge/bg)          | `#161719` | matches the app's dark `theme_color` |
| Cardboard               | `#E5A83B` | the box; primary brand accent        |
| Cardboard shadow        | `#B9822A` | box rim, label text dashes           |
| Board cream             | `#F2EAD9` | issues, label chip                   |
| Board cream dim         | `#E6DCC3` | alternating issues                   |
| Pulled-issue terracotta | `#D9704C` | the "currently reading" accent       |

Amber-on-dark deliberately echoes the docs landing page's existing amber-500
motifs. In-app UI must keep using the existing theme tokens — the palette above
is for brand assets and may inform (not replace) accent choices in new surfaces.

## Motifs for UI work (Stream D and beyond)

- "Pulled issue": the peek overlay is the pulled issue — consider a subtle
  top-edge accent or tilt-in entrance easing that echoes pulling a book from
  the box. Keep it restrained; no skeuomorphic textures.
- Label chip: rounded-rect chip with short dashes is the brand's "metadata"
  shorthand; reusable for empty states or section badges.
- Geometry: rounded rects only, radius scale ~7/10/20 at 512 (i.e. small,
  medium, large), slight 7–9° tilts for "active" elements.
- Both light and dark themes must work: brand assets carry their own dark
  badge; never place cream-on-white without the badge.

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
