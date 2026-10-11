# CI and GitHub Pages

`CI` runs on pushes and pull requests. It compiles the Python sources, runs the
pytest suite, creates a deterministic two-novel SQLite fixture, validates the
normalized static export contract, installs the locked pnpm dependencies, and
builds the site in static mode at a base path derived from the GitHub repository
name.

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

# Cloudflare Workers + D1 (live API)

`workers/` is a Hono port of the FastAPI backend (`src/api`) plus the
recommendation engine (`src/engine`), backed by D1. The same Worker serves
`web/dist` as static assets, so the frontend talks to the live API on the
same origin — no `VITE_DATA_MODE` override needed (auto mode tries `/api`
first).

Pushes to `main` touching `workers/`, `web/`, or the workflow deploy via
`.github/workflows/deploy-worker.yml`. Configure these first:

- Secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`
- The D1 id is committed in `workers/wrangler.toml` (ids are not secrets).

Local run (no Cloudflare account; `wrangler.toml` ships with a placeholder
database id that works with `--local`):

```bash
cd workers
npm install
npx tsc --noEmit
npx wrangler d1 migrations apply novelcompass --local
PYTHONPATH=.. python3 ../scripts/create_ci_dataset.py /tmp/fixture.sqlite
# dump the serving tables to SQL, then:
npx wrangler d1 execute novelcompass --local --file=/tmp/seed.sql
npx wrangler dev --local --port 8787
```

Full seed recipe and endpoint smoke tests are in
[workers/README.md](workers/README.md).

Two gotchas found while getting this running:

- Strip `.git` from the data snapshot before building (`rm -rf
  web/public/data/.git`). The nested clone's pack file exceeds the 25 MiB
  per-asset Workers limit and fails `wrangler dev`/`deploy`. The workflow
  does this automatically.
- D1 caps `LIKE` patterns at 50 bytes and binds at 100 variables per
  statement; `workers/src` already chunks/truncates accordingly (see
  `likePattern` in `db.ts`).
