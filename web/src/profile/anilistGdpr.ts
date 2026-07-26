/**
 * Parse AniList GDPR data exports (Settings → Account → Download Data).
 *
 * The export's `lists` rows only include series_id / status / score — no titles.
 * We derive stable catalog slugs from AniList IDs (matching our ingest offsets)
 * and optionally enrich titles via the public GraphQL API.
 */
import type { ParsedProfileFile, ProfileEntry, ReadingStatus } from './types';
import { MAX_PROFILE_FILE_BYTES } from './parser';

export const ANILIST_GDPR_PARSER_VERSION = 1;

/** Matches AniList/Anilyzer GDPR enum conventions. */
export const ANILIST_STATUS = {
  InProgress: 0,
  Planning: 1,
  Completed: 2,
  Dropped: 3,
  Paused: 4,
  Repeating: 5,
} as const;

export const ANILIST_SERIES_TYPE = {
  Anime: 0,
  Manga: 1,
} as const;

/** score_type on the user object in GDPR dumps. */
export const ANILIST_SCORE_TYPE = {
  Point100: 0,
  Point10Decimal: 1,
  Point10: 2,
  Point5: 3,
  Point3: 4,
} as const;

const ANILIST_MANGA_ID_OFFSET = 2_000_000;
const ANILIST_ANIME_ID_OFFSET = 3_000_000;

export interface AniListGdprListRow {
  id?: number;
  series_type: number;
  series_id: number;
  status: number;
  score?: number | null;
  progress?: number | null;
  progress_volume?: number | null;
  private?: number | null;
  notes?: string | null;
  started_on?: number | null;
  finished_on?: number | null;
}

export interface AniListGdprExport {
  user?: {
    id?: number;
    user_name?: string;
    display_name?: string;
    score_type?: number;
  };
  lists?: AniListGdprListRow[];
}

export function isAniListGdprExport(value: unknown): value is AniListGdprExport {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return Array.isArray(item.lists) && (item.user == null || typeof item.user === 'object');
}

export function anilistCatalogId(seriesType: number, seriesId: number): number {
  return seriesType === ANILIST_SERIES_TYPE.Anime
    ? ANILIST_ANIME_ID_OFFSET + seriesId
    : ANILIST_MANGA_ID_OFFSET + seriesId;
}

export function anilistSlug(seriesType: number, seriesId: number): string {
  return seriesType === ANILIST_SERIES_TYPE.Anime
    ? `anilist-anime-${seriesId}`
    : `anilist-${seriesId}`;
}

/** AniList GDPR dates are numeric YYYYMMDD (or 0 when unset). */
export function yyyymmddToIso(value: number | null | undefined): string | undefined {
  if (!value || value < 10000101) return undefined;
  const text = String(value).padStart(8, '0');
  const year = text.slice(0, 4);
  const month = text.slice(4, 6);
  const day = text.slice(6, 8);
  if (Number(month) < 1 || Number(month) > 12 || Number(day) < 1 || Number(day) > 31) return undefined;
  return `${year}-${month}-${day}`;
}

export function mapAniListStatus(status: number): ReadingStatus {
  switch (status) {
    case ANILIST_STATUS.Completed:
      return 'completed';
    case ANILIST_STATUS.Planning:
      return 'plan_to_read';
    case ANILIST_STATUS.Dropped:
      return 'dropped';
    case ANILIST_STATUS.Paused:
      return 'paused';
    case ANILIST_STATUS.Repeating:
    case ANILIST_STATUS.InProgress:
    default:
      return 'reading';
  }
}

/** Normalize AniList user scores onto the 1–5 Novel Compass scale. */
export function mapAniListScore(score: number | null | undefined, scoreType: number = 0): number | undefined {
  if (score == null || !Number.isFinite(score) || score <= 0) return undefined;
  let onFive: number;
  switch (scoreType) {
    case 1: // POINT_10_DECIMAL
    case 2: // POINT_10
      onFive = score / 2;
      break;
    case 3: // POINT_5
      onFive = score;
      break;
    case 4: // POINT_3
      // 1 sad / 2 neutral / 3 happy → coarse 2 / 3.5 / 5
      onFive = score <= 1 ? 2 : score <= 2 ? 3.5 : 5;
      break;
    case 0: // POINT_100
    default:
      onFive = score / 20;
      break;
  }
  return Math.round(Math.min(5, Math.max(1, onFive)) * 10) / 10;
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function isListRow(value: unknown): value is AniListGdprListRow {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return typeof row.series_id === 'number' && typeof row.series_type === 'number' && typeof row.status === 'number';
}

export async function parseAniListGdprFile(file: File): Promise<ParsedProfileFile> {
  if (file.size > MAX_PROFILE_FILE_BYTES) throw new Error(`${file.name} is larger than 15 MB.`);
  const text = await file.text();
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error(`${file.name} is not valid JSON.`);
  }
  if (!isAniListGdprExport(raw)) {
    throw new Error(`${file.name} does not look like an AniList GDPR data export (expected a top-level "lists" array).`);
  }

  const scoreType = raw.user?.score_type ?? ANILIST_SCORE_TYPE.Point100;
  const username = raw.user?.display_name || raw.user?.user_name;
  const entries: ProfileEntry[] = [];
  const seen = new Set<string>();
  const duplicateSlugs: string[] = [];
  let malformed = 0;
  let skippedPrivate = 0;

  for (const row of raw.lists || []) {
    if (!isListRow(row) || !Number.isFinite(row.series_id) || row.series_id <= 0) {
      malformed += 1;
      continue;
    }
    if (row.private === 1) {
      skippedPrivate += 1;
      continue;
    }
    const seriesType = row.series_type === ANILIST_SERIES_TYPE.Anime
      ? ANILIST_SERIES_TYPE.Anime
      : ANILIST_SERIES_TYPE.Manga;
    const slug = anilistSlug(seriesType, row.series_id);
    if (seen.has(slug)) {
      duplicateSlugs.push(slug);
      continue;
    }
    seen.add(slug);

    const catalogId = anilistCatalogId(seriesType, row.series_id);
    const progressParts: string[] = [];
    const progressUnits = row.progress && row.progress > 0 ? Number(row.progress) : undefined;
    if (progressUnits) {
      progressParts.push(seriesType === ANILIST_SERIES_TYPE.Anime ? `ep ${progressUnits}` : `ch ${progressUnits}`);
    }
    if (row.progress_volume && row.progress_volume > 0) {
      progressParts.push(`vol ${row.progress_volume}`);
    }

    entries.push({
      // Prefill catalog id from AniList offset scheme; resolve step confirms presence.
      novel_id: catalogId,
      slug,
      imported_title: seriesType === ANILIST_SERIES_TYPE.Anime
        ? `AniList Anime #${row.series_id}`
        : `AniList Manga #${row.series_id}`,
      status: mapAniListStatus(row.status),
      rating: mapAniListScore(row.score, scoreType),
      progress: progressParts.length ? progressParts.join(' · ') : undefined,
      progress_units: progressUnits,
      media_kind: seriesType === ANILIST_SERIES_TYPE.Anime ? 'anime' : 'manga',
      started_on: yyyymmddToIso(row.started_on),
      finished_on: yyyymmddToIso(row.finished_on),
      source_file: file.name,
    });
  }

  if (!entries.length) {
    throw new Error(`${file.name} has no AniList list entries to import.`);
  }

  const warnings: string[] = [];
  if (malformed) warnings.push(`${malformed} malformed list row${malformed === 1 ? '' : 's'} skipped.`);
  if (skippedPrivate) warnings.push(`${skippedPrivate} private list entr${skippedPrivate === 1 ? 'y' : 'ies'} skipped.`);
  warnings.push(
    'Titles are filled from AniList when online. Catalog matches use your local Novel Compass snapshot (only titles already ingested appear as matched).'
  );

  return {
    filename: file.name,
    fingerprint: await sha256(text),
    detected_status: 'reading',
    selected_status: 'reading',
    username: username || undefined,
    entries,
    curated_lists: [],
    malformed_rows: malformed,
    duplicate_slugs: duplicateSlugs,
    warnings,
  };
}

type AniListTitleNode = {
  id: number;
  type?: string;
  title?: {
    english?: string | null;
    romaji?: string | null;
    userPreferred?: string | null;
  };
};

/**
 * Batch-fetch English/romaji titles for GDPR list rows via AniList GraphQL.
 * Fails soft: returns whatever was resolved; callers keep placeholder titles otherwise.
 */
export async function enrichAniListTitles(
  entries: ProfileEntry[],
  fetchImpl: typeof fetch = fetch
): Promise<ProfileEntry[]> {
  const idBySlug = new Map<string, { id: number; type: 'ANIME' | 'MANGA' }>();
  for (const entry of entries) {
    const anime = entry.slug.match(/^anilist-anime-(\d+)$/i);
    const manga = entry.slug.match(/^anilist-(\d+)$/i);
    if (anime) idBySlug.set(entry.slug, { id: Number(anime[1]), type: 'ANIME' });
    else if (manga) idBySlug.set(entry.slug, { id: Number(manga[1]), type: 'MANGA' });
  }
  if (!idBySlug.size) return entries;

  const animeIds = [...idBySlug.values()].filter((item) => item.type === 'ANIME').map((item) => item.id);
  const mangaIds = [...idBySlug.values()].filter((item) => item.type === 'MANGA').map((item) => item.id);
  const titles = new Map<string, string>();

  const query = `
    query ($ids: [Int], $type: MediaType) {
      Page(page: 1, perPage: 50) {
        media(id_in: $ids, type: $type) {
          id
          type
          title { english romaji userPreferred }
        }
      }
    }
  `;

  async function fetchChunk(ids: number[], type: 'ANIME' | 'MANGA'): Promise<void> {
    for (let i = 0; i < ids.length; i += 50) {
      const chunk = ids.slice(i, i + 50);
      try {
        const response = await fetchImpl('https://graphql.anilist.co', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ query, variables: { ids: chunk, type } }),
        });
        if (!response.ok) continue;
        const body = await response.json() as { data?: { Page?: { media?: AniListTitleNode[] } } };
        for (const media of body.data?.Page?.media || []) {
          const title =
            media.title?.english ||
            media.title?.userPreferred ||
            media.title?.romaji ||
            `AniList ${type === 'ANIME' ? 'Anime' : 'Manga'} #${media.id}`;
          const slug = type === 'ANIME' ? `anilist-anime-${media.id}` : `anilist-${media.id}`;
          titles.set(slug, title);
        }
      } catch {
        // Offline / CORS / rate-limit: keep placeholders.
      }
      // Gentle pacing for large libraries.
      if (i + 50 < ids.length) await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  await fetchChunk(animeIds, 'ANIME');
  await fetchChunk(mangaIds, 'MANGA');

  return entries.map((entry) => {
    const title = titles.get(entry.slug);
    return title ? { ...entry, imported_title: title } : entry;
  });
}
