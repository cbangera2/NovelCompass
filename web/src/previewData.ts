import { audienceLabel, formatStatusLabel, progressUnitLabel } from './novelLinks';
import type { BrowseNovel, NovelDetail, NovelSearchResult, Recommendation } from './types';

/**
 * Data behind the global hover card (see CoverPreview.tsx). Everything is optional except the
 * identity; the card shows whatever a surface already has and fetches the synopsis when it is missing.
 * Rating and votes are deliberately not here: every surface shows the rating on the cover or chip.
 */
export interface PreviewData {
  id: number;
  title: string;
  author?: string;
  language?: string;
  media_type?: string;
  year?: number;
  synopsis?: string;
  tags?: string[];
  reading_list_count?: number;
  chapters_trans?: number;
  status_trans?: string;
  matchPercent?: number;
  signals?: Array<{ label: string; rank: number }>;
  sharedTags?: string[];
  bullets?: string[];
  curatedListCount?: number;
  /** Names of the user's own lists this title came from (For You rows). */
  onYourLists?: string[];
}

export const CHANNEL_LABELS: Record<string, string> = {
  vector: 'Meaning', tag: 'Tags', direct_rec: 'Reader recs', rec_list: 'Curated lists', ease: 'Co-read pattern', structural: 'Catalog structure'
};
export const signalStrength = (rank: number) => Math.max(0.12, 1 - Math.log10(Math.max(1, rank)) / 2);

/** Layer `patch` over `base`, skipping fields the patch leaves undefined so a sparse mapper never erases good data. */
export function mergeDefined<T extends object>(base: T | undefined, patch: Partial<T>): T {
  const merged = { ...base } as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) merged[key] = value;
  }
  return merged as T;
}

export function previewFromRecommendation(item: Recommendation): PreviewData {
  const signals = Object.entries(CHANNEL_LABELS)
    .map(([channel, label]) => ({ label, rank: item.channel_ranks?.[channel] }))
    .filter((signal): signal is { label: string; rank: number } => Number.isFinite(signal.rank))
    .sort((a, b) => a.rank - b.rank);
  return {
    id: item.target_id, title: item.title, author: item.author, language: item.language,
    reading_list_count: item.reading_list_count, chapters_trans: item.chapters_trans,
    status_trans: item.status_trans, media_type: item.media_type, matchPercent: item.match_score_percent, signals,
    sharedTags: item.shared_tags, bullets: item.evidence_bullets?.filter((bullet) => !/^(Shared key tropes|Co-occurs on)/i.test(bullet)).slice(0, 3),
    curatedListCount: item.curated_lists?.length
  };
}

/** Search rows carry little beyond identity, author and format; the synopsis arrives with the lazy detail fetch. */
export function previewFromSearch(item: NovelSearchResult & Partial<Pick<BrowseNovel, 'language' | 'year' | 'reading_list_count'>>): PreviewData {
  return {
    id: item.id, title: item.title, author: item.author || undefined, media_type: item.media_type,
    language: item.language, year: item.year, reading_list_count: item.reading_list_count
  };
}

export function previewFromBrowse(item: BrowseNovel): PreviewData {
  return {
    ...previewFromSearch(item), chapters_trans: item.chapters_trans, status_trans: item.status_trans || undefined,
    tags: item.tags?.length ? item.tags.slice(0, 10) : undefined
  };
}

/** A row of the peer comparison on a novel page. */
export function previewFromPeer(row: { id: number; title: string; author?: string; language?: string; year?: number; readers: number }): PreviewData {
  return { id: row.id, title: row.title, author: row.author, language: row.language, year: row.year, reading_list_count: row.readers };
}

/** A library entry plus whatever catalog row it resolved to. Unmatched entries have nothing to preview. */
export function previewFromProfile(entry: { novel_id?: number; imported_title: string }, meta?: NovelSearchResult): PreviewData | null {
  if (entry.novel_id == null) return null;
  return { ...(meta ? previewFromSearch(meta) : {}), id: entry.novel_id, title: meta?.title || entry.imported_title };
}

export function previewFromDetail(detail: NovelDetail): PreviewData {
  return {
    id: detail.id, title: detail.title, author: detail.author, language: detail.language,
    reading_list_count: detail.reading_list_count, chapters_trans: detail.chapters_trans,
    status_trans: detail.status_trans, media_type: detail.media_type, year: detail.year, synopsis: detail.synopsis,
    tags: detail.tags?.slice(0, 10)
  };
}

export const SYNOPSIS_CHARS = 320;
export const TAG_LIMIT = 8;

export function compactText(text: string, max = SYNOPSIS_CHARS) {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max).replace(/\s\S*$/, '')}…` : clean;
}

/** The tags the card shows: the ones shared with the seed when there are any, otherwise the title's top tags. */
export function previewTags(data: PreviewData): { label: string; tags: string[] } {
  if (data.sharedTags?.length) return { label: `Shared tags · ${data.sharedTags.length}`, tags: data.sharedTags };
  return { label: 'Top tags', tags: data.tags || [] };
}

/** Facts no surface shows on its own tile or row. Rating is intentionally absent. */
export function previewFacts(data: PreviewData): Array<{ value: string; label: string }> {
  const facts: Array<{ value: string; label: string }> = [];
  if (data.reading_list_count != null) facts.push({ value: data.reading_list_count.toLocaleString(), label: audienceLabel(data.id, data.media_type) });
  if (data.chapters_trans) facts.push({ value: data.chapters_trans.toLocaleString(), label: progressUnitLabel(data.id, data.media_type) });
  if (data.status_trans && data.status_trans !== 'Unknown') facts.push({ value: formatStatusLabel(data.status_trans), label: 'status' });
  if (data.curatedListCount) facts.push({ value: String(data.curatedListCount), label: `curated list${data.curatedListCount === 1 ? '' : 's'}` });
  return facts;
}
