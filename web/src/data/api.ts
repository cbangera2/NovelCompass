import {
  BrowseNovel,
  BrowseRequest,
  BrowseResponse,
  DatasetManifest,
  FilterOptions,
  NovelDetail,
  NovelInsights,
  NovelSearchResult,
  RecommendRequest,
  RecommendResponse
} from '../types';
import { DataSourceError, RecommendationDataSource } from './source';

const SUPPORTED_SCHEMA = 1;
const SUPPORTED_ALGORITHM = 1;

async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new DataSourceError(body?.detail || `Server returned ${response.status}: ${response.statusText}`);
  }
  return response.json() as Promise<T>;
}

export class ApiDataSource implements RecommendationDataSource {
  readonly mode = 'api' as const;
  private manifestPromise?: Promise<DatasetManifest>;
  private optionsPromise?: Promise<FilterOptions>;

  async getManifest(): Promise<DatasetManifest> {
    if (!this.manifestPromise) {
      this.manifestPromise = apiFetch<any>('/api/health').then((health) => {
        const manifest = {
          schema_version: health.schema_version ?? 1,
          algorithm_version: health.algorithm_version,
          dataset_version: health.dataset_version ?? 'live',
          generated_at: health.generated_at,
          novel_count: health.novel_count ?? 0
        };
        if (manifest.schema_version !== SUPPORTED_SCHEMA) {
          throw new DataSourceError(
            `API schema ${manifest.schema_version} is unsupported (expected ${SUPPORTED_SCHEMA}).`
          );
        }
        if (manifest.algorithm_version != null && manifest.algorithm_version !== SUPPORTED_ALGORITHM) {
          throw new DataSourceError(
            `API algorithm ${manifest.algorithm_version} is unsupported (expected ${SUPPORTED_ALGORITHM}).`
          );
        }
        return manifest;
      });
    }
    return this.manifestPromise;
  }

  async searchNovels(query: string, limit: number, signal?: AbortSignal): Promise<NovelSearchResult[]> {
    const body = await apiFetch<{ results: NovelSearchResult[] }>(
      `/api/search?q=${encodeURIComponent(query)}&limit=${limit}`,
      { signal }
    );
    return body.results || [];
  }

  async getOptions(): Promise<FilterOptions> {
    if (!this.optionsPromise) {
      this.optionsPromise = apiFetch<FilterOptions & { popular_tags?: string[] }>('/api/options')
        .then((options) => ({ ...options, tags: options.tags || options.popular_tags || [] }));
    }
    return this.optionsPromise;
  }

  async resolveSlugs(items: Array<{ slug: string; title: string }>): Promise<Map<string, NovelSearchResult>> {
    const result = new Map<string, NovelSearchResult>();
    const exact = await apiFetch<{ results: NovelSearchResult[] }>('/api/resolve-slugs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slugs: items.map((item) => item.slug) })
    }).catch(() => ({ results: [] }));
    const exactBySlug = new Map((exact.results || []).map((novel) => [novel.slug.toLowerCase(), novel]));
    items.forEach((item) => {
      const novel = exactBySlug.get(item.slug.toLowerCase());
      if (novel) result.set(item.slug.toLowerCase(), novel);
    });

    const unresolved = items.filter((item) => !result.has(item.slug.toLowerCase()));
    let cursor = 0;
    const workers = Array.from({ length: Math.min(6, unresolved.length) }, async () => {
      while (cursor < unresolved.length) {
        const item = unresolved[cursor++];
        const matches = await this.searchNovels(item.title, 12).catch(() => []);
        const normalizedTitle = item.title.toLocaleLowerCase().normalize('NFKD').replace(/\p{Diacritic}/gu, '').trim();
        const fallback = matches.find((novel) =>
          novel.title.toLocaleLowerCase().normalize('NFKD').replace(/\p{Diacritic}/gu, '').trim() === normalizedTitle ||
          (novel.associated_names || []).some((alias) =>
            alias.toLocaleLowerCase().normalize('NFKD').replace(/\p{Diacritic}/gu, '').trim() === normalizedTitle
          )
        );
        if (fallback) result.set(item.slug.toLowerCase(), fallback);
      }
    });
    await Promise.all(workers);
    return result;
  }

  getNovel(id: number): Promise<NovelDetail> {
    return apiFetch(`/api/novels/${id}`);
  }

  getNovelInsights(id: number): Promise<NovelInsights> {
    return apiFetch(`/api/novels/${id}/insights`);
  }

  getRecommendations(request: RecommendRequest): Promise<RecommendResponse> {
    return apiFetch('/api/recommend', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request)
    });
  }

  browseNovels(request: BrowseRequest): Promise<BrowseResponse> {
    const params = new URLSearchParams();
    Object.entries(request).forEach(([key, value]) => {
      if (value !== '' && value != null) params.set(key, String(value));
    });
    return apiFetch<BrowseResponse>(`/api/browse?${params}`).catch((error) => {
      if (error instanceof DataSourceError && /not found|404/i.test(error.message)) {
        throw new DataSourceError(
          'This API process is older than the Browse page. Restart the local API, or switch to a regenerated static snapshot.',
          error
        );
      }
      throw error;
    });
  }

  async getRandomNovel(request: BrowseRequest, randomValue = Math.random()): Promise<BrowseNovel> {
    const params = new URLSearchParams();
    Object.entries(request).forEach(([key, value]) => {
      if (!['page', 'page_size'].includes(key) && value !== '' && value != null) params.set(key, String(value));
    });
    // Supplying a seed makes adapter tests reproducible. Normal UI use leaves
    // selection to the server's cryptographic random source.
    if (randomValue !== undefined && arguments.length > 1) {
      params.set('seed', String(Math.floor(Math.max(0, Math.min(0.999999, randomValue)) * 2147483647)));
    }
    const result = await apiFetch<{ novel: BrowseNovel }>(`/api/browse/random?${params}`);
    return result.novel;
  }
}
