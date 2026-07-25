# Static Recommendation Architecture

## Decision

Use SQLite as the canonical local database and support both an API deployment
and a database-free static deployment. Static mode does not require SQLite,
Python, or FastAPI in the deployed application; API mode remains a first-class
runtime option.

The shared data flow is:

```text
Novel Updates scrape
        ↓
SQLite canonical dataset
        ↓
validation and candidate generation
        ↓
versioned static artifacts
        ↓
Vite application on GitHub Pages
```

SQLite remains valuable because scraping, relationship replacement, joins,
deduplication, and incremental rebuilds are substantially easier and safer in a
database. Static-mode browsers receive only the read-optimized output they
need. API-mode browsers query FastAPI backed by the same canonical database.

See `DUAL_MODE_PLAN.md` for the shared frontend contract, runtime selection,
parity testing, and implementation sequence.

## Why the first export format will not scale

The prototype export proves the serverless approach, but it repeats full target
metadata, tags, genres, and explanation text in every seed's recommendation
file.

The measured prototype has:

- 24,639 catalog records in an 11 MB uncompressed `catalog.json`
- approximately 200 candidates per seed
- approximately 0.4 MB per recommendation file
- only 10 generated recommendation files

At the measured size, a full export would approach 10 GB. It would also make
every metadata correction appear in thousands of files. The scalable format
must normalize static data in the same way a database normalizes stored data:
shared novel metadata is written once and recommendation pools mostly contain
IDs and numeric ranks.

## Runtime artifact layout

```text
web/public/data/
├── manifest.json
├── catalog.json
├── facets.json
├── details/
│   ├── 00/
│   │   └── 38.json
│   └── ...
└── recs/
    ├── 00/
    │   └── 38.json
    └── ...
```

The two-character directory is derived deterministically from the novel ID,
such as `id % 256` encoded as lowercase hexadecimal and left-padded with zero.
This prevents a single directory from containing tens of thousands of files.
Python and TypeScript share the test vectors `1 → 01`, `15 → 0f`, `16 → 10`,
`255 → ff`, and `256 → 00`.

### `manifest.json`

The manifest is fetched first and is the cache/version boundary.

```json
{
  "schema_version": 1,
  "dataset_version": "2026-07-25T17:30:00Z-a1b2c3d4",
  "generated_at": "2026-07-25T17:30:00Z",
  "novel_count": 24639,
  "recommendable_seed_count": 23104,
  "catalog_url": "catalog.json",
  "facets_url": "facets.json"
}
```

`dataset_version` changes whenever source rows or the recommendation algorithm
change. The client uses it as part of every IndexedDB cache key.

### `catalog.json`

The catalog supports autocomplete, result cards, and client-side metadata
joins. Use compact positional arrays rather than repeating property names
24,639 times.

```json
{
  "fields": [
    "id", "slug", "title", "author", "cover", "rating", "votes", "readers",
    "year", "language_id", "status_id", "translated_chapters", "genre_ids"
  ],
  "rows": [
    [38, "stellar-transformation", "Stellar Transformation",
     "I Eat Tomatoes", "https://...", 4.2, 1262, 12646, 2008, 1, 2, 681,
     [0, 1]]
  ],
  "aliases": [
    [38, ["Xing Chen Bian", "星辰变"]]
  ],
  "languages": ["", "Chinese", "Japanese", "Korean"],
  "statuses": ["", "Ongoing", "Completed"]
}
```

The slug is exported rather than reconstructed from the title. Numeric IDs
remain the source for stable external Novel Updates links; slugs support
deterministic human-readable application routes and source compatibility.

Genre IDs are stored once per novel in the shared catalog. This makes common
genre filters immediately available without downloading `facets.json`, while
avoiding genre duplication in every seed-candidate pair.

The browser creates `Map<number, NovelCard>` once after download. Search uses a
normalized title/alias index built in a Web Worker so typing never blocks
rendering. The initial implementation can use prefix and token matching without
adding a large search library.

If the compact catalog still exceeds the target budget, split it into:

- `search.json`: ID, title, aliases, and author
- `cards.json`: display metadata for recommendation cards

Do not split prematurely; HTTP compression and positional arrays should be
measured first.

### `facets.json`

Advanced filters should not inflate every recommendation file.

```json
{
  "genres": ["Action", "Adventure"],
  "tags": ["Academy", "Artifacts"],
  "novels": {
    "38": {"g": [0, 1], "t": [4, 19, 88]}
  }
}
```

This artifact is loaded lazily when the user opens advanced filters or applies
a tag/genre constraint. Common lightweight filters such as language, rating,
votes, readers, year, completion, and chapter count use `catalog.json`.

If `facets.json` is too large after compression, partition the `novels` map into
256 ID buckets while keeping the dictionaries in one small file.

### `recs/<bucket>/<seed_id>.json`

Recommendation pools contain only seed-specific information:

```json
{
  "seed": 38,
  "algorithm_version": 1,
  "channels": ["tag", "direct_rec", "rec_list", "structural", "vector"],
  "candidates": [
    {
      "id": 35,
      "r": [2, 1, 7, null, null],
      "shared_tag_ids": [4, 19],
      "direct_votes": 1,
      "list_count": 2,
      "list_ids": [83544, 94083]
    }
  ]
}
```

Use short keys or positional arrays in the final generated representation.
Readable names above document the schema. Missing ranks are `null`.

Candidate pools should contain 150–300 unioned candidates, not exactly 100
results. This gives browser-side exclusions and filters enough headroom without
requiring a server query.

Generate a file for every known novel:

- normal pool when evidence exists
- `{"seed": 123, "candidates": [], "reason": "insufficient_evidence"}` when it
  does not

This makes “unsupported seed” an explicit state instead of an HTTP 404.

### `details/<bucket>/<novel_id>.json`

Fetch detail data only when the detail drawer opens:

```json
{
  "id": 38,
  "synopsis": "...",
  "associated_names": ["..."],
  "genre_ids": [0, 1],
  "tag_ids": [4, 19, 88],
  "original_chapters": 680,
  "direct_recommendation_count": 12,
  "related_series_count": 2,
  "recommendation_list_count": 8
}
```

Novel Updates links are derived from the stable numeric ID:

```text
https://www.novelupdates.com/?p=<id>
```

They do not need to be repeated in any artifact.

## Browser ranking

The static pool preserves individual channel ranks, so all existing tuning
controls continue to work without an API.

For every candidate that passes the selected filters:

```text
score = Σ channel_weight / (60 + channel_rank)
```

Then apply the hidden-gem multiplier using the candidate's reading-list count.
Sort by the adjusted score and return the selected result count.

The displayed match is not a probability. It is a normalized evidence score:

```text
maximum = Σ active_channel_weight / 61
match_percent = clamp(round(100 × unboosted_score / maximum), 0, 100)
```

Hidden-gem boosting must not inflate the displayed match percentage. It changes
ordering only. The UI should label the value “match” or “evidence match,” never
“chance you will like this.”

Filters are applied before final sorting. Component ranks remain their
precomputed global ranks so changing a filter does not falsely strengthen the
remaining candidates.

## Evidence rendering

Do not export complete English sentences for every seed-target pair. Export
structured evidence and render localized sentences in the browser:

- `shared_tag_ids`
- `direct_votes` and mutual flag
- `list_count` and a small set of notable list IDs/titles
- related-series type
- channel ranks

For example, the browser converts `list_count: 2` into “Appears with this novel
on 2 curated lists.” This substantially reduces output size and keeps UI copy
consistent.

## Caching and offline behavior

Use normal immutable HTTP caching plus IndexedDB:

1. Fetch `manifest.json` with revalidation.
2. Load catalog data under `dataset_version`.
3. Cache recommendation and detail files on first access.
4. Delete older-version IndexedDB entries in the background.
5. Keep the most recently used pools available offline.

A service worker is optional. IndexedDB gives explicit version control and is
enough for the first static release.

GitHub Pages should publish fingerprinted application assets. Data artifact
URLs may include the dataset version directory for immutable caching:

```text
data/2026-07-25-a1b2c3d4/recs/00/38.json
```

## Build pipeline

Replace the monolithic prototype exporter with explicit stages:

```text
validate-db
export-manifest
export-catalog
export-facets
export-details
export-recommendations
verify-export
```

Recommendation generation should:

- process seeds in deterministic ID order
- support `--workers`
- write to a temporary version directory
- skip unchanged seeds using a source fingerprint
- write files atomically
- resume after interruption
- report generated, unchanged, empty, and failed counts
- publish the version only after verification passes

An individual seed fingerprint should include:

- seed metadata/update timestamp
- its tag and genre relationships
- direct recommendation relationships
- curated-list memberships
- algorithm version

Changes to a target novel's display metadata require only a catalog rebuild.
Changes to evidence require rebuilding affected seed pools.

## Verification gates

An export is publishable only when:

- catalog count matches the database
- every catalog ID has a detail artifact
- every catalog ID has a recommendation artifact or explicit empty artifact
- every candidate ID exists in the catalog
- every rank is positive and belongs to a declared channel
- no recommendation includes its own seed
- URLs and covers contain no local or authenticated-session data
- a sample of static rankings matches the Python ranker
- total and compressed artifact sizes are reported
- the Vite production build succeeds with API access disabled

## Repository policy

Keep these in Git:

- exporter source
- artifact schemas
- small fixtures
- validation tests
- deployment workflow

Do not automatically keep the full generated dataset in the main Git history.
Large generated snapshots make clones and updates permanently expensive.

Preferred publication options, in order:

1. GitHub Pages artifact produced by GitHub Actions
2. a dedicated data branch with squashed snapshot history
3. GitHub Releases for versioned downloadable datasets

For a personal deployment, a dedicated generated-data branch is acceptable if
GitHub Actions cannot access the local scrape database. Never commit the HAR,
cookies, account credentials, raw authenticated responses, or `recommender.db`.

## Migration sequence

1. Refactor `build_static_export.py` into the versioned normalized format.
2. Add schema validation and Python-versus-browser ranking parity tests.
3. Export a 500-seed fixture and measure raw and compressed sizes.
4. Add a static data adapter behind the UI's existing search/options/detail/
   recommendation interface.
5. Run the UI with API access deliberately disabled.
6. Generate all seeds and verify completeness.
7. Add IndexedDB caching and GitHub Pages base-path handling.
8. Publish a preview and perform browser QA.
9. Retain FastAPI and SQLite as a fully supported live-data mode.

## Initial size budgets

These are validation targets rather than promises:

- initial compressed catalog and search data: at most 3 MB
- facets loaded on demand: at most 5 MB compressed
- typical recommendation pool: at most 15 KB compressed
- typical detail record: at most 5 KB compressed
- no initial request for all recommendation or detail data

If the full export misses these budgets, optimize representation before
changing hosting platforms. The database-free runtime remains viable as long as
the client downloads shared metadata once and fetches seed-specific data only
on demand.
