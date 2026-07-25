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
