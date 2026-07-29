# Lightweight Extension and On-Demand Data Architecture

Status: proposed  
Scope: Chrome Manifest V3 extension data delivery; no runtime implementation in this change  
Decision owner: NovelCompass

## Decision

Keep rankings, route restyling, account-aware pages, and all Novel Updates DOM adapters in one extension. Do **not** create a second “rankings extension.”

Create two delivery tiers inside the existing extension instead:

1. **Core extension:** every restyled Novel Updates route, the popup, settings, native-page parsing, and Original View. It installs and runs without the NovelCompass recommendation snapshot.
2. **NovelCompass data pack:** versioned JSON fetched only when a feature needs it, cached locally, updated independently of extension releases, and removable from the popup.

This distinction matters because rankings are not currently the heavy part. The ranking UI parses the live Novel Updates page and uses the same approximately 424 KiB content bundle as the rest of the extension. The current full build is large because it copies the complete static recommendation/search dataset into `extension/dist/data`.

A separate extension would introduce two install/update flows, permission and ownership ambiguity, cross-extension messaging, duplicated shell code, and failure modes when only one extension is enabled. Chrome also has no general extension dependency mechanism that makes a second data extension behave like an optional package. It is therefore the wrong boundary.

## Current-state measurements

Measured on 2026-07-29 from the current full local build:

| Artifact | Approximate unpacked size |
| --- | ---: |
| Content JavaScript | 424 KiB |
| Product CSS plus native CSS | 64 KiB |
| Popup and background assets | 24 KiB |
| Dataset, excluding its nested `.git` directory | 121 MiB |
| `recommendation-index/` | 67 MiB source, 74 MiB in current `dist` |
| `details/` | 21 MiB source, 32 MiB in current `dist` |
| `catalog.json` | 12 MiB |
| `graph.json` | 18 MiB |
| `facets.json` | 2.7 MiB source |
| Accidental nested `data/.git` content | about 42 MiB |
| Current full extension ZIP | about 80 MiB |

The build currently recursively copies `web/public/data`, including the nested `.git` directory. Removing that directory is a mandatory packaging correction regardless of the chosen delivery architecture.

The existing data access layer is already close to a sharded design:

- `manifest.json` declares the schema, algorithm and dataset versions.
- recommendation data is split into 256 bucket files;
- details are split into buckets;
- `StaticDataSource` lazily fetches recommendation and detail buckets;
- `createExtensionStaticDataSource` accepts a caller-provided base URL and `fetch`;
- idle full-catalog warming is already disabled for extension callers.

The main problem is distribution: every shard is copied into the extension even if it is never read.

## Product behavior

### Always available

The core package must provide:

- restyling for every supported Novel Updates route;
- series metadata, chapter links, reviews, lists, rankings, reading list, and profile rendering derived from the current Novel Updates document;
- logged-in controls and safe passthrough to native forms;
- popup enable/disable, theme and Original View settings;
- route classification, navigation interception and fallback to the native page;
- a clear data-pack state: `Not downloaded`, `Downloading`, `Ready`, `Update available`, or `Error`.

No normal Novel Updates page should become blank or unusable because the optional data endpoint is unavailable.

### Loaded on demand

These features may request NovelCompass data:

- NovelCompass search/finder;
- “similar novels” and recommendation explanations on a series page;
- filters that require the full NovelCompass catalog or facets;
- future aggregate analytics that do not exist in the live Novel Updates page.

The first use should display useful live-page UI immediately, then a small explicit loading state for the enhanced feature. It must not block the whole replacement shell.

### User controls

Add a `NovelCompass data` section to the popup:

- Enable enhanced search and recommendations.
- Download/update data now.
- Show installed dataset version, last update time, and approximate disk use.
- Remove downloaded data.
- Optional: Wi-Fi only / reduced-data behavior when the Network Information API is available. Absence of that API must not block use.

The extension should not silently download more than a small bootstrap index immediately after install.

## Recommended architecture

```text
Novel Updates document
        |
        v
Core content script (packaged, about 0.5 MiB)
        |
        +-- live DOM adapters ----------------> restyled NU routes
        |
        +-- data client request
                  |
                  v
       MV3 service worker (packaged code)
                  |
          manifest/version check
                  |
        +---------+----------+
        |                    |
        v                    v
   Cache Storage       Remote static origin
   JSON responses      versioned JSON only
```

### Remote artifacts

Publish immutable dataset releases under a versioned prefix:

```text
/extension-data/v1/<dataset-version>/manifest.json
/extension-data/v1/<dataset-version>/search/<bucket>.json
/extension-data/v1/<dataset-version>/recommendations/<bucket>.json
/extension-data/v1/<dataset-version>/details/<bucket>.json
/extension-data/v1/<dataset-version>/facets.json
```

Publish one small mutable pointer:

```text
/extension-data/v1/latest.json
```

`latest.json` identifies the current immutable manifest and contains only data, never JavaScript, WebAssembly, HTML, expressions, templates, or CSS. Immutable files should use content hashes or a dataset-version path and long-lived cache headers. The pointer should use a short cache lifetime and ETag.

The manifest should include:

- schema version;
- minimum compatible extension/data-client version;
- dataset and algorithm versions;
- generated timestamp;
- per-artifact URL, compressed byte size, uncompressed byte size, SHA-256, and logical record count;
- bucket function/version;
- optional previous compatible dataset version for rollback.

### Fetch and storage boundary

Route all remote-data fetches through the extension service worker, not directly through the injected UI:

- the service worker validates the origin, content type, size ceiling, schema and digest;
- it stores raw `Response` objects in Cache Storage, which avoids converting tens of megabytes into `chrome.storage.local` JSON values;
- small metadata and user preferences live in `chrome.storage.local`;
- in-flight request deduplication may use service-worker memory, but correctness must not depend on that memory surviving;
- the content script communicates by typed `chrome.runtime.sendMessage` requests;
- every response carries dataset version information so mixed-version results can be rejected.

Cache keys must include the dataset version. A new release is populated alongside the active version and becomes active only after required bootstrap artifacts validate. Old versions are deleted after activation, retaining at most one rollback version if storage permits.

### Search-specific data

Do not make first search download the current 12 MiB `catalog.json`.

Generate a compact, normalized search index split by title prefix or hash bucket. Each row needs only:

- stable ID;
- slug;
- primary title;
- normalized title and aliases;
- compact author text;
- thumbnail URL;
- small display/filter fields.

Details and recommendation evidence remain separate and are fetched only for visible results or a selected title. The current 96 KiB `bootstrap-catalog.json` is a useful model for a bootstrap artifact, but its exact contents and coverage must be verified before adopting it.

### Recommendation-specific data

Retain deterministic recommendation bucketing. For a series page:

1. resolve the live series identity with the compact identity/search index;
2. compute its recommendation bucket;
3. fetch one recommendation shard;
4. fetch only the detail buckets needed for the visible candidates;
5. cache all validated responses.

Do not ship or download `graph.json` unless a runtime feature demonstrably needs the whole graph. Current client recommendation lookup uses the recommendation index, not the graph.

### Offline and failure behavior

- Cached compatible data remains usable offline.
- A failed update leaves the prior active version intact.
- A cache miss while offline returns an enhanced-feature error with Retry; live Novel Updates UI remains available.
- A schema or digest failure quarantines that artifact, records a bounded diagnostic, and does not repeatedly redownload in a tight loop.
- A dataset that requires a newer extension shows `Extension update required`.
- Removing the pack deletes dataset caches and metadata but not UI preferences.

## Manifest V3 constraints

This design must respect the following:

1. **All executable code remains packaged.** Manifest V3 prohibits remotely hosted executable code. Remote JSON data is acceptable only when treated strictly as data; never evaluate it, inject it as script, or use it to construct executable expressions. Chrome’s guidance distinguishes remotely hosted code from data such as JSON.
2. **The service worker is ephemeral.** It can stop between requests, and long operations are bounded. Durable state must be stored; downloads should be individual shard fetches with restart-safe metadata rather than one long background job.
3. **Cross-origin access needs permission.** Prefer an `optional_host_permissions` entry restricted to the single static-data origin, requested when the user first enables enhanced data. This keeps initial permissions narrow. If the extension will always fetch the pack, a required narrowly scoped `host_permissions` entry is simpler but produces a broader install contract.
4. **`chrome.storage.local` is not a bulk-object store.** Its default quota is 10 MiB. The `unlimitedStorage` permission removes quotas for extension storage APIs, including Cache Storage and IndexedDB, but should be requested only if measurements prove it necessary. Cache Storage plus `navigator.storage.estimate()` and a user-visible eviction policy is the initial recommendation.
5. **No dynamic service-worker imports.** Keep the service-worker data client packaged and statically imported. Do not attempt to download feature code or use remote dynamic imports.
6. **Web-accessible resources are not the cache API.** Remote/cached data should be returned through messaging; it does not need to be exposed to every Novel Updates page through `web_accessible_resources`.

Primary Chrome references:

- [Manifest V3 overview and remotely hosted code](https://developer.chrome.com/docs/extensions/develop/migrate/what-is-mv3)
- [Remote hosted code violations](https://developer.chrome.com/docs/extensions/develop/migrate/remote-hosted-code)
- [Extension service-worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)
- [Extension storage and Cache Storage behavior](https://developer.chrome.com/docs/extensions/develop/concepts/storage-and-cookies)
- [`chrome.storage` quotas](https://developer.chrome.com/docs/extensions/reference/api/storage/)

## Bundle and performance budgets

Budgets are release gates, not aspirations:

| Metric | Target | Hard failure |
| --- | ---: | ---: |
| Core ZIP, no dataset | under 750 KiB | 1 MiB |
| Core unpacked extension | under 1.5 MiB | 2 MiB |
| Content JavaScript, minified | under 500 KiB | 600 KiB |
| Content CSS | under 100 KiB | 125 KiB |
| Initial automatic remote transfer | 0 bytes | 100 KiB |
| First explicit enhanced-feature bootstrap | under 250 KiB compressed | 500 KiB |
| One recommendation interaction, cold cache | under 1 MiB compressed | 2 MiB |
| Search first result, cold cache | under 750 KiB compressed | 1.5 MiB |
| Repeat interaction, unchanged version | 0 network bytes | any avoidable refetch |
| Core UI added time after `document_idle` | under 100 ms p75 | 250 ms p75 |

The full offline pack may remain available as a separate developer artifact or an explicit advanced download, but it must not be the default Web Store package.

## Task breakdown

### Phase 0 — packaging hygiene and observability

- Exclude `.git`, `.DS_Store`, source maps and unrelated files from all dataset copies.
- Add build reports for compressed and unpacked bytes by category.
- Make the package validator fail on forbidden files and the bundle budgets above.
- Separate `build:extension:core`, `build:extension:fixture`, and optional `build:extension:offline-full`; avoid a flag whose output silently changes package semantics.
- Record per-route bootstrap time and data fetch bytes in development diagnostics.

Acceptance: the core package builds deterministically below the hard limits and contains no production dataset.

### Phase 1 — data manifest and publishing

- Define and version the remote manifest schema.
- Generate immutable release paths, per-file sizes/digests, and `latest.json`.
- Add compact search/identity shards.
- Confirm which current artifacts are runtime-required; omit `graph.json` unless proven necessary.
- Configure the static origin for HTTPS, CORS, ETag and immutable caching.
- Publish atomically: upload immutable artifacts, verify, then replace `latest.json`.

Acceptance: a clean script can verify every published artifact from the manifest without running the extension.

Implementation: `scripts/build_extension_data.py` produces the broker-facing
tree from a normalized static export. It emits compact title/alias prefix
search shards, low-byte identity/card and novel-facet shards, and reuses the
existing detail and recommendation buckets. Every JSON artifact is capped at
2 MiB and recorded with an exact byte count, record count, and SHA-256 digest.

Run it locally with:

```bash
python scripts/build_extension_data.py
python scripts/build_extension_data.py --verify-only
```

The Pages workflow runs both commands before the Vite build. Immutable files
are written below `extension-data/v1/<dataset-version>/`; `latest.json` is
replaced only after the release and manifest validate. The service worker's
configured URL therefore becomes available from the existing Pages origin
after a successful merge-to-main deployment, without a second repository or
GitHub setting.

### Phase 2 — service-worker data broker

- Add narrowly scoped optional host permission.
- Define typed messages for manifest, identity/search, recommendations, details, cache status and removal.
- Add origin/content-type/size/schema/digest validation.
- Add Cache Storage repository and small `chrome.storage.local` metadata.
- Implement request coalescing, versioned activation, rollback and bounded retries.
- Ensure every handler is safe if the service worker restarts.

Acceptance: automated tests simulate restart, offline mode, corrupt shards, version mismatch, update failure and concurrent requests.

### Phase 3 — client migration

- Introduce a data-source interface whose packaged-fixture and remote implementations share contracts.
- Change series recommendations to request only identity, one recommendation bucket and visible details.
- Change finder/search to use compact search shards, not full `catalog.json`.
- Keep live Novel Updates ranking and route adapters independent of the data pack.
- Render loading, unavailable, update-required and retry states inside only the affected feature.

Acceptance: every core route works with network disabled and an empty data cache; enhanced features work after a cold on-demand fetch.

### Phase 4 — popup data controls

- Add opt-in/download state, version, bytes used, last update, update and remove actions.
- Explain the narrowly scoped optional permission before requesting it.
- Add progress based on known manifest bytes.
- Preserve theme, enable/disable and default-view settings during data removal.

Acceptance: keyboard and screen-reader flows work; cancel/failure does not leave a falsely `Ready` state.

### Phase 5 — release and soak

- Run unit, contract, package, and live-browser route suites.
- Test clean install, upgrade from bundled-data builds, extension update during a download, permission denial, offline startup, cache eviction and dataset rollback.
- Compare cold/warm route timings and transferred bytes against budgets.
- Soak with the data origin unavailable and with intentionally malformed artifacts.
- Roll out the remote pointer conservatively; keep the previous compatible version addressable.

Acceptance: no core UI regression, no native-action regression, no uncaught extension errors, and all budgets pass on the release artifact.

## Migration plan

1. First release packaging hygiene and measurement without changing runtime behavior.
2. Add the remote broker behind a developer-only feature flag while retaining the packaged fixture.
3. Publish a compatible remote snapshot and run automated plus live-browser parity tests against packaged data.
4. Default developer/full builds to the remote path; retain a deterministic fixture build for CI.
5. Migrate existing users: ignore old packaged files after the extension update, preserve settings, and populate the remote cache only on enhanced-feature use.
6. Remove production data from the Web Store ZIP after parity and failure-mode gates pass.
7. Keep one documented offline-full developer build for personal/offline use.

Because packaged files disappear naturally on extension update, no destructive migration of user data is required. Only cache metadata needs schema-versioned migration.

## Validation matrix

| Scenario | Expected result |
| --- | --- |
| Fresh install, no permission granted | Every NU route and Original View work; no remote data transfer |
| First similar-novel request | Permission explanation, then bounded shard download and result |
| Permission denied | Core page remains complete; enhanced feature offers retry/settings |
| First search | Compact search data only; no full catalog fetch |
| Warm search or recommendation | Cached response; no unchanged artifact refetch |
| Browser offline with warm cache | Compatible cached enhanced data works |
| Browser offline with cold cache | Localized enhanced-feature error; core UI unaffected |
| Corrupt or HTML response | Rejected before caching; prior active data preserved |
| Dataset update interrupted | Old version remains active |
| Extension update during fetch | Restart-safe recovery; no mixed-version response |
| Dataset requires newer extension | Explicit update-required state |
| Remove downloaded data | Cache gone, settings retained |
| Ranking page | Works without data permission or cache |
| Native forms and authenticated actions | Same requests and effects as Original View |

## Explicit non-goals

- No second extension for rankings or data.
- No remotely downloaded JavaScript, WebAssembly, HTML UI, or templates.
- No dependency on a continuously running service worker.
- No automatic full-snapshot download after install.
- No proxying of Novel Updates authentication or cookies to the data origin.
- No silent fallback that reports partial or stale downloads as current.

## Reconsideration triggers

Revisit a separate companion application only if the offline dataset grows beyond practical browser storage, requires local compute that cannot run within extension constraints, or must be shared by multiple browsers/applications. Even then, prefer an optional native/local service over a second Chrome extension; it provides a clearer data ownership and lifecycle boundary.
