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

1. Create the D1 database:
   `wrangler d1 create novelcompass`
   Paste the `database_id` into `wrangler.toml`.
2. Run migrations: `pnpm db:migrate`
3. Build the frontend: `cd ../web && pnpm build`
4. Import data: export the serving tables from SQLite and import:
   `wrangler d1 import novelcompass --file data.sql`
   (or use `wrangler d1 execute` with batched inserts)
5. Deploy: `pnpm deploy`

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
