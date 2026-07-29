import type { NovelSearchResult } from '../types';
import { StaticDataSource, type StaticDataSourceOptions } from './static';

export type NovelUpdatesSeriesIdentity = {
  id?: number;
  slug?: string;
  title?: string;
};

export type CatalogResolution =
  | { status: 'resolved'; novel: NovelSearchResult; matchedBy: 'id' | 'slug' | 'title' }
  | { status: 'unresolved'; identity: NovelUpdatesSeriesIdentity };

/**
 * Extract only stable public identity from a Novel Updates series URL.
 * Page adapters may supplement this with the canonical title or numeric id.
 */
export function identityFromNovelUpdatesUrl(url: string | URL): NovelUpdatesSeriesIdentity {
  const parsed = typeof url === 'string' ? new URL(url) : url;
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'www.novelupdates.com') return {};

  const id = Number(parsed.searchParams.get('p'));
  const slugMatch = parsed.pathname.match(/^\/series\/([^/]+)\/?$/i);
  return {
    ...(Number.isSafeInteger(id) && id > 0 ? { id } : {}),
    ...(slugMatch?.[1] ? { slug: decodeURIComponent(slugMatch[1]).toLowerCase() } : {})
  };
}

/**
 * Resolve a live NU page to the static catalog without making resolution a
 * prerequisite for rendering the live page. Numeric identity wins, followed
 * by slug and finally the adapter-provided title fallback.
 */
export async function resolveNovelUpdatesIdentity(
  source: StaticDataSource,
  identity: NovelUpdatesSeriesIdentity
): Promise<CatalogResolution> {
  if (identity.id && Number.isSafeInteger(identity.id)) {
    const byId = await source.resolveNovelIds([identity.id]);
    const novel = byId.get(identity.id);
    if (novel && novel.source !== 'anilist') {
      return { status: 'resolved', novel, matchedBy: 'id' };
    }
  }

  const slug = identity.slug?.trim().toLowerCase();
  const title = identity.title?.trim() || '';
  if (slug || title) {
    // resolveSlugs already performs exact normalized-title/alias fallback, but
    // the synthetic key lets title-only page snapshots use the same contract.
    const key = slug || '__title_only__';
    const bySlug = await source.resolveSlugs([{ slug: key, title }]);
    const novel = bySlug.get(key);
    if (novel && novel.source !== 'anilist') {
      return {
        status: 'resolved',
        novel,
        matchedBy: slug && novel.slug.toLowerCase() === slug ? 'slug' : 'title'
      };
    }
  }
  return { status: 'unresolved', identity };
}

/**
 * Extension entry point. Callers provide a packaged or cached dataset URL and
 * may inject a cache-aware fetch implementation. The Python API is never
 * considered by this factory.
 */
export async function createExtensionStaticDataSource(
  options: StaticDataSourceOptions & { baseUrl: string }
): Promise<StaticDataSource> {
  const source = new StaticDataSource({ ...options, warmCatalogWhenIdle: false });
  await source.getManifest();
  return source;
}
