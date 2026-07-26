export function itemPageUrl(id: number, from?: number, mediaType?: string): string {
  const isAnime = mediaType === 'anime' || id >= 3000000;
  const isManga = mediaType === 'manga' || (id >= 2000000 && id < 3000000);
  const view = isAnime ? 'anime' : isManga ? 'manga' : 'novel';
  const params = new URLSearchParams({ view, id: String(id) });
  if (from && from !== id) params.set('from', String(from));
  return `${import.meta.env.BASE_URL}?${params.toString()}`;
}

export function novelPageUrl(id: number, from?: number, mediaType?: string): string {
  return itemPageUrl(id, from, mediaType);
}
