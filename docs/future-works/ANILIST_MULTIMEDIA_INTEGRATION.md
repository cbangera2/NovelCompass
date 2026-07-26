# AniList Multi-Media Integration & Source-Agnostic UI

## Executive Summary
This document provides an end-to-end technical reference for the AniList multi-media integration in **Novel Compass**. The application ingests, filters, and recommends content across three primary media formats: **Light Novels**, **Manga**, and **Anime**, presenting them in a unified, source-agnostic web UI backed by both live FastAPI endpoints and precomputed static exports.

---

## 1. Data Schema & ID Provenance Scheme

To allow items from multiple distinct upstream platforms (NovelUpdates and AniList) to coexist in a single relational schema without primary key collisions:

| Source | Media Format | Database ID Range | Upstream ID Mapping | Primary Link Format |
| :--- | :--- | :--- | :--- | :--- |
| **NovelUpdates** | Light Novels & Web Novels | `1` .. `150,000` | Native NovelUpdates ID | `https://www.novelupdates.com/?p={id}` |
| **AniList** | Manga / Manhwa / Manhua | `2,000,000` + `anilist_id` | `external_id = "{anilist_id}"` | `https://anilist.co/manga/{external_id}` |
| **AniList** | Anime (TV, Movie, OVA, ONA) | `3,000,000` + `anilist_id` | `external_id = "{anilist_id}"` | `https://anilist.co/anime/{external_id}` |

### Database Column Extensions (`novels` table)
- `media_type` (`TEXT`): `'novel'`, `'manga'`, or `'anime'`
- `source` (`TEXT`): `'novelupdates'` or `'anilist'`
- `external_id` (`TEXT`): Original platform string ID
- `external_url` (`TEXT`): Direct canonical URL on the source platform

---

## 2. Ingestion & GraphQL Client (`src/scraper/`)

### Low-Level GraphQL Client (`anilist_client.py`)
- Communicates directly with public GraphQL endpoint `https://graphql.anilist.co`.
- Queries both `ANIME` and `MANGA` type nodes with attributes:
  - Title structures (`english`, `romaji`, `native`, `userPreferred`)
  - Format specifications (`TV`, `MOVIE`, `SPECIAL`, `OVA`, `ONA`, `MANGA`, `ONE_SHOT`, `NOVEL`)
  - Scores (`averageScore` 0–100 converted to 0.0–5.0 rating scale)
  - Popularity, favorites, chapter/episode counts, release status, start year
  - Genres, content tags, cover art images
  - Staff edges (Story, Art, Director, Studio)
  - Recommendation nodes & relations

### Ingest Engine & Cross-Source Popularity Normalization (`anilist_ingester.py`)
- Maps raw AniList JSON nodes into database records.
- Extracts studio names for Anime and author/artist names for Manga into the `author` field.
- **Cross-Source Magnitude Normalization**:
  - AniList raw user counts (popular items ~250,000 to 300,000) are roughly **10x higher** than NovelUpdates readership counts (popular items ~20,000 to 30,000).
  - Without normalization, sorting by `"popular"` when viewing combined media (or algorithm ranking weights) would cause AniList items to dominate NovelUpdates entries.
  - **Scaling Factor**: AniList `reading_list_count` is scaled by `0.10x` (`round(popularity * 0.10)`), bringing top items (e.g. *Attack on Titan*, *Death Note*) to ~25,000–30,000 readers, perfectly harmonized with top Light Novels (*Lord of the Mysteries*, *Solo Leveling*).
  - `rating_votes` maps directly to AniList `favourites` count (or `0.04x` popularity fallback).
- **Direct Recommendation User Votes Ingestion & Diminishing-Returns Scaling**:
  - Ingests exact community recommendation upvote counts from AniList (`rec_node.rating` stored as `direct_recs.votes`, up to 300+ votes for top pairs).
  - NovelUpdates user recommendation votes (typically 1–15 votes) and AniList recommendation upvotes are normalized in candidate generation using **Logarithmic Diminishing-Returns Scaling**:
    $$\text{vote\_weight} = 1.0 + \ln(1.0 + \text{votes})$$
  - Prevents high-volume vote platforms from overpowering niche platforms while maintaining strong consensus weighting (300 votes = $6.7\times$, 15 votes = $3.8\times$, 1 vote = $1.7\times$).
- Upserts cross-media recommendations into `direct_recs` and relations into `related_series`.
- Features rate-limited batching (0.5s pause per request) and JSON caching in `data/cache/anilist/`.

---

## 3. Recommendation Engine & API Endpoints

### Candidate Filtering (`src/engine/filters.py`)
- `HardFilterEngine` handles multi-select media type preferences.
- Accepts single formats (`'anime'`), combinations (`'novel,anime'`), or wildcard (`'all'`).

### Endpoint Updates (`src/api/main.py`)
- `/api/browse`: Parses comma-separated `media_type` query parameters and applies SQL filtering across combined sources.
- `/api/search`: Accepts `media_type` filters to constrain live search suggestions.
- `/api/recommend`: Preserves multi-media seed context and generates cross-media recommendations (e.g. recommending Anime seasons when seeding from a Manga).
- `/api/scraper/anilist/sync`: Exposes sync controls accepting `media_type` (`'manga'`, `'anime'`, or `'all'`).

---

## 4. Web Frontend Architecture & UI Components

### Global Media Filter Store (`web/src/mediaFilterState.ts`)
- Manages global active media choices (`Light Novels`, `Manga`, `Anime`).
- Persists choices in `localStorage`.
- Emits custom events to update components reactively without page reloads.

### Sidebar Integration (`web/src/components/ui/sidebar.tsx`, `web/src/AppShell.tsx`)
- Driven through a **"Catalog Media"** group in the left navigation sidebar using shadcn UI components:
  - `SidebarGroup` & `SidebarGroupLabel`
  - `SidebarMenu`, `SidebarMenuItem`, and `SidebarMenuButton`
  - Icons: `BookOpen` (Light Novels), `ImageIcon` (Manga), `Film` (Anime)
  - Active status badges (`Badge tone="violet"`)

### Dynamic Route & External Link Resolution
- **Format-Aware Detail Routes (`web/src/novelLinks.ts`)**:
  - `itemPageUrl(id, from, mediaType)` generates:
    - `?view=manga&id=2005114` for Manga
    - `?view=anime&id=3005114` for Anime
    - `?view=novel&id=5114` for Light Novels
- **Source-Aware External Links (`web/src/data/source.ts`)**:
  - `externalMediaUrl` & `sourceDisplayName` automatically label and route links:
    - **"Open on AniList"** (`https://anilist.co/anime/...` or `https://anilist.co/manga/...`)
    - **"Open on Novel Updates"** (`https://www.novelupdates.com/?p=...`)

---

## 5. Precomputed Static Dataset Export

### Export Generator (`build_static_export.py`)
- Reads the full database (24,791 items) and exports:
  - `catalog.json` & `bootstrap-catalog.json`: Full catalog rows with `media_type`, `source`, `external_id`, `external_url`.
  - `options.json` & `facets.json`: Taxonomies for offline search.
  - `details/{bucket}/{id}.json`: Precomputed detail shards.
  - `recs/{bucket}/{id}.json`: Precomputed recommendation pool shards across all media formats.

### Static Data Source Adapter (`web/src/data/static.ts`)
- `StaticDataSource` filters precomputed JSON shards by active `media_type` selections when running in static export mode (e.g. GitHub Pages).

---

## 6. Verification & Test Suite

### Automated Test Suite (`tests/test_anilist_integration.py`)
- 35 test cases covering:
  - AniList GraphQL response parsing for Manga & Anime
  - SQLite ID offset assignment & database upserts
  - HardFilterEngine multi-select candidate filtering (`novel,anime`)
  - FastAPI `/api/browse` endpoint queries across media types
  - Precomputed static export schema validation

### Command Execution
```bash
# Run backend test suite
PYTHONPATH=. .venv/bin/pytest

# Build production web bundle
cd web && npm run build
```
Result: **35 / 35 tests pass**, **Vite bundle builds cleanly with zero errors**.
