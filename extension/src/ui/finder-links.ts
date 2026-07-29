import type { BrowseNovel } from '../../../web/src/types';

export function extensionFinderNovelUrl(novel: BrowseNovel): string {
  const candidates = [novel.external_url, novel.novelupdates_url];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const url = new URL(candidate);
      if (
        url.protocol === 'https:' &&
        url.hostname === 'www.novelupdates.com' &&
        (/^\/series\/[a-z0-9]+(?:-[a-z0-9]+)*\/?$/.test(url.pathname) ||
          (url.pathname === '/' && /^[1-9]\d*$/.test(url.searchParams.get('p') ?? '')))
      ) {
        return url.href;
      }
    } catch {
      // Fall through to the stable numeric Novel Updates route.
    }
  }
  return `https://www.novelupdates.com/?p=${novel.id}`;
}
