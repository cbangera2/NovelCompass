# Dual-Mode Recommendation Plan

## Goal

Support two first-class ways to run the same Novel Updates recommender:

1. **API mode** — React UI + FastAPI + SQLite
2. **Static mode** — React UI + versioned JSON artifacts

The modes must share the same user interface, filters, ranking controls,
recommendation semantics, and response types. Switching modes must not require
rewriting UI components.

## Why support both

### API mode is best for

- scraping and immediately testing new data
- complete catalog coverage without generating deployment artifacts
- debugging recommendation evidence
- experimenting with algorithms
- future personalized feedback such as Love, Read, and Not for me
- queries that need larger or dynamically generated candidate pools

### Static mode is best for

- GitHub Pages deployment
- zero-cost personal hosting
- fast cached reads
- simple, reliable distribution
- operation without a Python server

SQLite remains the canonical data and build layer. Static JSON is a versioned,
read-optimized projection of that database.

## Shared application contract

Create a frontend data-source interface:

```ts
interface RecommendationDataSource {
  mode: 'api' | 'static';
  getManifest(): Promise<DatasetManifest>;
  searchNovels(query: string, limit: number): Promise<NovelSearchResult[]>;
  getOptions(): Promise<FilterOptions>;
  getNovel(id: number): Promise<NovelDetail>;
  getRecommendations(
    request: RecommendRequest
  ): Promise<RecommendResponse>;
}
```

Implementations:

```text
RecommendationDataSource
├── ApiDataSource
└── StaticDataSource
```

`App.tsx` talks only to this interface. It must not contain direct `/api/...`
fetch calls or static-file path logic.

## Mode selection

Use a Vite environment setting:

```text
VITE_DATA_MODE=api
VITE_DATA_MODE=static
VITE_DATA_MODE=auto
```

Behavior:

- `api`: require the FastAPI service and show a useful connection error
- `static`: never attempt API requests
- `auto`: check `/api/health`; use API mode when compatible, otherwise use the
  static dataset

Recommended defaults:

- local development: `auto`
- GitHub Pages build: `static`
- backend integration tests: `api`

Display the active data source and dataset version unobtrusively in the
interface, for example “Live database” or “Static snapshot · Jul 25, 2026.”

The user may switch between available modes in Settings. A mode change clears
the current results and repeats the search against the selected source.

## One canonical ranking specification

Recommendation ranking must be implemented from a shared specification:

```text
score(candidate) =
  Σ active_channel_weight / (60 + channel_rank)
```

Then:

1. apply request filters
2. apply hidden-gem ordering boost when enabled
3. sort by adjusted score
4. limit results
5. calculate the displayed match from the unboosted score

```text
maximum =
  Σ active_channel_weight / 61

match_percent =
  clamp(round(100 × unboosted_score / maximum), 0, 100)
```

The percentage is an evidence-strength normalization, not a probability that
the reader will like the novel. Hidden-gem boosting changes result order but
does not inflate the displayed percentage.

The Python and TypeScript implementations need shared fixture tests containing:

- channel ranks
- weights
- filters
- expected ordering
- expected normalized match

This prevents API and static results from quietly drifting apart.

## API mode

### Runtime

```text
Browser
  ↓
FastAPI
  ↓
SQLite
```

Keep these endpoints:

- `GET /api/health`
- `GET /api/search`
- `GET /api/options`
- `GET /api/novels/{id}`
- `POST /api/recommend`

Extend `/api/health` to return compatibility information:

```json
{
  "status": "ok",
  "schema_version": 1,
  "algorithm_version": 1,
  "dataset_version": "2026-07-25T17:30:00Z-a1b2c3d4",
  "novel_count": 24639
}
```

### Performance work

API mode should remain dynamic but avoid recomputing invariant work:

- cache raw per-seed candidate channels
- key caches by seed, dataset version, and algorithm version
- batch-fetch candidate metadata instead of N+1 queries
- cache tag postings and inverse document frequencies
- cache final responses briefly by canonical request
- invalidate caches when the dataset version changes

Do not cache only the final recommendation list. Raw channel ranks are the
valuable reusable layer because users can change filters and weights.

### Database responsibilities

SQLite is responsible for:

- canonical scraped novel metadata
- tags and genres
- direct and related-series relationships
- curated-list memberships
- crawl state and resumability
- candidate-generation inputs
- dataset/update metadata

The HAR, cookies, credentials, raw authenticated responses, and local database
must remain ignored by Git.

## Static mode

### Runtime

```text
Browser
  ↓
manifest + compact catalog
  ↓
one recommendation pool per selected seed
  ↓
optional detail and facet data
```

Static artifacts use the normalized layout specified in
`STATIC_ARCHITECTURE.md`:

- `manifest.json`
- compact shared `catalog.json`
- lazily loaded `facets.json`
- `recs/<bucket>/<seed_id>.json`
- `details/<bucket>/<novel_id>.json`

Recommendation files contain IDs, channel ranks, and structured evidence. They
must not duplicate complete novel metadata for every seed.

Generate an artifact for every catalog novel, including explicit empty pools:

```json
{
  "seed": 123,
  "candidates": [],
  "reason": "insufficient_evidence"
}
```

The static adapter performs filters, weighting, hidden-gem ordering, and match
normalization in the browser.

### Client caching

- cache the manifest with revalidation
- cache shared catalog data by dataset version
- cache accessed recommendation and detail files in IndexedDB
- delete stale-version caches in the background
- optionally add a service worker after the data adapter is stable

## Shared types and compatibility

Move request and response contracts into frontend modules that both adapters
use. Keep Python models aligned with the same documented schema.

Version separately:

- `schema_version`: artifact/API field compatibility
- `algorithm_version`: candidate/ranking behavior
- `dataset_version`: content snapshot

The frontend must reject an unsupported schema with a specific message instead
of rendering partial or incorrect data.

Every Novel Updates link should be derived from the numeric ID:

```text
https://www.novelupdates.com/?p=<id>
```

Do not depend on locally derived slugs for external links.

## Static export pipeline

Refactor `build_static_export.py` into deterministic stages:

```text
validate-db
export-manifest
export-catalog
export-facets
export-details
export-recommendations
verify-export
```

Required properties:

- deterministic output
- atomic writes
- resumable generation
- configurable worker count
- per-seed fingerprints for incremental rebuilding
- explicit generated, unchanged, empty, and failed counts
- temporary version directory until all validation passes
- no publication of an incomplete dataset

Generated data should normally be deployed as a build artifact or dedicated
snapshot branch, not accumulated indefinitely in the main branch history.

## Behavior when modes differ

The application should be honest about snapshot limitations:

- API has a newer dataset: label API mode “Live database”
- static snapshot is older: show its generated date
- selected static seed has no evidence: explain that the snapshot has no
  recommendation pool
- static file is missing unexpectedly: report dataset corruption, not “novel
  not found”
- API is unavailable in `auto` mode: fall back once, notify unobtrusively, and
  avoid retrying every request

Feedback controls require special handling:

- API mode can persist feedback in SQLite
- static mode initially stores feedback locally in IndexedDB
- a later export/import feature can move local feedback between browsers

The UI should describe this difference near the controls.

## Testing strategy

### Contract tests

Run the same search, detail, options, and recommendation scenarios against both
adapters and compare normalized responses.

### Ranking parity tests

Use fixed candidate fixtures to assert that Python and TypeScript produce the
same:

- included candidates
- order
- raw score within a small tolerance
- match percentage
- evidence labels

### Export verification

Require:

- database and catalog counts match
- every novel has a detail file
- every novel has a recommendation or explicit-empty file
- every candidate ID exists
- no seed recommends itself
- all ranks are positive and reference declared channels
- no private/session data appears in exported artifacts
- compressed size report stays within budgets

### Browser tests

Test each mode independently:

- exact autocomplete selection
- deep-link opening of a novel detail
- recommendation loading
- ranking-control changes
- filters and exclusions
- load-more behavior
- missing/empty pool state
- API failure and `auto` fallback
- GitHub Pages subpath routing

## Implementation phases and commits

### Phase 1 — shared contracts

- introduce `RecommendationDataSource`
- move API calls into `ApiDataSource`
- keep current behavior unchanged
- add data-source contract tests

Suggested commit:

```text
refactor: introduce recommendation data source contract
```

### Phase 2 — normalized exporter

- replace repeated metadata with compact catalog joins
- add manifest, details, facets, and bucketed pool output
- derive links from numeric IDs
- add resume, fingerprint, atomic output, and verification

Suggested commit:

```text
feat: generate normalized static recommendation artifacts
```

### Phase 3 — static adapter

- add catalog search index
- load candidate pools on demand
- implement TypeScript ranking and filters
- implement detail and options reads

Suggested commit:

```text
feat: add static recommendation data source
```

### Phase 4 — parity

- add shared fixtures
- compare API and static results
- fix ranking and evidence inconsistencies

Suggested commit:

```text
test: enforce API and static ranking parity
```

### Phase 5 — selection and caching

- add `api`, `static`, and `auto` configuration
- add IndexedDB snapshot caching
- display active source and version
- support local-only feedback in static mode

Suggested commit:

```text
feat: add dual-mode selection and snapshot caching
```

### Phase 6 — deployment

- build a complete validated static snapshot
- configure GitHub Pages base path
- deploy the static bundle
- document local API startup and static build commands

Suggested commit:

```text
ci: publish validated static recommender
```

### Phase 7 — API optimization

- batch database reads
- cache raw candidate channels
- add dataset-aware invalidation
- benchmark representative seeds

Suggested commit:

```text
perf: cache candidate channels and batch recommendation reads
```

## Definition of done

The dual-mode project is complete when:

- the same production UI runs against either adapter
- GitHub Pages makes no API request in static mode
- local `auto` mode uses the API when it is available
- API and static fixture rankings match
- all 24,639 current snapshot novels are searchable in both modes
- every static seed returns recommendations or an explicit reason
- detail views work in both modes
- ranking controls and filters behave identically
- static exports are resumable and verifiably complete
- no database, HAR, credentials, or authenticated raw pages are deployed
- documentation includes refresh, export, local-run, and deployment procedures
