# Novel Compass

A local-first browser for finding translated novels through shared tags, reader recommendations, and curated lists.

## Features

- Recommendations from a novel you already like
- Catalog browsing with filters, rankings, and infinite scroll
- Novel pages with related titles and catalog comparisons
- Private profile import from saved Novel Updates HTML
- Live SQLite/API mode and a static GitHub Pages mode

## Run locally

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements-ci.txt
pnpm --dir web install

.venv/bin/uvicorn src.api.main:app --host 127.0.0.1 --port 8000
pnpm --dir web run dev
```

Open <http://localhost:3000>.

## Checks

```bash
PATH="$PWD/.venv/bin:$PATH" pnpm --dir web run check
```

The combined check runs Oxlint, Prettier verification, TypeScript, pytest, and
the production build without rewriting source files. During development:

```bash
pnpm --dir web run lint
pnpm --dir web run lint:fix
pnpm --dir web run format:check
pnpm --dir web run format
pnpm --dir web run typecheck
pnpm --dir web run test
```

Formatting is intentionally enforced on maintained configuration and
contributor documentation first. The existing frontend has not been
mass-formatted, keeping behavior changes reviewable while Oxlint covers all
TypeScript and React source.

Static export and deployment details are in [DEPLOYMENT.md](DEPLOYMENT.md).

Novel metadata comes from the [novel-dataset](https://github.com/shaido987/novel-dataset) project and Novel Updates pages captured by the local scraper. Novel Compass is not affiliated with Novel Updates.
