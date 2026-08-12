#!/usr/bin/env python3
"""Build the docs site's social card and favicons from the Longbox mark.

The three assets this writes were inherited from Stump and never replaced: the
favicons were Stump's mark, and `og.png` carried Stump's wordmark, logo and tagline —
so every Longbox docs link shared in Slack or Discord unfurled as a different
project.

Everything is rendered through Playwright rather than an image library. PIL cannot
rasterise SVG and there is no ImageMagick on this machine, so the browser is the only
renderer available — and it is the one that already agrees with how the mark is drawn
in the app.

Usage:

    python3 scripts/screenshots/branding.py
"""

from __future__ import annotations

import pathlib

from PIL import Image
from playwright.sync_api import sync_playwright

HERE = pathlib.Path(__file__).resolve().parent
REPO = HERE.parents[1]
SCRATCH = REPO / ".screenshots-scratch"
PUBLIC = REPO / "docs" / "public"
MARK = REPO / ".github" / "images" / "logo.svg"

# Brand ink, matching the README badges and the og card.
INK = "#211d18"


def build_og(playwright, shot: pathlib.Path, out: pathlib.Path) -> None:
    template = HERE / "og.html"
    url = f"file://{template}?shot=file://{shot}"
    browser = playwright.chromium.launch()
    try:
        context = browser.new_context(
            viewport={"width": 1200, "height": 630}, device_scale_factor=1
        )
        page = context.new_page()
        page.goto(url, wait_until="load")
        # Injected rather than fetched by the page: Chromium blocks `fetch` of a
        # file:// URL from a file:// page, which shows up only as a timeout waiting
        # for an element that never appears.
        page.evaluate(
            "svg => { document.getElementById('mark').innerHTML = svg }",
            MARK.read_text(),
        )
        page.wait_for_function(
            "() => document.querySelector('#mark svg') && "
            "Array.from(document.images).every(i => i.complete && i.naturalWidth > 0)",
            timeout=30_000,
        )
        page.wait_for_timeout(250)
        page.locator("#card").screenshot(path=str(out))
        print(f"  {out.name:16s} {out.stat().st_size // 1024:5d} KB  1200x630")
    finally:
        browser.close()


def build_favicons(playwright, png_out: pathlib.Path, ico_out: pathlib.Path) -> None:
    """Rasterise the mark, then derive the multi-size .ico from it.

    The mark is stroke-based line art on a transparent ground, which disappears
    against a dark browser tab. It gets the brand ink as a rounded plate so it reads
    on either tab colour.
    """
    svg = MARK.read_text()
    html = f"""<!doctype html><meta charset="utf-8">
    <style>
      html,body{{margin:0;padding:0;background:transparent}}
      #plate{{width:512px;height:512px;border-radius:96px;background:{INK};
              display:flex;align-items:center;justify-content:center}}
      #plate svg{{width:360px;height:360px;color:#f3efe8}}
    </style>
    <div id="plate">{svg}</div>"""

    browser = playwright.chromium.launch()
    try:
        context = browser.new_context(
            viewport={"width": 512, "height": 512}, device_scale_factor=1
        )
        page = context.new_page()
        page.set_content(html)
        page.wait_for_timeout(200)
        page.locator("#plate").screenshot(path=str(png_out), omit_background=True)
        print(f"  {png_out.name:16s} {png_out.stat().st_size // 1024:5d} KB  512x512")
    finally:
        browser.close()

    # A real multi-resolution icon: browsers pick 16 for tabs and 32 for bookmarks,
    # and a single 512 scaled down by the browser looks muddy at 16.
    with Image.open(png_out) as image:
        image.save(ico_out, sizes=[(16, 16), (32, 32), (48, 48), (64, 64)])
    print(f"  {ico_out.name:16s} {ico_out.stat().st_size // 1024:5d} KB  16/32/48/64")


def main() -> None:
    shot = SCRATCH / "landing-dark.png"
    if not shot.exists():
        raise SystemExit(f"missing {shot}; run capture.py first")

    with sync_playwright() as playwright:
        build_og(playwright, shot, PUBLIC / "og.png")
        build_favicons(playwright, PUBLIC / "favicon.png", PUBLIC / "favicon.ico")


if __name__ == "__main__":
    main()
