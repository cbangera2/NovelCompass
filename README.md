# Novel Compass

A local-first browser for finding translated novels through shared tags, reader recommendations, and curated lists.
<img width="1512" height="861" alt="image" src="https://github.com/user-attachments/assets/92b85ac6-eb6b-4374-be62-281ab560203e" />
<img width="1509" height="865" alt="image" src="https://github.com/user-attachments/assets/22f00d72-5d22-4c54-9d8a-3a5f0c9c72aa" />
<img width="3024" height="7496" alt="localhost_3000__view=novel id=18721" src="https://github.com/user-attachments/assets/50cb9b26-8f53-4614-b049-210b91f74a56" />

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

Novel metadata comes from the [novelcompass-data](https://github.com/cbangera2/novelcompass-data) repository and Novel Updates pages captured by the local scraper. Novel Compass is not affiliated with Novel Updates.
