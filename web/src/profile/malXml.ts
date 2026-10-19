/**
 * Parse MyAnimeList XML exports (https://myanimelist.net/panel.php?go=export).
 *
 * MAL hands out `animelist_*.xml.gz` and `mangalist_*.xml.gz`; both are accepted, gzipped or not.
 * Rows only carry MAL ids, so `resolveMalIds` maps them onto AniList ids (AniList records `idMal`),
 * which are the ids the catalog already uses for anime/manga.
 */
import { MAX_PROFILE_FILE_BYTES } from './parser';
import { anilistSlug, mapAniListScore, ANILIST_SERIES_TYPE } from './anilistGdpr';
import type { ParsedProfileFile, ProfileEntry, ReadingStatus } from './types';

export function isMalXml(text: string): boolean {
  return /<myanimelist[\s>]/i.test(text.slice(0, 4096));
}

export function malSlug(kind: 'anime' | 'manga', malId: number): string {
  return `mal-${kind}-${malId}`;
}

export function mapMalStatus(status: string): ReadingStatus {
  const value = status.toLowerCase();
  if (value.includes('complete')) return 'completed';
  if (value.includes('plan')) return 'plan_to_read';
  if (value.includes('drop')) return 'dropped';
  if (value.includes('hold')) return 'paused';
  return 'reading';
}

/** MAL writes unset dates as 0000-00-00 (or with a zeroed month/day). */
function malDate(value: string): string | undefined {
  return /^\d{4}-(?!00)\d{2}-(?!00)\d{2}$/.test(value) && !value.startsWith('0000') ? value : undefined;
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

const XML_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** Text of the first `<name>` in a block, handling CDATA and entities (MAL titles use both). */
function xmlField(block: string, name: string): string {
  const match = block.match(new RegExp(`<${name}>(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([\\s\\S]*?))</${name}>`));
  if (!match) return '';
  if (match[1] !== undefined) return match[1].trim();
  return match[2].replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === '#') {
      const point = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1));
      return Number.isFinite(point) ? String.fromCodePoint(point) : whole;
    }
    return XML_ENTITIES[code.toLowerCase()] ?? whole;
  }).trim();
}

export async function parseMalXml(text: string, filename: string): Promise<ParsedProfileFile> {
  // Regex rather than DOMParser: the export is flat and regular, and this behaves the same in every runtime.
  if (!isMalXml(text)) throw new Error(`${filename} is not a valid MyAnimeList export.`);
  const kind: 'anime' | 'manga' = /<anime>/.test(text) ? 'anime' : 'manga';
  const blocks = [...text.matchAll(new RegExp(`<${kind}>([\\s\\S]*?)</${kind}>`, 'g'))].map((match) => match[1]);
  const entries: ProfileEntry[] = [];
  const duplicateSlugs: string[] = [];
  const seen = new Set<string>();
  let malformed = 0;

  for (const node of blocks) {
    const malId = Number(xmlField(node, kind === 'anime' ? 'series_animedb_id' : 'manga_mangadb_id'));
    const title = xmlField(node, kind === 'anime' ? 'series_title' : 'manga_title');
    if (!Number.isInteger(malId) || malId <= 0 || !title) {
      malformed += 1;
      continue;
    }
    const slug = malSlug(kind, malId);
    if (seen.has(slug)) {
      duplicateSlugs.push(slug);
      continue;
    }
    seen.add(slug);
    const units = Number(xmlField(node, kind === 'anime' ? 'my_watched_episodes' : 'my_read_chapters')) || 0;
    const volumes = kind === 'manga' ? Number(xmlField(node, 'my_read_volumes')) || 0 : 0;
    const progress = [units ? `${kind === 'anime' ? 'ep' : 'ch'} ${units}` : '', volumes ? `vol ${volumes}` : '']
      .filter(Boolean).join(' · ');
    entries.push({
      slug,
      imported_title: title,
      status: mapMalStatus(xmlField(node, 'my_status')),
      rating: mapAniListScore(Number(xmlField(node, 'my_score')), 2),
      progress: progress || undefined,
      progress_units: units || undefined,
      media_kind: kind,
      started_on: malDate(xmlField(node, 'my_start_date')),
      finished_on: malDate(xmlField(node, 'my_finish_date')),
      source_file: filename,
    });
  }
  if (!entries.length) throw new Error(`${filename} has no MyAnimeList entries to import.`);

  return {
    filename,
    fingerprint: await sha256(text),
    source: 'myanimelist',
    detected_status: 'reading',
    selected_status: 'reading',
    username: xmlField(text, 'user_name') || undefined,
    entries,
    curated_lists: [],
    malformed_rows: malformed,
    duplicate_slugs: duplicateSlugs,
    warnings: malformed ? [`${malformed} malformed row${malformed === 1 ? '' : 's'} skipped.`] : [],
  };
}

type MalLookupNode = { id: number; idMal: number | null };

/**
 * Rewrite MAL entries onto the AniList slug/id for the same title, so they match the catalog
 * (and dedupe against an AniList import). Entries AniList doesn't know keep their `mal-…` slug and
 * fall back to title matching. Fails soft when AniList is unreachable.
 */
export async function resolveMalIds(
  entries: ProfileEntry[],
  fetchImpl: typeof fetch = fetch,
  pauseMs = 700,
): Promise<ProfileEntry[]> {
  const query = `
    query ($ids: [Int], $type: MediaType) {
      Page(page: 1, perPage: 50) { media(idMal_in: $ids, type: $type) { id idMal } }
    }
  `;
  const anilistByMal = new Map<string, number>();
  for (const type of ['ANIME', 'MANGA'] as const) {
    const kind = type === 'ANIME' ? 'anime' : 'manga';
    const ids = entries
      .map((entry) => entry.slug.match(new RegExp(`^mal-${kind}-(\\d+)$`))?.[1])
      .filter((id): id is string => !!id)
      .map(Number);
    for (let i = 0; i < ids.length; i += 50) {
      try {
        const response = await fetchImpl('https://graphql.anilist.co', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ query, variables: { ids: ids.slice(i, i + 50), type } }),
        });
        if (response.ok) {
          const body = await response.json() as { data?: { Page?: { media?: MalLookupNode[] } } };
          for (const media of body.data?.Page?.media || []) {
            if (media.idMal) anilistByMal.set(malSlug(kind, media.idMal), media.id);
          }
        }
      } catch {
        // Offline / rate-limited: leave these on title matching.
      }
      if (i + 50 < ids.length) await new Promise((resolve) => setTimeout(resolve, pauseMs));
    }
  }
  return entries.map((entry) => {
    const anilistId = anilistByMal.get(entry.slug);
    if (!anilistId) return entry;
    const type = entry.media_kind === 'anime' ? ANILIST_SERIES_TYPE.Anime : ANILIST_SERIES_TYPE.Manga;
    return { ...entry, slug: anilistSlug(type, anilistId) };
  });
}

export async function parseMalFile(file: File, text: string): Promise<ParsedProfileFile> {
  if (file.size > MAX_PROFILE_FILE_BYTES) throw new Error(`${file.name} is larger than 15 MB.`);
  const parsed = await parseMalXml(text, file.name.replace(/\.gz$/i, ''));
  return { ...parsed, entries: await resolveMalIds(parsed.entries) };
}
