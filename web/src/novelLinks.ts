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

export function itemPageUrl(id: number, from?: number, mediaType?: string): string {
  const view = resolveFormatKey(id, mediaType);
  const params = new URLSearchParams({ view, id: String(id) });
  if (from && from !== id) params.set('from', String(from));
  return `${import.meta.env.BASE_URL}?${params.toString()}`;
}

export interface MediaBadgeInfo {
  formatKey: 'novel' | 'manga' | 'anime';
  formatLabel: string;
  sourceKey: 'novelupdates' | 'anilist';
  sourceLabel: string;
}

export function getMediaBadgeInfo(item: { id: number; media_type?: string; source?: string }): MediaBadgeInfo {
  const mt = (item.media_type || '').toLowerCase();
  const formatKey = resolveFormatKey(item.id, item.media_type);
  const isLN = mt === 'light_novel' || mt === 'ln';
  const formatLabel =
    formatKey === 'anime' ? 'Anime' : formatKey === 'manga' ? 'Manga' : isLN ? 'LN' : 'Novel';

  const isAniList = item.source === 'anilist' || item.id >= 2_000_000;
  const sourceKey = isAniList ? 'anilist' : 'novelupdates';
  const sourceLabel = isAniList ? 'AniList' : 'NovelUpdates';

  return { formatKey, formatLabel, sourceKey, sourceLabel };
}

export function novelPageUrl(id: number, from?: number, mediaType?: string): string {
  return itemPageUrl(id, from, mediaType);
}


