#!/usr/bin/env python3
"""Capture the Longbox screenshot set from a running server.

The screenshots in `docs/public/images` are marketing and documentation assets, and
they go stale every time the UI moves. This script exists so refreshing them is a
command rather than an afternoon: the July 2026 rebrand plan carried "capture the
landing screenshots from the running app" as an unchecked step for a month, which is
what a manual capture session is worth.

Usage:

    LONGBOX_SCREENSHOT_URL=http://your-server:10801 python3 scripts/screenshots/capture.py
    ...                                                                    --only reader
    ...                                                                    --theme light

Credentials come from `longbox.env` at the repository root, which is gitignored and
holds real secrets. They are read into memory and never printed — if you are adding
output here, do not log the parsed environment.
"""

from __future__ import annotations

import argparse
import os
import pathlib
import re
import sys
from dataclasses import dataclass, field

from playwright.sync_api import Page, sync_playwright

REPO = pathlib.Path(__file__).resolve().parents[2]
SCRATCH = REPO / ".screenshots-scratch"
ENV_FILE = REPO / "longbox.env"

# Device scale factor 2 everywhere: these are viewed on retina displays and in a
# README rendered at some arbitrary width, so the extra pixels are the difference
# between "crisp" and "obviously a screenshot".
SCALE = 2

VIEWPORTS = {
    "desktop": {"width": 1600, "height": 1000},
    "phone": {"width": 390, "height": 844},
}


@dataclass
class Screen:
    """One capture: where to go, how wide, and anything to do once there."""

    name: str
    # `{library_id}` and `{book_id}` are filled from discovery.
    path: str
    viewport: str = "desktop"
    # Extra settle time, for screens that decode something big after load.
    settle_ms: int = 0
    prepare: object = field(default=None)


SCREENS: list[Screen] = [
    Screen("library-browse", "/libraries/{library_id}/series"),
    Screen("omnibus-shelf", "/libraries/{library_id}/omnibuses"),
    Screen("release-calendar", "/calendar"),
    Screen("book-detail", "/books/{book_id}"),
    # The reader decodes a full comic page after the route settles.
    Screen("reader", "/books/{book_id}/reader", settle_ms=2500),
    # Phone variants exist for the hero composite.
    Screen("omnibus-shelf-phone", "/libraries/{library_id}/omnibuses", "phone"),
    Screen("book-detail-phone", "/books/{book_id}", "phone"),
]


def read_env() -> dict[str, str]:
    """Parse `longbox.env`. Never print the result."""
    if not ENV_FILE.exists():
        sys.exit(f"missing {ENV_FILE.name} at the repository root")
    pairs = re.findall(
        r"^([A-Za-z_][A-Za-z0-9_]*)=(.*)$", ENV_FILE.read_text(), re.MULTILINE
    )
    # Values may carry surrounding quotes and, in this file's case, trailing commas.
    return {k: v.strip().strip('"').strip("'").rstrip(",") for k, v in pairs}


def resolve_base_url(env: dict[str, str]) -> str:
    """The server to capture.

    Prefer the environment variable so a private address never has to live in this
    repository, which is public.
    """
    url = os.environ.get("LONGBOX_SCREENSHOT_URL") or env.get("url", "")
    if not url:
        sys.exit("set LONGBOX_SCREENSHOT_URL, or a `url` key in longbox.env")
    return url.rstrip("/")


def login(context, base_url: str, env: dict[str, str]) -> None:
    """Authenticate the browser context.

    Going through `context.request` rather than the login form means the session
    cookie is shared with every page the context opens, so the captures skip the
    login screen entirely.
    """
    response = context.request.post(
        f"{base_url}/api/v2/auth/login",
        data={"username": env["user"], "password": env["pass"]},
    )
    if not response.ok:
        sys.exit(f"login failed: HTTP {response.status}")


def graphql(context, base_url: str, query: str) -> dict:
    response = context.request.post(
        f"{base_url}/api/graphql", data={"query": query}
    )
    if not response.ok:
        sys.exit(f"graphql failed: HTTP {response.status}")
    body = response.json()
    if body.get("errors"):
        sys.exit(f"graphql errors: {body['errors']}")
    return body["data"]


def discover(context, base_url: str) -> dict[str, str]:
    """Find a library and a book to photograph.

    Discovered rather than hardcoded so the script survives a rescan, a rebuild, or
    being pointed at somebody else's server.
    """
    libraries = graphql(
        context,
        base_url,
        "{ libraries(pagination:{offset:{page:1,pageSize:1}}) { nodes { id name } } }",
    )["libraries"]["nodes"]
    if not libraries:
        sys.exit("no libraries on that server")
    library_id = libraries[0]["id"]

    # An omnibus makes the best subject: the covers are good, the page counts are
    # real, and it exercises the newest feature. `orderBy` is a oneof input and
    # rejects the obvious `[{field,direction}]` shape, so it is omitted.
    books = graphql(
        context,
        base_url,
        "{ media(filter:{isOmnibus:true, series:{libraryId:{eq:\"%s\"}}}, "
        "pagination:{offset:{page:1,pageSize:1}}) { nodes { id name pages } } }"
        % library_id,
    )["media"]["nodes"]
    if not books:
        # A library with no omnibuses is fine; fall back to any book.
        books = graphql(
            context,
            base_url,
            "{ media(pagination:{offset:{page:1,pageSize:1}}) { nodes { id name pages } } }",
        )["media"]["nodes"]
    if not books:
        sys.exit("no books on that server")

    print(f"library {libraries[0]['name']!r}, book {books[0]['name']!r}")
    return {"library_id": library_id, "book_id": books[0]["id"]}


def settle(page: Page, extra_ms: int = 0) -> None:
    """Wait until the page has stopped arriving.

    `networkidle` alone is not enough: covers are lazy-loaded, so the network goes
    quiet while the grid is still a field of empty rectangles. Waiting on the images
    themselves is what makes a capture look like the app rather than a skeleton.

    Failed images report `complete` with `naturalWidth === 0`, so completion is the
    condition rather than success — otherwise one broken thumbnail hangs the run.
    """
    page.wait_for_load_state("networkidle")
    page.wait_for_function(
        "() => Array.from(document.images).filter(i => i.src).every(i => i.complete)",
        timeout=45_000,
    )
    # Let transitions and cover fade-ins land.
    page.wait_for_timeout(1200 + extra_ms)


def capture(page: Page, screen: Screen, base_url: str, ids: dict[str, str]) -> pathlib.Path:
    url = base_url + screen.path.format(**ids)
    page.goto(url, wait_until="domcontentloaded", timeout=60_000)
    settle(page, screen.settle_ms)
    if callable(screen.prepare):
        screen.prepare(page)
        settle(page, 400)

    out = SCRATCH / f"{screen.name}.png"
    page.screenshot(path=str(out))
    print(f"  {screen.name:24s} {out.stat().st_size // 1024:5d} KB  {url}")
    return out


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--only", action="append", help="capture just this screen (repeatable)")
    parser.add_argument(
        "--theme",
        default="dark",
        choices=["dark", "light"],
        help="which app theme to capture",
    )
    args = parser.parse_args()

    env = read_env()
    base_url = resolve_base_url(env)
    SCRATCH.mkdir(exist_ok=True)

    wanted = [s for s in SCREENS if not args.only or s.name in args.only]
    if not wanted:
        sys.exit(f"no screens matched {args.only}")

    suffix = "" if args.theme == "dark" else f"-{args.theme}"

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        try:
            for viewport_name in {s.viewport for s in wanted}:
                context = browser.new_context(
                    viewport=VIEWPORTS[viewport_name],
                    device_scale_factor=SCALE,
                    color_scheme=args.theme,
                )
                login(context, base_url, env)
                ids = discover(context, base_url)
                page = context.new_page()
                for screen in (s for s in wanted if s.viewport == viewport_name):
                    original = screen.name
                    if suffix:
                        screen = Screen(
                            original + suffix,
                            screen.path,
                            screen.viewport,
                            screen.settle_ms,
                            screen.prepare,
                        )
                    capture(page, screen, base_url, ids)
                context.close()
        finally:
            browser.close()


if __name__ == "__main__":
    main()
