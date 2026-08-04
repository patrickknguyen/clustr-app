#!/usr/bin/env python3
"""Offline helper: download Pinterest images into a local folder for clustr.

This is a dev-time tool, NOT part of the app bundle. A scraper can't run in the
browser (CORS + Pinterest blocks it), so run this from the terminal, then drag
the downloaded folder's images into the clustr web app.

Usage
-----
    # Scrape a board or pin URL
    python scripts/scrape_pinterest.py "https://www.pinterest.com/user/board/" -n 40

    # Search by keyword
    python scripts/scrape_pinterest.py "brutalist interior" -n 40

    # Force a mode / custom output folder
    python scripts/scrape_pinterest.py "vaporwave" --search -o ../scraped/vibes

A source starting with http(s) is scraped as a URL; anything else is treated as
a search query. Use --url / --search to override.

Note
----
Automated scraping may conflict with Pinterest's Terms of Service. This helper is
intended for personal, educational moodboarding use only. Scrape responsibly and
keep counts modest.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path


def slugify(text: str) -> str:
    """Turn a URL or query into a short, filesystem-friendly folder name."""
    s = re.sub(r"https?://(www\.)?pinterest\.[a-z.]+/", "", text)
    s = re.sub(r"[^A-Za-z0-9]+", "-", s).strip("-").lower()
    return s[:60] or "pinterest"


def scrape(source: str, num: int, out_dir: Path, is_search: bool) -> list:
    """Download up to `num` images for `source` into `out_dir`."""
    try:
        from pinterest_dl import PinterestDL
    except ImportError:
        sys.exit(
            "pinterest-dl is not installed. Set it up once with:\n"
            "  python3 -m venv scripts/.venv\n"
            "  scripts/.venv/bin/pip install -r scripts/requirements.txt\n"
            "then run this script with scripts/.venv/bin/python (or `npm run scrape`)."
        )

    out_dir.mkdir(parents=True, exist_ok=True)
    client = PinterestDL.with_api()  # no login needed for public boards/search

    if is_search:
        return client.search_and_download(
            query=source, output_dir=str(out_dir), num=num
        ) or []
    return client.scrape_and_download(
        url=source, output_dir=str(out_dir), num=num
    ) or []


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Download Pinterest images into a local folder for clustr."
    )
    parser.add_argument("source", help="A Pinterest board/pin URL, or a search query.")
    parser.add_argument(
        "-n", "--num", type=int, default=40, help="Max images to download (default: 40)."
    )
    parser.add_argument(
        "-o", "--out", type=Path, default=None,
        help="Output folder (default: <repo>/scraped/<slug>).",
    )
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--search", action="store_true", help="Treat source as a search query.")
    mode.add_argument("--url", action="store_true", help="Treat source as a URL to scrape.")
    args = parser.parse_args()

    looks_like_url = args.source.strip().lower().startswith("http")
    is_search = args.search or (not args.url and not looks_like_url)

    repo_root = Path(__file__).resolve().parent.parent
    out_dir = args.out or (repo_root / "scraped" / slugify(args.source))

    print(f"→ {'searching' if is_search else 'scraping'}: {args.source!r}")
    print(f"→ up to {args.num} image(s) into {out_dir}")

    images = scrape(args.source, args.num, out_dir, is_search)

    print(f"✓ downloaded {len(images)} image(s) to {out_dir}")
    print("  Drag that folder's images into the clustr window to cluster them.")


if __name__ == "__main__":
    main()
