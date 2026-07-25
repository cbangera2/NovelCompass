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

export interface RecommendationDataSource {
  readonly mode: 'api' | 'static';
  getManifest(): Promise<DatasetManifest>;
  searchNovels(query: string, limit: number, signal?: AbortSignal): Promise<NovelSearchResult[]>;
  getOptions(): Promise<FilterOptions>;
  resolveSlugs(items: Array<{ slug: string; title: string }>): Promise<Map<string, NovelSearchResult>>;
  getNovel(id: number): Promise<NovelDetail>;
  getNovelInsights(id: number): Promise<NovelInsights>;
  getRecommendations(request: RecommendRequest): Promise<RecommendResponse>;
  browseNovels(request: BrowseRequest): Promise<BrowseResponse>;
  getRandomNovel(request: BrowseRequest, randomValue?: number): Promise<BrowseNovel>;
}

export class DataSourceError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'DataSourceError';
  }
}

export function novelUpdatesUrl(id: number): string {
  return `https://www.novelupdates.com/?p=${id}`;
}

export function bucketForNovel(id: number): string {
  return (id % 256).toString(16).padStart(2, '0');
}
