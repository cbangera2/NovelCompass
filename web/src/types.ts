export interface SeedNovel {
  id: number;
  title: string;
  slug: string;
  novelupdates_url: string;
  external_url?: string;
  media_type?: string;
  source?: string;
  external_id?: string;
  cover_url?: string;
}

export interface Recommendation {
  target_id: number;
  title: string;
  author: string;
  cover_url?: string;
  slug: string;
  novelupdates_url: string;
  external_url?: string;
  media_type?: string;
  source?: string;
  external_id?: string;
  language: string;
  rating: number;
  rating_votes: number;
  reading_list_count: number;
  status_trans: string;
  chapters_trans: number;
  rrf_score: number;
  match_score_percent: number;
  channel_ranks: Record<string, number>;
  shared_tags: string[];
  curated_lists?: Array<{ id: number; title?: string | null }>;
  evidence_bullets: string[];
}

export interface RecommendRequest {
  query: string;
  limit?: number;
  hidden_gem_mode?: boolean;
  exclude_harem?: boolean;
  exclude_bl?: boolean;
  exclude_yuri?: boolean;
  language?: string;
  min_rating?: number;
  min_rating_votes?: number;
  max_readers?: number;
  min_year?: number;
  max_year?: number;
  include_genres?: string[];
  exclude_genres?: string[];
  include_tags?: string[];
  exclude_tags?: string[];
  channel_weights?: Record<string, number>;
  hidden_gem_strength?: number;
  min_chapters?: number;
  require_completed?: boolean;
  media_type?: string;
  source?: string;
  /** Catalog IDs to drop (library titles, not-for-me, etc.). Static + live. */
  exclude_novel_ids?: number[];
}

export interface DatasetManifest {
  schema_version: number;
  algorithm_version?: number;
  dataset_version: string;
  generated_at?: string;
  novel_count: number;
  source_novel_count?: number;
  bootstrap_novel_count?: number;
  detail_novel_count?: number;
  recommendation_seed_count?: number;
  rich_recommendation_seed_count?: number;
  recommendation_index_seed_count?: number;
  recommendation_index_candidate_limit?: number;
  recommendation_index_url?: string;
  snapshot_scope?: string;
  recommendable_seed_count?: number;
  catalog_url?: string;
  bootstrap_catalog_url?: string;
  facets_url?: string;
  options_url?: string;
  graph_url?: string;
}

export interface FilterOptions {
  genres: string[];
  tags?: string[];
  languages?: string[];
  media_types?: string[];
  sources?: string[];
}

export interface DataSourceStatus {
  mode: 'api' | 'static';
  label: string;
  datasetVersion?: string;
}

export interface RecommendResponse {
  seed_novel: SeedNovel;
  count: number;
  recommendations: Recommendation[];
}

export interface NovelSearchResult {
  id: number;
  title: string;
  slug: string;
  novelupdates_url: string;
  external_url?: string;
  author: string;
  cover_url?: string;
  rating: number;
  rating_votes: number;
  associated_names?: string[];
  media_type?: string;
  source?: string;
  external_id?: string;
}

export interface NovelDetail {
  id: number;
  title: string;
  slug: string;
  novelupdates_url: string;
  external_url?: string;
  associated_names: string[];
  author?: string;
  language?: string;
  synopsis?: string;
  rating: number;
  rating_votes: number;
  reading_list_count: number;
  chapters_orig: number;
  chapters_trans: number;
  status_trans?: string;
  year?: number;
  cover_url?: string;
  genres: string[];
  tags: string[];
  media_type?: string;
  source?: string;
  external_id?: string;
  direct_recommendation_count: number;
  related_series_count: number;
  recommendation_list_count: number;
}

export type BrowseSort = 'popular' | 'rating' | 'votes' | 'title' | 'newest';
export type BrowseSortDirection = 'asc' | 'desc';

export interface BrowseRequest {
  query?: string;
  page?: number;
  page_size?: number;
  sort?: BrowseSort;
  language?: string;
  author?: string;
  genre?: string;
  tag?: string;
  min_rating?: number;
  max_rating?: number;
  min_votes?: number;
  min_year?: number;
  max_year?: number;
  status?: string;
  min_chapters?: number;
  max_chapters?: number;
  min_readers?: number;
  max_readers?: number;
  include_genres?: string;
  exclude_genres?: string;
  include_tags?: string;
  exclude_tags?: string;
  exclude_ids?: string;
  direction?: BrowseSortDirection;
  media_type?: string;
  source?: string;
}

export interface BrowseNovel extends NovelSearchResult {
  language?: string;
  reading_list_count: number;
  year?: number;
  status_trans?: string;
  chapters_trans?: number;
  genres?: string[];
  tags?: string[];
}

export interface BrowseResponse {
  items: BrowseNovel[];
  page: number;
  page_size: number;
  total: number;
  has_more: boolean;
  capabilities: {
    genres: boolean;
    tags: boolean;
    total_is_exact: boolean;
  };
}

export interface NovelInsights {
  novel_id: number;
  catalog_size: number;
  metrics: Array<{
    key: 'rating' | 'rating_votes' | 'readers';
    value: number;
    percentile: number;
    rank: number;
    population: number;
  }>;
  cohorts: Array<{
    dimension: 'primary_genre' | 'language' | 'year';
    value: string;
    population: number;
    readership_rank: number;
  }>;
  peers: Array<BrowseNovel & {
    shared_genre_count: number;
    shared_tag_count: number;
  }>;
  cohort_definition: string;
  capabilities: { relationships: boolean; tags: boolean };
}

export interface GraphNode {
  id: number;
  title: string;
  slug: string;
  author?: string;
  cover?: string;
  rating: number;
  votes: number;
  readers: number;
  year?: number;
  media_type: string;
  source: string;
  degree: number;
  cluster_id: number;
  genre?: string;
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
}

export interface GraphEdge {
  source: number | GraphNode;
  target: number | GraphNode;
  type: string;
  weight: number;
  votes?: number;
}

export interface GraphCluster {
  id: number;
  name: string;
  seed_id: number;
  size: number;
  types: Record<string, number>;
}

export interface GraphData {
  node_count: number;
  edge_count: number;
  cluster_count: number;
  clusters: GraphCluster[];
  nodes: GraphNode[];
  edges: GraphEdge[];
}

