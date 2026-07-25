import {
  DatasetManifest,
  FilterOptions,
  NovelDetail,
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

  async getManifest(): Promise<DatasetManifest> {
    const health = await apiFetch<any>('/api/health');
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
