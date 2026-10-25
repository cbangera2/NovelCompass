function resolveFormatKey(id: number, mediaType?: string): 'novel' | 'manga' | 'anime' {
  const mt = (mediaType || '').toLowerCase();
  if (mt === 'anime' || (!mt && id >= 3_000_000)) return 'anime';
  if (
    ['manga', 'manhwa', 'manhua', 'comic'].includes(mt) ||
    (!mt && id >= 2_000_000 && id < 3_000_000)
  ) {
    return 'manga';
  }
  // novel / light_novel / web_novel, or unknown low IDs
  return 'novel';
}

/** Anime count episodes; everything else counts chapters. */
export function progressUnitLabel(id: number, mediaType?: string, short = false): string {
  const anime = resolveFormatKey(id, mediaType) === 'anime';
  if (short) return anime ? 'eps' : 'ch.';
  return anime ? 'episodes' : 'chapters';
}

/** Anime have watchers; everything else has readers. */
export function audienceLabel(id: number, mediaType?: string): string {
  return resolveFormatKey(id, mediaType) === 'anime' ? 'watchers' : 'readers';
}

export function itemPageUrl(id: number, from?: number, mediaType?: string): string {
  const view = resolveFormatKey(id, mediaType);
  const params = new URLSearchParams({ view, id: String(id) });
  if (from && from !== id) params.set('from', String(from));
  return `${import.meta.env.BASE_URL}?${params.toString()}`;
}

export interface MediaBadgeInfo {
  formatKey: 'novel' | 'manga' | 'anime';
  formatLabel: string;
  sourceKey: 'novelupdates' | 'anilist' | 'novelphoenix';
  sourceLabel: string;
}

export function getMediaBadgeInfo(item: { id: number; media_type?: string; source?: string }): MediaBadgeInfo {
  const mt = (item.media_type || '').toLowerCase();
  const formatKey = resolveFormatKey(item.id, item.media_type);
  const isLN = mt === 'light_novel' || mt === 'ln';
  const formatLabel =
    formatKey === 'anime' ? 'Anime' : formatKey === 'manga' ? 'Manga' : isLN ? 'LN' : 'Novel';

  const isNovelPhoenix = item.source === 'novelphoenix';
  const isAniList = !isNovelPhoenix && (item.source === 'anilist' || item.id >= 2_000_000);
  const sourceKey = isNovelPhoenix ? 'novelphoenix' : isAniList ? 'anilist' : 'novelupdates';
  const sourceLabel = isNovelPhoenix ? 'Novel Phoenix' : isAniList ? 'AniList' : 'NovelUpdates';

  return { formatKey, formatLabel, sourceKey, sourceLabel };
}

/**
 * True when a result set spans more than one format (novel / manga / anime). The cover format pill
 * means "this one is not the default", so it is only shown on sets that actually mix formats.
 * Light novels and web novels share the "novel" format, so they do not count as mixed.
 */
export function hasMixedFormats(items: ReadonlyArray<{ id: number; media_type?: string; source?: string }>): boolean {
  return new Set(items.map((item) => getMediaBadgeInfo(item).formatKey)).size > 1;
}

export function novelPageUrl(id: number, from?: number, mediaType?: string): string {
  return itemPageUrl(id, from, mediaType);
}

/** NovelUpdates' generic "no image" placeholder counts as no cover. */
export function hasUsableCover(coverUrl?: string | null): boolean {
  if (!coverUrl) return false;
  return !coverUrl.toLowerCase().includes('noimagefound');
}

/** Translate raw status_trans values ("Yes"/"No") into human-readable labels. */
export function formatStatusLabel(status?: string | null): string {
  if (status === 'Yes') return 'Completed';
  if (status === 'No') return 'Ongoing';
  return status || '';
}
