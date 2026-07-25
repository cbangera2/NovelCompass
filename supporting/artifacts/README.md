# Versioned catalog artifacts

This directory holds local SQLite working artifacts created from the preserved
baseline database. Database files are intentionally ignored by Git; their small
sidecar manifests may be shared to describe provenance and completion state.

Prepare a separate 2026 working artifact:

```bash
.venv/bin/python -m src.scraper.refresh prepare
```

Inspect it without making network requests:

```bash
.venv/bin/python -m src.scraper.refresh status
```

Run a bounded, conservative refresh:

```bash
.venv/bin/python -m src.scraper.refresh crawl --max-items 25
```

The queue processes discovery sources first, then novels absent from the
baseline, and only then refreshes existing novels. The crawler obeys
`robots.txt`, uses a 3–6 second delay by default, and stops on authentication,
rate-limit, or anti-bot responses. It does not use HAR credentials or bypass
site challenges.

An artifact is publishable only after its manifest says `status: complete`.
`prepared` and `partial` artifacts must not be described as current snapshots.

## Browser-assisted session (optional)

The default crawler uses `urllib` and does not load credentials from HAR files.
If Novel Updates presents a login or anti-bot challenge, an opt-in headed
Playwright transport can reuse a session that you prepare manually. It does not
solve CAPTCHAs, submit challenge answers, or continue when challenge markup or
HTTP 401/403/429 is detected.

Install the optional runtime:

```bash
.venv/bin/pip install -r requirements-browser-scraper.txt
.venv/bin/playwright install chromium
```

Open the private persistent browser profile and complete any login/challenge
yourself:

```bash
.venv/bin/python -m src.scraper.crawler \
  --transport browser \
  --setup-browser-session
```

Then run a small bounded refresh using that same profile:

```bash
.venv/bin/python -m src.scraper.refresh crawl \
  --transport browser \
  --max-items 10
```

The profile lives at `data/browser-profile/`, is ignored by Git, and is created
with owner-only permissions. Treat it as sensitive session data. Do not commit
it or the HAR capture. The browser transport still honors `robots.txt`, the
3–6 second request delay, response caching, and the crawler's immediate stop on
authentication, rate-limit, or challenge responses. `urllib` remains the
default transport.
