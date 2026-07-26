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

export function externalMediaUrl(id: number, source?: string, external_id?: string, media_type?: string): string {
  const isAniList = source === 'anilist' || id >= 2000000;
  if (isAniList) {
    const rawId = external_id || String(id >= 3000000 ? id - 3000000 : id >= 2000000 ? id - 2000000 : id);
    const type = media_type === 'anime' || id >= 3000000 ? 'anime' : 'manga';
    return `https://anilist.co/${type}/${rawId}`;
  }
  return `https://www.novelupdates.com/?p=${id}`;
}

export function sourceDisplayName(source?: string, id?: number): string {
  if (source === 'anilist' || (id != null && id >= 2000000)) return 'AniList';
  return 'Novel Updates';
}

export function bucketForNovel(id: number): string {
  return (id % 256).toString(16).padStart(2, '0');
}
