# NovelCompass on Cloudflare Workers + D1

Serves the NovelCompass API from the edge. The web frontend (`web/`) already
speaks to these `/api/*` routes via its `ApiDataSource`, so no frontend
changes are needed — the same Worker serves the Vite build as static assets.

This replaces the static GitHub Pages export: instead of precomputing every
recommendation into files, the Worker queries D1 live per request. The heavy
similarity math (RRF over 5 channels) runs per request; only the embedding
vectors are precomputed (see below).

## Layout

- `src/index.ts` — Hono app, all `/api/*` routes (port of `src/api/main.py`)
- `src/recommend.ts` — recommendation engine (port of `src/engine/`)
- `src/db.ts` — D1 helpers, URL builders, search/filter SQL builders
- `migrations/0001_init.sql` — D1 schema (serving tables only; the scraper's
  `crawl_queue`/`scrape_runs` tables stay on the VM)
- `wrangler.toml` — Worker config, D1 binding, static assets

## Endpoints

`GET /api/health`, `POST /api/resolve-slugs`, `POST /api/resolve-ids`,
`GET /api/search`, `GET /api/browse`, `GET /api/browse/random`,
`GET /api/novels/:id`, `GET /api/novels/:id/insights`, `GET /api/options`,
`POST /api/recommend`, `POST /api/recommend/for-you`

## Setup

1. Create the D1 database (already done):
   `wrangler d1 create novelcompass`
   The id lives in `wrangler.toml` (D1 ids are not secrets). Local dev
   always passes `--local`, which ignores the remote id.
2. Run migrations: `npm run db:migrate` (remote) or `npm run db:migrate:local`
3. Build the frontend: `cd ../web && pnpm build`. If `web/public/data` is a
   git clone, strip its history first (`rm -rf web/public/data/.git`) — the
   pack file exceeds the 25 MiB per-asset limit and fails the deploy.
4. Import data: export the serving tables from SQLite and import, in ~2 MB
   chunks (single huge `--file` uploads time out):
   `python3 scripts/export_d1_seed.py --db ../data/recommender.db --output seed.sql`
   then split and `wrangler d1 execute novelcompass --remote --file=chunk.sql`
   per chunk.
5. Deploy: `npm run deploy`

Pushes to `main` that touch `workers/`, `web/`, or the workflow deploy
automatically via `.github/workflows/deploy-worker.yml`, which needs the
`CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` secrets (the D1 id is
already committed in `wrangler.toml`).

## Local development

No Cloudflare account needed. All local commands pass `--local`, which uses
ephemeral local state instead of the remote id in `wrangler.toml`:

```bash
cd workers
npm install
npx tsc --noEmit                                          # typecheck
npx wrangler d1 migrations apply novelcompass --local     # schema
PYTHONPATH=.. python3 ../scripts/create_ci_dataset.py /tmp/fixture.sqlite
python3 - <<'EOF' > /tmp/seed.sql                         # serving tables only
import sqlite3
src = sqlite3.connect('/tmp/fixture.sqlite')
for t in ['novels','tags','novel_tags','genres','novel_genres',
          'direct_recs','related_series','rec_lists','rec_list_items']:
    cols = [r[1] for r in src.execute(f'PRAGMA table_info({t})')]
    for row in src.execute(f'SELECT * FROM {t}'):
        vals = ','.join('NULL' if v is None
                        else "'"+str(v).replace(\"'\",\"''\")+"'"
                        if isinstance(v, str) else str(v) for v in row)
        print(f'INSERT INTO {t} ({",".join(cols)}) VALUES ({vals});')
EOF
npx wrangler d1 execute novelcompass --local --file=/tmp/seed.sql
npx wrangler dev --local --port 8787
```

Smoke-test in another terminal:

```bash
curl -s localhost:8787/api/health
curl -s 'localhost:8787/api/search?query=fixture&limit=5'
curl -s localhost:8787/api/novels/1
curl -s -X POST localhost:8787/api/recommend \
  -H 'content-type: application/json' -d '{"query":"1","limit":5}'
```

`wrangler dev` also serves `../web/dist` (build it first with
`pnpm --dir web run build`), so the frontend talks to the local API on
the same origin.

## Data refresh flow

1. Run the scraper on the VM as usual (SQLite).
2. Run `scripts/export_vector_neighbors.py --db data/recommender.db` to
   refresh the precomputed embedding neighbors (the Worker cannot run the
   embedding model itself).
3. Export serving tables → import into D1. No frontend rebuild needed.

## Notes

- The vector channel reads from `vector_neighbors`; all other channels
  (tag, direct_rec, rec_list, structural) query D1 directly.
- Algorithm contract (`SCHEMA_VERSION=1`, `ALGORITHM_VERSION=1`, `RRF_K=60`)
  is duplicated in `src/recommend.ts` — keep in sync with
  `src/engine/ranking_contract.py`.
- The local-only scraper dashboard (`src/api/scraper_dashboard.py`) is
  intentionally not ported; it runs the crawler on the VM.
