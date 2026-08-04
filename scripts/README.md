# scripts/ — offline helpers

Dev-time tools that are **not** part of the browser app. They run in your
terminal; the app itself stays 100% client-side.

## scrape_pinterest.py

Downloads Pinterest images into a local folder so you can drag them into clustr
with real reference material instead of test tiles. Wraps
[`pinterest-dl`](https://github.com/sean1832/pinterest-dl).

### One-time setup

```bash
python3 -m venv scripts/.venv
scripts/.venv/bin/pip install -r scripts/requirements.txt
```

### Use

```bash
# via npm (uses the venv python)
npm run scrape -- "https://www.pinterest.com/user/board/" -n 40
npm run scrape -- "brutalist interior" -n 40          # keyword search

# or directly
scripts/.venv/bin/python scripts/scrape_pinterest.py "vaporwave" -n 30
```

A source starting with `http` is scraped as a board/pin URL; anything else is a
search query. Override with `--url` / `--search`. Output defaults to
`scraped/<slug>/` (git-ignored). Then drag those images into the app window.

> ⚠️ Automated scraping may conflict with Pinterest's
> [Terms of Service](https://developers.pinterest.com/terms/). This is for
> personal, educational moodboarding only — keep counts modest and scrape
> responsibly.
