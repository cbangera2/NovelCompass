import {
  BrowseNovel,
  BrowseRequest,
  BrowseResponse,
  DatasetManifest,
  FilterOptions,
  CuratedListSummary,
  NovelDetail,
  NovelInsights,
  RelatedSeriesItem,
  NovelSearchResult,
  RecommendRequest,
  RecommendResponse
} from '../types';
import type { AnalyticsCorpus } from '../novelStats';

export interface RecommendationDataSource {
  readonly mode: 'api' | 'static';
  getManifest(): Promise<DatasetManifest>;
  searchNovels(query: string, limit: number, signal?: AbortSignal): Promise<NovelSearchResult[]>;
  getOptions(): Promise<FilterOptions>;
  resolveSlugs(items: Array<{ slug: string; title: string }>): Promise<Map<string, NovelSearchResult>>;
  /** Batch-confirm catalog membership by numeric id (used by AniList GDPR import). */
  resolveNovelIds(ids: number[]): Promise<Map<number, NovelSearchResult>>;
  getNovel(id: number): Promise<NovelDetail>;
  getNovelInsights(id: number): Promise<NovelInsights>;
  /** Sequels, spin-offs and adaptations. Only the live API carries relation edges. */
  getRelatedSeries?(id: number): Promise<RelatedSeriesItem[]>;
  /** Curated Novel Updates lists that include this title (live API only). */
  getCuratedLists?(id: number): Promise<CuratedListSummary[]>;
  /** Compact per-title rows for the catalog-wide analytics on a title page (static snapshot only). */
  getAnalyticsCorpus?(): Promise<AnalyticsCorpus>;
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
  if (source === 'novelphoenix') {
    return external_id ? `https://novelphoenix.com/novel/${external_id}` : '';
  }
  const isAniList = source === 'anilist' || id >= 2000000;
  if (isAniList) {
    const rawId = external_id || String(id >= 3000000 ? id - 3000000 : id >= 2000000 ? id - 2000000 : id);
    const type = media_type === 'anime' || id >= 3000000 ? 'anime' : 'manga';
    return `https://anilist.co/${type}/${rawId}`;
  }
  return `https://www.novelupdates.com/?p=${id}`;
}

export function sourceDisplayName(source?: string, id?: number): string {
  if (source === 'novelphoenix') return 'Novel Phoenix';
  if (source === 'anilist' || (id != null && id >= 2000000)) return 'AniList';
  return 'Novel Updates';
}

export function bucketForNovel(id: number): string {
  return (id % 256).toString(16).padStart(2, '0');
}
