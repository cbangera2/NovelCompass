export function itemPageUrl(id: number, from?: number, mediaType?: string): string {
  const isAnime = mediaType === 'anime' || id >= 3000000;
  const isManga = mediaType === 'manga' || (id >= 2000000 && id < 3000000);
  const view = isAnime ? 'anime' : isManga ? 'manga' : 'novel';
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
  const isAnime = item.media_type === 'anime' || item.id >= 3000000;
  const isManga = item.media_type === 'manga' || (item.id >= 2000000 && item.id < 3000000);
  const isLN = item.media_type === 'light_novel' || item.media_type === 'ln';

  const formatKey = isAnime ? 'anime' : isManga ? 'manga' : 'novel';
  const formatLabel = isAnime ? 'Anime' : isManga ? 'Manga' : isLN ? 'LN' : 'Novel';

  const isAniList = item.source === 'anilist' || item.id >= 2000000;
  const sourceKey = isAniList ? 'anilist' : 'novelupdates';
  const sourceLabel = isAniList ? 'AniList' : 'NovelUpdates';

  return { formatKey, formatLabel, sourceKey, sourceLabel };
}

export function novelPageUrl(id: number, from?: number, mediaType?: string): string {
  return itemPageUrl(id, from, mediaType);
}


