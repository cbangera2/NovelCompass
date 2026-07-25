# Multi-Source and Multi-Media Ingestion Architecture

## Purpose

Novel Compass currently models NovelUpdates novels. This document defines how the project can later support additional metadata sources and media types without implementing another source yet.

Potential future sources include AniList, MyAnimeList, and other novel catalogs. A source is not approved merely because it appears here. Before integration, its current API terms, rate limits, authentication requirements, robots policy, and redistribution rights must be reviewed.

The immediate goal is architectural readiness:

- Preserve the current NovelUpdates database, routes, ranking behavior, and static export.
- Introduce stable boundaries for source identity, provenance, ingestion, and schema evolution.
- Support recommendations whose evidence and candidates come from different websites.
- Track medium and format so cross-site recommendation does not accidentally imply cross-media recommendation.
- Prevent unsafe automatic merging.
- Keep GitHub Pages compatible.
- Allow a future source to be added behind a versioned contract.

No external-source connector is part of this plan.

---

## Executive Assessment

Multi-source and multi-media support is feasible, but it should not be built by replacing the existing `novels` table or treating a franchise as one canonical item.

The safe model has three distinct concepts:

1. **Work** — one creative work in one medium and format, such as a particular web novel, light novel edition, manga adaptation, or anime season.
2. **Source record** — one platform’s listing for that work.
3. **Work relation** — a typed connection between works, such as `adaptation_of`, `sequel_of`, or `side_story_of`.

A franchise or intellectual-property grouping may be useful later, but it is not the canonical recommendation entity.

The existing NovelUpdates model remains operational during the transition. New tables and contracts are additive until a versioned v2 path is proven equivalent.

### Cross-site versus cross-media

These are separate product capabilities:

- **Cross-site recommendation** combines records and evidence from multiple websites. It may stay within one medium, such as recommending a NovelFire web novel from a NovelUpdates novel while using AniList or MyAnimeList metadata as additional evidence.
- **Cross-media recommendation** recommends a work in a different medium, such as manga or anime from a novel seed.
- **Adaptation navigation** links the same story across media. It is not automatically a recommendation.

Cross-site recommendation is a core goal. Same-media cross-site recommendations should be the first multi-source ranking mode. Cross-media recommendations remain an explicit user-controlled mode because their relevance expectations differ.

---

## Architectural Invariants

These rules should be approved before schema work begins.

### Identity

- Internal IDs are immutable and have no encoded source meaning.
- External identifiers are stored as text and are unique only within a source.
- A source record belongs to at most one work at a time.
- A work represents one medium and format, not an entire franchise.
- Every work has a normalized medium and may have a more specific format.
- Web-novel and light-novel editions are separate works unless evidence proves they are the same edition.
- Anime seasons, remakes, manga adaptations, and novel originals are separate works connected by typed relations.
- Slugs and normalized titles are never primary identity.

### Entity resolution

- Title similarity alone cannot merge records.
- Uncertain matches remain separate and enter a review queue.
- Every proposed match records its method, evidence, confidence, and decision.
- Manual accept, reject, split, and remap decisions are durable.
- Rejected matches prevent the same unsafe proposal from recurring.
- Authoritative cross-references are strong evidence, but media type, format, year, and creator compatibility must still be checked.

### Provenance

- Source observations are immutable or historically traceable.
- Every externally sourced fact records its source record and observation time.
- Canonical display values are derived by explicit precedence rules.
- One source refresh cannot delete another source’s tags, titles, or links.
- Recommendation and relation edges retain their origin and raw source values.
- Unknown values are null, not zero.

### Recommendation behavior

- Same-media recommendations remain the default.
- Recommendation candidates may come from any enabled website.
- Adaptations are navigation relationships, not similarity recommendations by default.
- Multiple source listings for one work are deduplicated before ranking.
- Scores and popularity are normalized within source, media, and time cohorts before comparison.
- Correlated sources cannot multiply the same signal without a contribution cap.
- Ranking changes require an algorithm-version increment and evaluation.

### Compatibility

- Existing numeric NovelUpdates IDs and routes remain stable during migration.
- Static v1 files remain readable and unchanged until a versioned v2 consumer is ready.
- GitHub Pages requires no credentials or runtime server.
- New static capabilities are declared in a manifest rather than inferred.

---

## Current Constraints

The current architecture is intentionally NovelUpdates-specific:

- `novels.id` is the NovelUpdates numeric ID.
- Tags, genres, direct recommendations, related series, and curated lists reference that ID.
- The repository requires a NovelUpdates numeric ID and only accepts NovelUpdates crawl URLs.
- The API and frontend expose `novelupdates_url`, translation status, and translated chapter fields.
- The recommendation engine assumes a single comparable catalog.
- The static exporter uses numeric modulo shards and synthesizes NovelUpdates URLs.

These are not bugs. They are the compatibility contract that the migration must preserve.

---

## Target Domain Model

### Source registry

A source describes a platform and its operational constraints.

```sql
CREATE TABLE sources (
    id INTEGER PRIMARY KEY,
    key TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    source_kind TEXT NOT NULL,
    base_url TEXT,
    enabled INTEGER NOT NULL DEFAULT 0,
    credential_mode TEXT,
    rate_policy_json TEXT,
    redistribution_policy TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
```

Examples of `source_kind` include `html_catalog`, `graphql_api`, `rest_api`, and `seed_import`.

Operational settings belong to source configuration. Credentials never belong in this table or in static artifacts.

### Works

A work is the unit used for deduplication, recommendation, library state, and internal routing.

```sql
CREATE TABLE works (
    id INTEGER PRIMARY KEY,
    media_type TEXT NOT NULL,
    format TEXT,
    canonical_title TEXT NOT NULL,
    original_language TEXT,
    original_year INTEGER,
    display_synopsis TEXT,
    display_cover_asset_id INTEGER,
    resolution_status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
```

`media_type` is the broad medium. Initial normalized values are:

- `novel`
- `comic`
- `anime`

`format` preserves distinctions that materially affect discovery:

- Novel: `web_novel`, `light_novel`, `published_novel`
- Comic: `manga`, `manhwa`, `manhua`, `webtoon`
- Anime: `tv`, `movie`, `ova`, `ona`, `special`

This lets users search all comics while still distinguishing manga, manhwa, and manhua, or search all novels while distinguishing web novels and light novels.

The normalized vocabulary must be documented and versioned. Raw source values are also retained.

### Source records

A source record is a source-specific listing.

```sql
CREATE TABLE source_records (
    id INTEGER PRIMARY KEY,
    source_id INTEGER NOT NULL REFERENCES sources(id),
    external_id TEXT NOT NULL,
    work_id INTEGER REFERENCES works(id),
    raw_media_type TEXT,
    normalized_media_type TEXT,
    normalized_format TEXT,
    record_status TEXT NOT NULL DEFAULT 'active',
    first_seen_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    last_fetched_at TEXT,
    raw_payload_hash TEXT,
    UNIQUE (source_id, external_id)
);
```

`work_id` may remain null while a record awaits entity resolution.

### Source links

A source record may have multiple URLs whose history matters.

```sql
CREATE TABLE source_links (
    id INTEGER PRIMARY KEY,
    source_record_id INTEGER NOT NULL REFERENCES source_records(id),
    link_kind TEXT NOT NULL,
    url TEXT NOT NULL,
    is_canonical INTEGER NOT NULL DEFAULT 0,
    first_seen_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    UNIQUE (source_record_id, link_kind, url)
);
```

Examples include `public_page`, `api_resource`, `cover`, and `official_site`.

Each adapter validates its own allowed hosts and URL forms. There is no universal crawl-URL canonicalizer.

### Source-scoped facts

Facts must retain their origin. A typed-column model can be introduced later for high-volume fields; the initial compatibility layer may use source-scoped facts.

```sql
CREATE TABLE source_facts (
    id INTEGER PRIMARY KEY,
    source_record_id INTEGER NOT NULL REFERENCES source_records(id),
    field_key TEXT NOT NULL,
    value_json TEXT NOT NULL,
    language TEXT,
    observed_at TEXT NOT NULL,
    valid_until TEXT,
    payload_hash TEXT,
    is_current INTEGER NOT NULL DEFAULT 1
);
```

Canonical fields on `works` are projections selected through explicit precedence rules. Source facts are not overwritten by unrelated sources.

Aliases should eventually use a structured table containing:

- alias text
- language and script
- alias type
- source record
- observation time

They should not be canonicalized as an untyped JSON array.

### Credits

Generic `author` and `studio_or_publisher` fields do not generalize safely.

```sql
CREATE TABLE entities (
    id INTEGER PRIMARY KEY,
    entity_type TEXT NOT NULL,
    display_name TEXT NOT NULL
);

CREATE TABLE work_credits (
    work_id INTEGER NOT NULL REFERENCES works(id),
    entity_id INTEGER NOT NULL REFERENCES entities(id),
    role TEXT NOT NULL,
    source_record_id INTEGER REFERENCES source_records(id),
    PRIMARY KEY (work_id, entity_id, role, source_record_id)
);
```

Roles may include author, illustrator, translator, publisher, studio, director, and original creator.

### Taxonomy assertions and mappings

Source taxonomies remain distinct.

```sql
CREATE TABLE source_taxa (
    id INTEGER PRIMARY KEY,
    source_id INTEGER NOT NULL REFERENCES sources(id),
    external_id TEXT,
    name TEXT NOT NULL,
    raw_category TEXT,
    metadata_json TEXT,
    UNIQUE (source_id, external_id)
);

CREATE TABLE source_record_taxa (
    source_record_id INTEGER NOT NULL REFERENCES source_records(id),
    source_taxon_id INTEGER NOT NULL REFERENCES source_taxa(id),
    rank INTEGER,
    relevance REAL,
    is_spoiler INTEGER,
    observed_at TEXT NOT NULL,
    PRIMARY KEY (source_record_id, source_taxon_id)
);

CREATE TABLE canonical_concepts (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    concept_version INTEGER NOT NULL
);

CREATE TABLE taxon_mappings (
    source_taxon_id INTEGER NOT NULL REFERENCES source_taxa(id),
    concept_id INTEGER NOT NULL REFERENCES canonical_concepts(id),
    mapping_type TEXT NOT NULL,
    confidence REAL NOT NULL,
    decision_status TEXT NOT NULL,
    decided_by TEXT,
    decided_at TEXT,
    PRIMARY KEY (source_taxon_id, concept_id)
);
```

Unmapped source taxa remain available. Canonical IDF is calculated by work and media cohort, not by counting duplicate source assertions.

### Work relations

```sql
CREATE TABLE work_relations (
    source_work_id INTEGER NOT NULL REFERENCES works(id),
    target_work_id INTEGER NOT NULL REFERENCES works(id),
    relation_type TEXT NOT NULL,
    source_record_id INTEGER REFERENCES source_records(id),
    observed_at TEXT NOT NULL,
    PRIMARY KEY (source_work_id, target_work_id, relation_type, source_record_id)
);
```

Relation direction and inverse behavior must be defined for each type. Examples include:

- `adaptation_of`
- `sequel_of`
- `prequel_of`
- `side_story_of`
- `spin_off_of`
- `alternative_version_of`

These relations are shown separately from similarity recommendations unless the user explicitly enables cross-media exploration.

### Recommendation evidence

Recommendation edges remain source-scoped.

```sql
CREATE TABLE recommendation_edges (
    id INTEGER PRIMARY KEY,
    source_work_id INTEGER NOT NULL REFERENCES works(id),
    target_work_id INTEGER NOT NULL REFERENCES works(id),
    origin_source_record_id INTEGER NOT NULL REFERENCES source_records(id),
    external_edge_id TEXT,
    edge_kind TEXT NOT NULL,
    raw_weight REAL,
    raw_votes INTEGER,
    normalized_weight REAL,
    observed_at TEXT NOT NULL,
    payload_hash TEXT,
    UNIQUE (origin_source_record_id, external_edge_id, source_work_id, target_work_id)
);
```

The source’s original score and votes are retained. Normalization is versioned and reproducible.

### Entity-match workflow

```sql
CREATE TABLE entity_matches (
    id INTEGER PRIMARY KEY,
    source_record_id INTEGER NOT NULL REFERENCES source_records(id),
    candidate_work_id INTEGER NOT NULL REFERENCES works(id),
    method TEXT NOT NULL,
    confidence REAL NOT NULL,
    evidence_json TEXT NOT NULL,
    decision_status TEXT NOT NULL DEFAULT 'pending',
    decided_by TEXT,
    decided_at TEXT,
    created_at TEXT NOT NULL,
    UNIQUE (source_record_id, candidate_work_id, method)
);
```

Allowed decisions include `pending`, `accepted`, and `rejected`. A separate resolution event log should retain merges, splits, and remaps.

---

## Entity Resolution Policy

Entity resolution must favor false negatives over false positives. Separate records can be joined later; an incorrect merge contaminates library state, recommendations, and analytics.

### Cross-source collision classes

Every apparent collision must be classified before records are combined:

1. **Same work, different source records** — the same novel listed on NovelUpdates, NovelFire, AniList, or MyAnimeList. These records resolve to one work and produce one recommendation result with multiple source links.
2. **Same story, different edition or format** — for example, a web novel and its revised light-novel publication. These remain separate works connected by `alternative_version_of`, `based_on`, or another explicit relation.
3. **Cross-media adaptation** — novel, manga, manhwa, manhua, and anime versions remain separate works connected by `adaptation_of`.
4. **Unrelated title collision** — different works happen to share a title or translated alias. They remain separate with a rejected entity-match record.
5. **Insufficient evidence** — records remain unresolved and separate until reviewed.

The resolver must never assume that matching normalized titles imply class 1.

### Collision-resolution workflow

For each new source record:

1. Check authoritative external cross-references.
2. Generate candidate works from original titles, structured aliases, creators, language, year, medium, and format.
3. Reject candidates with incompatible medium, format, edition, season, year, or creator evidence.
4. Record each viable candidate in `entity_matches` with evidence and confidence.
5. Auto-accept only matches satisfying the strict authoritative policy below.
6. Leave all other candidates pending for review.
7. Create a new work when no safe match exists.

An accepted collision changes only the source record’s `work_id`. It does not overwrite source facts. Projected work metadata is recomputed using precedence rules.

### Recommendation deduplication

Before ranking output:

- Candidate evidence is collected by source record.
- Source records are resolved to work IDs.
- Signals for records belonging to the same work are aggregated with source-contribution caps.
- The seed work and all of its source records are excluded.
- Only one result card is emitted per work.
- The result retains all contributing sources and destination links for explanation.

If two source records are unresolved, they may temporarily appear as separate provisional works. The UI and export contract should expose a resolution status so provisional identity is not presented as certain.

### Durable overrides

Manual decisions must survive future imports:

- `accepted` binds a source record to a work.
- `rejected` blocks the same proposed pairing unless materially new evidence appears.
- `split` moves one or more records from an incorrectly merged work.
- `remapped` records a corrected destination work.
- `locked` prevents automated remapping of a reviewed record.

Resolution events store the previous and new work IDs, actor, reason, evidence version, and timestamp. Work merges should use redirects or tombstones rather than reusing deleted IDs, keeping profile entries, URLs, and static artifacts recoverable.

### Evidence levels

**Authoritative**

- A trusted platform cross-reference to the exact same edition or media entry.
- An official identifier shared across records.

**Strong**

- Compatible normalized media type and format.
- Matching original title plus compatible creator credits.
- Compatible publication year and edition information.

**Weak**

- Translated title similarity.
- Alias overlap.
- Synopsis similarity.
- Shared tags or genres.

Weak evidence may propose a match but cannot auto-accept it.

### Automatic acceptance

An automatic match is allowed only when:

- authoritative evidence exists;
- media type and format are compatible;
- no contradictory year, edition, season, or creator evidence exists; and
- the rule has a versioned test fixture.

All other matches remain pending for review.

### Required controls

- Accept and reject a proposal.
- Create a new work.
- Move a source record between works.
- Split an incorrectly merged work.
- Record why a decision was made.
- Prevent rejected proposals from being recreated unchanged.
- Run collision reports for duplicate external IDs and incompatible records.

---

## Normalized Ingestion Boundary

Fetching, normalization, persistence, and resolution are separate stages.

```python
class SourceAdapter:
    source_key: str
    capabilities: AdapterCapabilities

    def discover(self, checkpoint: Checkpoint) -> DiscoveryBatch: ...
    def fetch(self, external_id: str, context: FetchContext) -> RawObservation: ...
    def normalize(self, observation: RawObservation) -> NormalizedRecord: ...
```

The adapter does not directly mutate canonical works.

### Normalized record

A normalized record should contain:

- source key and external ID
- raw and normalized media type/format
- source links
- source-scoped titles and aliases
- source-scoped facts
- credits
- taxonomy assertions
- relation observations
- recommendation observations
- observation timestamp and payload hash
- licensing/redistribution metadata where applicable

Persistence upserts the source record and appends or supersedes its observations. Entity resolution runs afterward.

### Adapter capabilities

Capabilities are explicit:

- item lookup
- incremental discovery
- full discovery
- recommendations
- relations
- user lists
- taxonomy
- conditional requests
- authentication requirement
- redistribution permission

The scheduler must not assume every adapter can discover all records or provide recommendations.

---

## Scheduling and Source Operations

The existing global NovelUpdates crawl queue should not become the universal scheduler unchanged.

Future additive tables should support:

- source-specific ingestion runs
- job kind and external ID
- opaque pagination cursor/checkpoint
- scheduled freshness deadline
- conditional-request metadata
- attempt count and retry time
- `Retry-After` and quota state
- dead-letter status
- credential capability, without storing the credential
- run completeness and stop reason
- source health and last successful checkpoint

Example key:

```text
(source_id, job_kind, external_id_or_cursor)
```

A completed, partial, aborted, rate-limited, and failed run must be distinguishable. A partial run cannot publish a supposedly complete artifact.

### Credentials

- Credentials remain in local environment variables or approved CI secrets.
- They are never placed in SQLite release artifacts, JSON exports, browser storage, or GitHub Pages.
- Static builds consume only already approved normalized data.

### Scraping constraints

- Browser automation and anti-bot bypass tools are not assumed to be acceptable.
- Terms, robots policy, and access expectations are reviewed per source.
- A source that cannot be accessed reliably and legitimately remains disabled.

---

## Covers, Synopses, and Redistributable Content

Remote media requires an explicit policy.

### Cover metadata

Store:

- originating source record
- source URL
- attribution
- known license or terms status
- dimensions and MIME type
- content hash when fetched
- first and last observed timestamps
- cache/mirroring policy

### Delivery policy

- Use a remote URL only when its terms permit hotlinking.
- Mirror or proxy an image only when redistribution is permitted.
- Provide a local placeholder and broken-image fallback.
- Do not commit a large cover archive to the Git repository.
- An optional approved asset store or CDN may be introduced later.
- GitHub Pages builds must not depend on secrets.

Synopsis, reviews, list comments, and other text require the same redistribution review.

---

## Recommendation Architecture

The current five-channel RRF engine remains unchanged for v1.

A future v2 engine operates on works, not source records.

Its central purpose is cross-site discovery without duplicate listings. Evidence may come from several platforms, while every result represents one resolved work.

### Candidate preparation

1. Resolve the seed source record to a work.
2. Generate candidates from source-scoped evidence.
3. Collapse duplicate source records to work IDs.
4. Exclude other listings of the same work.
5. Filter to the requested source and media modes.
6. Normalize source-specific signals.
7. Fuse versioned channel rankings.

### Media modes

- `same_format` — web novel to web novel, manga to manga, and so on
- `same_media` — default; any novel format for a novel seed or any comic format for a comic seed
- `selected_formats` — an explicit set such as web novels plus light novels, or manga plus manhwa
- `cross_media` — explicit opt-in across novel, comic, and anime

Adaptations remain in a separate “Related adaptations” section even in same-media mode.

### Source modes

Source selection is independent of media selection:

- `all_sources` — default after multiple sources are trusted
- `selected_sources` — include only selected platforms
- `exclude_sources` — use all trusted platforms except selected platforms
- `source_only` — diagnostic mode for comparing one platform

A result is not duplicated because it appears on multiple sites. Its card represents the work and can show:

- the user’s preferred destination link;
- all known source links;
- which sources supplied recommendation evidence; and
- whether identity resolution is verified or provisional.

Preferred destination is a user setting and does not affect canonical identity.

### Normalization

Raw platform scores and popularity counts are not directly comparable.

Normalize within:

- source
- media type and format
- time snapshot
- population with adequate sample size

Store both the raw and normalized values. The normalization method and version are included in artifacts and explanations.

### Source contribution controls

- Cap contributions from correlated recommendation graphs.
- Keep provenance in explanations.
- Allow one source to supply metadata while another supplies the recommendation edge.
- Track source coverage so a work is not penalized merely for lacking a listing on every platform.
- Measure catalog-size and source-popularity bias.
- Evaluate same-source and cross-source recall separately.
- Do not enable a new ranking channel without an offline benchmark and algorithm-version bump.

---

## API and Static Export Compatibility

### Keep v1 stable

The existing API and static files continue to expose NovelUpdates novels using their current numeric IDs.

No new schema may silently reinterpret an existing ID.

### Add a parallel v2 contract

Example:

```text
/api/v2/works/{work_id}
/api/v2/search
/data/v2/manifest.json
/data/v2/catalog/
/data/v2/works/
/data/v2/recs/
```

The v2 manifest declares:

- schema version
- algorithm version
- dataset fingerprint
- source counts
- media counts
- media-format counts
- enabled capabilities
- shard strategy
- normalization versions
- asset policy
- build completeness

Opaque external IDs are not used directly as filenames. Use stable internal integer IDs or an explicitly encoded shard key.

### Static constraints

- Bootstrap and full catalogs may remain layered.
- Large source payloads and raw observations are excluded.
- Only approved display fields and evidence enter public artifacts.
- Missing detail or recommendation shards are reported honestly.
- API and static adapters have contract-equivalence tests.
- v1 and v2 can be generated together during migration.

---

## Migration Strategy

The current lightweight forward migrations are not sufficient for destructive table replacement. Introduce a migration ledger before adding multi-source tables.

```sql
CREATE TABLE schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL,
    checksum TEXT NOT NULL
);
```

Migrations must be:

- ordered
- transactional where SQLite permits
- checksum-verified
- restart-safe
- tested on a copy of the current database
- accompanied by validation queries

### Additive compatibility backfill

1. Insert a disabled `novelupdates` source.
2. Create one work per existing `novels.id`.
3. Create one NovelUpdates source record per novel.
4. Store an explicit compatibility map:

```sql
CREATE TABLE novel_v1_work_map (
    novel_id INTEGER PRIMARY KEY REFERENCES novels(id),
    work_id INTEGER NOT NULL UNIQUE REFERENCES works(id),
    source_record_id INTEGER NOT NULL UNIQUE REFERENCES source_records(id)
);
```

5. Backfill source links and selected facts.
6. Validate one-to-one counts, URLs, taxonomy membership, and relationship counts.
7. Leave all current tables and consumers untouched.

The compatibility mapping is the bridge for gradual conversion and rollback.

---

## Minimum Architecture to Build Before Another Source

This is the recommended scope for architectural readiness.

### Stage A: Decisions and contracts

- Approve this document and record the invariants as ADRs.
- Define media type, format, relation, and source vocabularies.
- Define source-content licensing policy.
- Define v2 identifiers and manifest compatibility.

### Stage B: Dormant additive foundation

Add:

- `schema_migrations`
- `sources`
- `works`
- `source_records`
- `source_links`
- source-scoped facts
- work relations
- entity-match proposals and decision history
- ingestion runs, jobs, and checkpoints
- the v1 NovelUpdates compatibility map

Do not change current application reads.

### Stage C: NovelUpdates backfill and validation

- Backfill existing novels into the new identity model.
- Add validation commands and tests.
- Confirm old API and static artifacts are byte- or contract-equivalent where expected.
- Test migration on copies of both the seed and current databases.

### Stage D: Synthetic adapter contract

- Define normalized DTOs and adapter capabilities.
- Use synthetic fixtures only.
- Test fetch/normalize/persist separation.
- Test idempotence, stale facts, deletion, partial runs, and retry behavior.
- Test ambiguous entity matches and manual decisions.

### Stage E: Read-only v2 projection

- Generate a v2 API/static projection using only the NovelUpdates backfill.
- Add API/static equivalence and routing tests.
- Keep it hidden from the production UI until stable.

After these stages, the architecture is ready for a controlled source spike.

---

## Deferred Work

Do not implement these merely to claim multi-source readiness:

- another live source connector
- automatic title-based merging
- taxonomy replacement
- source score fusion
- cross-media recommendations in the production UI
- new media filters in the production UI
- cover mirroring
- franchise grouping
- a universal crawler
- replacement of the `novels` table

These require real source samples, policy review, and measured behavior.

---

## Validation Requirements

### Migration

- Existing novel count maps one-to-one.
- Existing IDs and routes remain valid.
- Existing tag, genre, list, and edge counts remain unchanged.
- Re-running the migration is idempotent.
- Interrupted migrations recover safely.

### Provenance

- Conflicting facts from two synthetic sources coexist.
- Refreshing one source cannot remove another source’s facts.
- Every projected field can explain its selected source.
- Stale and withdrawn observations remain auditable.

### Resolution

- Same-title different works remain separate.
- The same novel listed on multiple sources resolves to one work and one recommendation result.
- Web-novel and light-novel variants remain separate by default.
- Adaptations create relations rather than merges.
- Accepted, rejected, split, and remapped decisions persist.
- Reviewed records can be locked against automated remapping.
- Work merges preserve redirects so saved profile and route IDs remain recoverable.

### Ranking

- Duplicate source records collapse to one work.
- Same-work records are never recommended to each other.
- Same-media is the default.
- Cross-site candidates are enabled independently from cross-media candidates.
- Manga, manhwa, manhua, webtoon, web novel, and light novel formats remain distinguishable.
- Source-normalized values are reproducible.
- Algorithm changes update the declared version.

### Delivery

- v1 API/static contracts remain valid.
- v2 API/static results agree.
- GitHub Pages requires no secret.
- Missing media assets render a fallback.
- Dataset fingerprints change deterministically.

---

## Source Adoption Gate

A future source may be implemented only after answering:

1. Is access permitted and operationally reliable?
2. What authentication and rate limits apply?
3. Which fields may be redistributed in a public static artifact?
4. What stable external identifiers and cross-references exist?
5. Which adapter capabilities are actually supported?
6. How are deletions, changes, and pagination detected?
7. What media and format distinctions does the source make?
8. How will ambiguous matches be reviewed?
9. How will its ranking signals be normalized and evaluated?
10. Can the connector be disabled without breaking existing data?

An official structured API is generally a safer first spike than an anti-bot-protected HTML site, but current policies and capabilities must be verified at implementation time.

---

## Recommended Sequence

```text
Architecture invariants and ADRs
        ↓
Additive identity, provenance, and migration tables
        ↓
NovelUpdates compatibility backfill
        ↓
Synthetic ingestion and resolution fixtures
        ↓
Read-only v2 API/static projection
        ↓
Contract and migration validation
        ↓
One approved structured-source spike
        ↓
Entity-resolution accuracy review
        ↓
Offline ranking normalization experiments
        ↓
Optional production UI exposure
```

---

## Final Recommendation

Prepare the identity, provenance, migration, and compatibility seams now. Do not replace the existing data model and do not implement another site yet.

The architecture is ready for future expansion when:

- existing NovelUpdates behavior remains stable;
- every source fact and edge is attributable;
- uncertain matches are reviewable and reversible;
- v1 and v2 contracts coexist;
- static delivery remains credential-free;
- media licensing is explicit; and
- ranking changes are normalized, versioned, and evaluated.

This provides a durable foundation without prematurely committing Novel Compass to uncertain source policies or irreversible entity merges.
