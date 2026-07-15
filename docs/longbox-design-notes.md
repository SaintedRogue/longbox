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
