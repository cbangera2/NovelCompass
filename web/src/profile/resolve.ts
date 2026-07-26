import { RecommendationDataSource } from '../data';
import { ParsedProfileFile, ProfileEntry } from './types';

const ANILIST_MANGA_ID_OFFSET = 2_000_000;
const ANILIST_ANIME_ID_OFFSET = 3_000_000;

export function applyResolvedNovelIds(
  entries: ProfileEntry[],
  resolved: Map<string, { id: number }>
): ProfileEntry[] {
  return entries.map((entry) => ({
    ...entry,
    // A missing resolution may be transient (offline API, stale static
    // snapshot, or changed title). Never destroy a previously verified key.
    novel_id: resolved.get(entry.slug.toLowerCase())?.id ?? entry.novel_id
  }));
}

function parseAniListSlug(slug: string): { isAnime: boolean; seriesId: number } | null {
  const anime = slug.match(/^anilist-anime-(\d+)$/i);
  if (anime) return { isAnime: true, seriesId: Number(anime[1]) };
  const manga = slug.match(/^anilist-(\d+)$/i);
  if (manga) return { isAnime: false, seriesId: Number(manga[1]) };
  return null;
}

function anilistCatalogId(isAnime: boolean, seriesId: number): number {
  return (isAnime ? ANILIST_ANIME_ID_OFFSET : ANILIST_MANGA_ID_OFFSET) + seriesId;
}

/**
 * Confirm prefilled AniList offset IDs actually exist in the active catalog.
 * Missing titles stay in the profile (with slug + imported title) but without
 * novel_id so the UI marks them unmatched instead of linking to dead pages.
 */
export async function confirmCatalogPresence(
  entries: ProfileEntry[],
  source: RecommendationDataSource
): Promise<ProfileEntry[]> {
  const candidateIds: number[] = [];
  for (const entry of entries) {
    const anilist = parseAniListSlug(entry.slug);
    const candidateId = entry.novel_id
      ?? (anilist ? anilistCatalogId(anilist.isAnime, anilist.seriesId) : undefined);
    if (candidateId != null) candidateIds.push(candidateId);
  }
  const present = await source.resolveNovelIds(candidateIds);
  const titleById = new Map([...present.entries()].map(([id, novel]) => [id, novel.title]));

  return entries.map((entry) => {
    const anilist = parseAniListSlug(entry.slug);
    const candidateId = entry.novel_id
      ?? (anilist ? anilistCatalogId(anilist.isAnime, anilist.seriesId) : undefined);
    if (candidateId == null || !present.has(candidateId)) {
      return { ...entry, novel_id: undefined };
    }
    const catalogTitle = titleById.get(candidateId);
    const placeholder = /^AniList (Anime|Manga) #\d+$/i.test(entry.imported_title);
    return {
      ...entry,
      novel_id: candidateId,
      imported_title: placeholder && catalogTitle ? catalogTitle : entry.imported_title,
    };
  });
}

export async function resolveEntries(
  files: ParsedProfileFile[],
  source: RecommendationDataSource
): Promise<ProfileEntry[]> {
  const entries = files.flatMap((file) => file.entries);
  const hasAniList = entries.some((entry) => /^anilist(?:-anime)?-\d+$/i.test(entry.slug));

  if (hasAniList) {
    const confirmed = await confirmCatalogPresence(entries, source);
    const unresolved = confirmed.filter(
      (entry) => entry.novel_id == null && !/^anilist(?:-anime)?-\d+$/i.test(entry.slug)
    );
    if (!unresolved.length) return confirmed;
    const resolved = await source.resolveSlugs(
      unresolved.map((entry) => ({ slug: entry.slug, title: entry.imported_title }))
    );
    return applyResolvedNovelIds(confirmed, resolved);
  }

  const resolved = await source.resolveSlugs(
    entries.map((entry) => ({ slug: entry.slug, title: entry.imported_title }))
  );
  return applyResolvedNovelIds(entries, resolved);
}
