import {
  DatasetManifest,
  FilterOptions,
  NovelDetail,
  NovelSearchResult,
  RecommendRequest,
  RecommendResponse
} from '../types';
import { DataSourceError, RecommendationDataSource } from './source';

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

  async getManifest(): Promise<DatasetManifest> {
    const health = await apiFetch<any>('/api/health');
    return {
      schema_version: health.schema_version ?? 1,
      algorithm_version: health.algorithm_version,
      dataset_version: health.dataset_version ?? 'live',
      generated_at: health.generated_at,
      novel_count: health.novel_count ?? 0
    };
  }

  async searchNovels(query: string, limit: number, signal?: AbortSignal): Promise<NovelSearchResult[]> {
    const body = await apiFetch<{ results: NovelSearchResult[] }>(
      `/api/search?q=${encodeURIComponent(query)}&limit=${limit}`,
      { signal }
    );
    return body.results || [];
  }

  getOptions(): Promise<FilterOptions> {
    return apiFetch('/api/options');
  }

  getNovel(id: number): Promise<NovelDetail> {
    return apiFetch(`/api/novels/${id}`);
  }

  getRecommendations(request: RecommendRequest): Promise<RecommendResponse> {
    return apiFetch('/api/recommend', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request)
    });
  }
}
