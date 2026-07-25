# CI and GitHub Pages

`CI` runs on pushes and pull requests. It compiles the Python sources, runs the
pytest suite, creates a deterministic two-novel SQLite fixture, validates the
normalized static export contract, installs the locked pnpm dependencies, and
builds the site in static mode at `/novelupdatesrecommender/`.

The production SQLite snapshots under `data/` and `supporting/artifacts/` are
intentionally ignored by Git. The Pages workflow therefore does not scrape,
use browser credentials, or silently deploy fixture data. Configure these
repository variables before enabling GitHub Pages with **GitHub Actions** as
the source:

- `STATIC_DATA_URL`: HTTPS URL of an approved, immutable SQLite snapshot, such
  as a versioned public GitHub Release asset.
- `STATIC_DATA_SHA256`: lowercase SHA-256 digest of that exact file.
- `STATIC_MAX_NOVELS` (optional): positive number of popular novels whose
  recommendation pools should be precomputed. If omitted, every novel is
  precomputed.

The build verifies the digest before opening the database, generates
`web/public/data`, validates every normalized catalog/detail/recommendation
artifact, and builds with `VITE_DATA_MODE=static`. A missing or invalid source
configuration fails before deployment with an actionable error.

To calculate the digest locally:

```bash
shasum -a 256 supporting/artifacts/novelupdates-2026.sqlite
```

No repository secret is exposed to pull requests. The build job has read-only
repository permissions; only the final deployment job receives `pages: write`
and `id-token: write`.
