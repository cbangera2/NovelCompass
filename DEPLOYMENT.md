# CI and GitHub Pages

`CI` runs on pushes and pull requests. It compiles the Python sources, runs the
pytest suite, creates a deterministic two-novel SQLite fixture, validates the
normalized static export contract, installs the locked pnpm dependencies, and
builds the site in static mode at `/novelupdatesrecommender/`.

The Pages workflow deploys the normalized snapshot committed under
`web/public/data` by default. No repository variables are required for that
bounded snapshot.

To build Pages from a larger approved SQLite snapshot instead, configure both
of these repository variables:

- `STATIC_DATA_URL`: HTTPS URL of an approved, immutable SQLite snapshot, such
  as a versioned public GitHub Release asset.
- `STATIC_DATA_SHA256`: lowercase SHA-256 digest of that exact file.
- `STATIC_MAX_NOVELS` (optional): positive number of novels whose
  recommendation pools should be precomputed. If omitted, every novel is
  precomputed.
- `STATIC_CATALOG_LIMIT` (optional): positive maximum number of catalog rows.

When both URL and digest are present, the build verifies the digest before
opening the database and regenerates `web/public/data`. If both are absent, it
validates and deploys the committed snapshot. Supplying only one variable fails
with an actionable error.

To calculate the digest locally:

```bash
shasum -a 256 supporting/artifacts/novelupdates-2026.sqlite
```

No repository secret is exposed to pull requests. The build job has read-only
repository permissions; only the final deployment job receives `pages: write`
and `id-token: write`.
