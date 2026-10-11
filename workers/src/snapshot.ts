// In-memory catalog built from the static snapshot the deploy pipeline ships
// at /data/*. Search, browse, and catalog-wide statistics are pure scans, so
// running them against D1 costs 30k rows per request. Doing them once per
// isolate from the snapshot costs zero D1 rows and answers from memory.
//
// D1 stays the source of truth for the interactive evidence lookups behind
// each recommendation; every consumer here falls back to D1 when the snapshot
// is absent (for example `wrangler dev --local` without a built web/dist).

import type {
  CatalogDistributions,
  CohortIndexes,
  MetricKey,
} from "./db";

export type SnapshotCard = {
  id: number;
  slug: string;
  title: string;
  aliases: string[];
  author: string;
  cover_url?: string;
  rating: number;
  rating_votes: number;
  reading_list_count: number;
  year?: number;
  language: string;
  status_trans: string;
  chapters_trans: number;
  genre_names: string[];
  media_type: string;
  source: string;
  external_id: string;
  external_url?: string;
};

export type Snapshot = {
  cards: Map<number, SnapshotCard>;
  bySlug: Map<string, SnapshotCard>;
  genres: string[];
  tags: string[];
  /** Tag names per novel, mirrored from facets.json. */
  tagNames: Map<number, Set<string>>;
  total: number;
};

const SNAPSHOT_TTL_MS = 15 * 60 * 1000;
let cached: Snapshot | null = null;
let cachedExpires = 0;

function normalize(value: string): string {
  return (value ?? "")
    .toLocaleLowerCase()
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const MEDIA_ALIASES: Record<string, string[]> = {
  manga: ["manga", "manhwa", "manhua", "comic"],
  novel: ["novel", "light_novel", "web_novel"],
  anime: ["anime"],
};

function matchesMedia(cardType: string, requested: string): boolean {
  if (!requested || requested === "all") return true;
  const list = requested
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
  if (list.length === 0 || list.includes("all")) return true;
  return list.some(
    (req) => (MEDIA_ALIASES[req] ?? [req]).includes(cardType),
  );
}

export async function loadSnapshot(c: any): Promise<Snapshot | null> {
  if (cached && cachedExpires > Date.now()) return cached;
  const origin = new URL(c.req.url).origin;
  const fetchJson = async <T,>(path: string): Promise<T | null> => {
    try {
      const response = await fetch(`${origin}/data/${path}`);
      if (!response.ok) return null;
      return (await response.json()) as T;
    } catch {
      return null;
    }
  };

  const [catalog, facets] = await Promise.all([
    fetchJson<{
      fields?: string[];
      rows?: unknown[][];
      aliases?: Array<[number, string[]]>;
      languages?: string[];
      statuses?: string[];
      genres?: string[];
      tags?: string[];
    }>("catalog.json"),
    fetchJson<{ novels?: Record<string, { t?: number[]; g?: number[] }> }>(
      "facets.json",
    ),
  ]);
  if (!catalog?.fields || !catalog.rows) return null;

  const fields = catalog.fields;
  const at = (row: unknown[], name: string): any =>
    row[fields.indexOf(name)] ?? null;
  const genres = catalog.genres ?? facets?.novels ? (catalog.genres ?? []) : [];
  const tags = catalog.tags ?? [];
  const languages = catalog.languages ?? [];
  const statuses = catalog.statuses ?? [];

  const cards = new Map<number, SnapshotCard>();
  const bySlug = new Map<string, SnapshotCard>();
  const aliasMap = new Map<number, string[]>();
  for (const [id, names] of catalog.aliases ?? []) aliasMap.set(Number(id), names);

  for (const row of catalog.rows) {
    const id = Number(at(row, "id"));
    if (!Number.isInteger(id)) continue;
    const card: SnapshotCard = {
      id,
      slug: String(at(row, "slug") ?? ""),
      title: String(at(row, "title") ?? ""),
      aliases: aliasMap.get(id) ?? [],
      author: String(at(row, "author") ?? ""),
      cover_url: String(at(row, "cover") ?? "") || undefined,
      rating: Number(at(row, "rating") ?? 0),
      rating_votes: Number(at(row, "votes") ?? 0),
      reading_list_count: Number(at(row, "readers") ?? 0),
      year: Number(at(row, "year")) || undefined,
      // Rows carry the language_id/status_id indexes; the string columns are
      // absent from the export, so fall through to the dictionaries.
      language:
        (at(row, "language") as string | null) ??
        languages[Number(at(row, "language_id"))] ??
        "",
      status_trans:
        (at(row, "status_trans") as string | null) ??
        statuses[Number(at(row, "status_id"))] ??
        "",
      chapters_trans: Number(at(row, "translated_chapters") ?? 0),
      genre_names: ((at(row, "genre_ids") as number[]) ?? []).map(
        (index) => genres[index] ?? "",
      ),
      media_type: String(at(row, "media_type") ?? "novel"),
      source: String(at(row, "source") ?? "novelupdates"),
      external_id: String(at(row, "external_id") ?? id),
      external_url: String(at(row, "external_url") ?? "") || undefined,
    };
    cards.set(id, card);
    if (card.slug) bySlug.set(card.slug.toLowerCase(), card);
  }

  const tagNames = new Map<number, Set<string>>();
  for (const [rawId, value] of Object.entries(facets?.novels ?? {})) {
    const names = new Set<string>();
    for (const index of value.t ?? []) {
      const name = tags[index];
      if (name) names.add(name.toLowerCase());
    }
    tagNames.set(Number(rawId), names);
  }

  cached = { cards, bySlug, genres: catalog.genres ?? [], tags, tagNames, total: cards.size };
  cachedExpires = Date.now() + SNAPSHOT_TTL_MS;
  return cached;
}

// ---------------------------------------------------------------------------
// search
// ---------------------------------------------------------------------------

export function searchCards(
  snap: Snapshot,
  query: string,
  limit: number,
  mediaType = "all",
  source = "all",
): any[] {
  const needle = normalize(query);
  if (!needle) return [];
  const tokens = needle.split(" ").filter(Boolean);
  const scored: Array<{ card: SnapshotCard; score: number }> = [];
  for (const card of snap.cards.values()) {
    if (matchesMedia(card.media_type.toLowerCase(), mediaType)) {
      let score = Infinity;
      const title = normalize(card.title);
      if (title === needle) score = 0;
      else if (title.startsWith(needle)) score = 1;
      else if (card.aliases.some((a) => normalize(a) === needle)) score = 2;
      else if (title.includes(needle)) score = 4;
      else if (card.aliases.some((a) => normalize(a).includes(needle))) score = 5;
      else if (normalize(card.author).includes(needle)) score = 6;
      else if (
        tokens.length > 1 &&
        tokens.every((token) =>
          `${card.title} ${card.author} ${card.aliases.join(" ")}`
            .toLowerCase()
            .includes(token),
        )
      ) {
        score = 7;
      }
      if (Number.isFinite(score)) scored.push({ card, score });
    }
  }
  const filtered =
    !source || source === "all"
      ? scored
      : scored.filter(({ card }) => card.source === source);
  return filtered
    .sort(
      (a, b) =>
        a.score - b.score ||
        b.card.reading_list_count - a.card.reading_list_count ||
        a.card.id - b.card.id,
    )
    .slice(0, limit)
    .map(({ card }) => card);
}

// ---------------------------------------------------------------------------
// browse
// ---------------------------------------------------------------------------

export type BrowseFilters = {
  query: string;
  sort: string;
  language: string;
  author: string;
  genre: string;
  tag: string;
  min_rating: number;
  max_rating: number;
  min_votes: number;
  min_year: number;
  max_year: number;
  status: string;
  min_chapters: number;
  max_chapters: number;
  min_readers: number;
  max_readers: number;
  include_genres: string;
  exclude_genres: string;
  include_tags: string;
  exclude_tags: string;
  exclude_ids: string;
  direction: string;
  media_type: string;
  source: string;
};

function splitList(value: string): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => normalize(item))
    .filter(Boolean);
}

export function browseCards(
  snap: Snapshot,
  f: BrowseFilters,
  page: number,
  pageSize: number,
): any {
  const query = normalize(f.query ?? "");
  const genre = normalize(f.genre ?? "");
  const tag = normalize(f.tag ?? "");
  const includeGenres = splitList(f.include_genres);
  const excludeGenres = splitList(f.exclude_genres);
  const includeTags = splitList(f.include_tags);
  const excludeTags = splitList(f.exclude_tags);
  const excludedIds = new Set(
    (f.exclude_ids ?? "")
      .split(",")
      .map((v) => Number(v.trim()))
      .filter((n) => Number.isFinite(n)),
  );

  const items: SnapshotCard[] = [];
  for (const card of snap.cards.values()) {
    const type = card.media_type.toLowerCase();
    if (!matchesMedia(type, f.media_type)) continue;
    if (f.source && f.source !== "all" && card.source !== f.source) continue;
    if (excludedIds.has(card.id)) continue;
    if (query) {
      const haystack = normalize(
        `${card.title} ${card.author} ${card.aliases.join(" ")}`,
      );
      if (!haystack.includes(query)) continue;
    }
    if (f.language && normalize(card.language) !== normalize(f.language)) continue;
    if (f.author && normalize(card.author) !== normalize(f.author)) continue;
    if ((f.min_rating ?? 0) > card.rating) continue;
    if (f.max_rating && card.rating > f.max_rating) continue;
    if ((f.min_votes ?? 0) > card.rating_votes) continue;
    if (f.min_year && (!card.year || card.year < f.min_year)) continue;
    if (f.max_year && card.year && card.year > f.max_year) continue;
    if (f.status && !normalize(card.status_trans).includes(normalize(f.status)))
      continue;
    if (f.min_chapters && card.chapters_trans < f.min_chapters) continue;
    if (f.max_chapters && card.chapters_trans > f.max_chapters) continue;
    if (f.min_readers && card.reading_list_count < f.min_readers) continue;
    if (f.max_readers && card.reading_list_count > f.max_readers) continue;

    const genreNames = card.genre_names.map((name) => normalize(name)).filter(Boolean);
    if (genre && !genreNames.includes(genre)) continue;
    if (includeGenres.some((g) => !genreNames.includes(g))) continue;
    if (excludeGenres.some((g) => genreNames.includes(g))) continue;

    if (tag || includeTags.length || excludeTags.length) {
      const tagNames = snap.tagNames.get(card.id);
      if (!tagNames) continue;
      if (tag && !tagNames.has(tag)) continue;
      if (includeTags.some((t) => !tagNames.has(t))) continue;
      if (excludeTags.some((t) => tagNames.has(t))) continue;
    }
    items.push(card);
  }

  const direction = f.direction === "asc" ? 1 : -1;
  const total = items.length;
  const sorted = (() => {
    const copy = items.slice();
    switch (f.sort) {
      case "rating":
        return copy.sort(
          (a, b) =>
            direction * (a.rating - b.rating || a.rating_votes - b.rating_votes),
        );
      case "votes":
        return copy.sort(
          (a, b) =>
            direction * (a.rating_votes - b.rating_votes || a.rating - b.rating),
        );
      case "title":
        return copy.sort((a, b) => direction * a.title.localeCompare(b.title));
      case "newest":
        return copy.sort(
          (a, b) =>
            direction *
            ((a.year || 0) - (b.year || 0) ||
              a.reading_list_count - b.reading_list_count),
        );
      default:
        return copy.sort(
          (a, b) =>
            direction *
            (a.reading_list_count - b.reading_list_count ||
              a.rating_votes - b.rating_votes),
        );
    }
  })();

  const start = (page - 1) * pageSize;
  return {
    items: sorted.slice(start, start + pageSize).map((card) => ({
      id: card.id,
      title: card.title,
      slug: card.slug,
      novelupdates_url:
        card.external_url || `https://www.novelupdates.com/?p=${card.id}`,
      external_url: card.external_url,
      author: card.author,
      cover_url: card.cover_url,
      rating: card.rating,
      rating_votes: card.rating_votes,
      reading_list_count: card.reading_list_count,
      language: card.language,
      year: card.year,
      status_trans: card.status_trans,
      chapters_trans: card.chapters_trans,
      genres: card.genre_names.filter(Boolean),
      media_type: card.media_type,
      source: card.source,
      external_id: card.external_id,
    })),
    page,
    page_size: pageSize,
    total,
    has_more: start + Math.min(pageSize, Math.max(0, total - start)) < total,
    capabilities: { genres: snap.genres.length > 0, tags: true, total_is_exact: true },
  };
}

// ---------------------------------------------------------------------------
// catalog-wide statistics (insights)
// ---------------------------------------------------------------------------

export function distributionsFromCards(
  snap: Snapshot,
): CatalogDistributions {
  const rating: number[] = [];
  const votes: number[] = [];
  const readers: number[] = [];
  for (const card of snap.cards.values()) {
    rating.push(card.rating);
    votes.push(card.rating_votes);
    readers.push(card.reading_list_count);
  }
  const asc = (a: number, b: number) => a - b;
  return {
    total: rating.length,
    sorted: {
      rating: rating.sort(asc),
      rating_votes: votes.sort(asc),
      reading_list_count: readers.sort(asc),
    } as Record<MetricKey, number[]>,
  };
}

export function cohortsFromCards(snap: Snapshot): CohortIndexes {
  const byGenre = new Map<string, { population: number; readers: number[] }>();
  const byLanguage = new Map<string, { population: number; readers: number[] }>();
  const byYear = new Map<string, { population: number; readers: number[] }>();
  const novelGenres = new Map<number, string[]>();

  const push = (
    map: Map<string, { population: number; readers: number[] }>,
    key: string,
    readers: number,
  ) => {
    let entry = map.get(key);
    if (!entry) {
      entry = { population: 0, readers: [] };
      map.set(key, entry);
    }
    entry.population += 1;
    entry.readers.push(readers);
  };

  for (const card of snap.cards.values()) {
    if (card.genre_names.length) novelGenres.set(card.id, card.genre_names.slice());
    for (const name of card.genre_names) {
      if (name) push(byGenre, name, card.reading_list_count);
    }
    if (card.language) push(byLanguage, card.language, card.reading_list_count);
    if (card.year) push(byYear, String(card.year), card.reading_list_count);
  }
  for (const entry of byGenre.values()) entry.readers.sort((a, b) => a - b);
  for (const entry of byLanguage.values()) entry.readers.sort((a, b) => a - b);
  for (const entry of byYear.values()) entry.readers.sort((a, b) => a - b);

  return { byGenre, byLanguage, byYear, novelGenres };
}

/** Tag names per novel, for recommendation filtering and peer evidence. */
export function tagNamesFromCards(snap: Snapshot): Map<number, Set<string>> {
  return snap.tagNames;
}
