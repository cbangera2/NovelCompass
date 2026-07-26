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
  RecommendResponse,
  Recommendation,
  SeedNovel
} from '../types';
import {
  bucketForNovel,
  DataSourceError,
  novelUpdatesUrl,
  RecommendationDataSource
} from './source';

type CatalogCard = NovelSearchResult & {
  reading_list_count: number;
  year?: number;
  language: string;
  status_trans: string;
  chapters_trans: number;
  genre_ids: number[];
};

type CatalogFile = {
  fields: string[];
  rows: unknown[][];
  aliases?: Array<[number, string[]]>;
  languages?: string[];
  statuses?: string[];
  genres?: string[];
  tags?: string[];
};

type FacetsFile = {
  genres?: string[];
  tags?: string[];
  novels?: Record<string, { g?: number[]; t?: number[] }>;
};

type OptionsFile = {
  genres?: string[];
  tags?: string[];
  languages?: string[];
};

type StaticCandidate = {
  id: number;
  r?: Array<number | null>;
  ranks?: Record<string, number>;
  shared_tag_ids?: number[];
  shared_tags?: string[];
  direct_votes?: number;
  mutual?: boolean;
  list_count?: number;
  list_ids?: number[];
  lists?: Array<{ id: number; title?: string | null }>;
  evidence_bullets?: string[];
};

type RecommendationPool = {
  seed: number;
  algorithm_version?: number;
  channels?: string[];
  candidates: StaticCandidate[];
  reason?: string;
};

type CompactCandidate = [number, Array<number | null>, number[]?];

type CompactRecommendationShard = {
  algorithm_version?: number;
  channels?: string[];
  pools?: Record<string, CompactCandidate[]>;
};

const SUPPORTED_SCHEMA = 1;
const SUPPORTED_ALGORITHM = 1;
const DEFAULT_CHANNELS = ['tag', 'direct_rec', 'rec_list', 'structural', 'vector'];
const DEFAULT_WEIGHTS: Record<string, number> = {
  tag: 0.8,
  direct_rec: 1.2,
  rec_list: 1,
  structural: 0.6,
  vector: 1
};

function normalize(value: string): string {
  return value
    .toLocaleLowerCase()
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    // Drop punctuation so "Too Many Losing Heroines!" matches "Too Many Losing Heroines"
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function inferMediaType(id: number, mediaType?: string | null): string {
  if (mediaType) return String(mediaType).toLowerCase();
  if (id >= 3_000_000) return 'anime';
  if (id >= 2_000_000) return 'manga';
  return 'novel';
}

function matchesMediaFilter(cardType: string, requested: string[]): boolean {
  if (!requested.length || requested.includes('all')) return true;
  for (const reqT of requested) {
    if (reqT === 'manga' && ['manga', 'manhwa', 'manhua', 'comic'].includes(cardType)) return true;
    if (reqT === 'novel' && ['novel', 'light_novel', 'web_novel'].includes(cardType)) return true;
    if (reqT === 'anime' && cardType === 'anime') return true;
    if (reqT === cardType) return true;
  }
  return false;
}

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;
}

async function jsonFetch<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new DataSourceError(`Static dataset returned ${response.status} for ${url}`);
  return response.json() as Promise<T>;
}

export class StaticDataSource implements RecommendationDataSource {
  readonly mode = 'static' as const;
  private manifestPromise?: Promise<DatasetManifest>;
  private bootstrapPromise?: Promise<void>;
  private catalogPromise?: Promise<void>;
  private facetsPromise?: Promise<FacetsFile>;
  private compactRecommendationPromises = new Map<string, Promise<CompactRecommendationShard>>();
  private cards = new Map<number, CatalogCard>();
  private aliases = new Map<number, string[]>();
  private languages: string[] = [];
  private statuses: string[] = [];
  private genres: string[] = [];
  private tags: string[] = [];

  constructor(private readonly baseUrl = `${import.meta.env.BASE_URL}data`) {}

  async getManifest(): Promise<DatasetManifest> {
    if (!this.manifestPromise) {
      this.manifestPromise = jsonFetch<DatasetManifest>(joinUrl(this.baseUrl, 'manifest.json'))
        .then((manifest) => {
          if (manifest.schema_version !== SUPPORTED_SCHEMA) {
            throw new DataSourceError(
              `Static dataset schema ${manifest.schema_version} is unsupported (expected ${SUPPORTED_SCHEMA}).`
            );
          }
          if (
            manifest.algorithm_version != null &&
            manifest.algorithm_version !== SUPPORTED_ALGORITHM
          ) {
            throw new DataSourceError(
              `Static algorithm ${manifest.algorithm_version} is unsupported (expected ${SUPPORTED_ALGORITHM}).`
            );
          }
          return manifest;
        });
    }
    return this.manifestPromise;
  }

  private ingestCatalog(catalog: CatalogFile): void {
    const indexes = new Map(catalog.fields.map((field, index) => [field, index]));
    const at = (row: unknown[], field: string): any => row[indexes.get(field) ?? -1];
    this.languages = catalog.languages || this.languages;
    this.statuses = catalog.statuses || this.statuses;
    this.genres = catalog.genres || this.genres;
    this.tags = catalog.tags || this.tags;
    for (const row of catalog.rows) {
          const id = Number(at(row, 'id'));
          const languageValue = at(row, 'language') ?? this.languages[Number(at(row, 'language_id'))] ?? '';
          const statusValue = at(row, 'status_trans') ?? this.statuses[Number(at(row, 'status_id'))] ?? '';
          const mediaType = inferMediaType(id, at(row, 'media_type') as string | undefined);
          const source = String(at(row, 'source') || (id >= 2_000_000 ? 'anilist' : 'novelupdates'));
          const externalId = String(at(row, 'external_id') || id);
          const externalUrl = String(at(row, 'external_url') || '') || undefined;
          this.cards.set(id, {
            id,
            slug: String(at(row, 'slug') || ''),
            title: String(at(row, 'title') || ''),
            author: String(at(row, 'author') || ''),
            cover_url: String(at(row, 'cover') ?? at(row, 'cover_url') ?? '') || undefined,
            rating: Number(at(row, 'rating') || 0),
            rating_votes: Number(at(row, 'votes') ?? at(row, 'rating_votes') ?? 0),
            reading_list_count: Number(at(row, 'readers') ?? at(row, 'reading_list_count') ?? 0),
            year: Number(at(row, 'year')) || undefined,
            language: String(languageValue || ''),
            status_trans: String(statusValue || ''),
            chapters_trans: Number(at(row, 'translated_chapters') ?? at(row, 'chapters_trans') ?? 0),
            genre_ids: (at(row, 'genre_ids') as number[]) || [],
            media_type: mediaType,
            source,
            external_id: externalId,
            external_url: externalUrl,
            novelupdates_url: externalUrl || novelUpdatesUrl(id)
          });
    }
    for (const [id, aliases] of catalog.aliases || []) this.aliases.set(id, aliases);
  }

  private async loadBootstrapCatalog(): Promise<void> {
    if (!this.bootstrapPromise) {
      this.bootstrapPromise = (async () => {
        const manifest = await this.getManifest();
        const path = manifest.bootstrap_catalog_url || manifest.catalog_url || 'catalog.json';
        this.ingestCatalog(await jsonFetch<CatalogFile>(joinUrl(this.baseUrl, path)));
      })();
    }
    return this.bootstrapPromise;
  }

  private async loadCatalog(): Promise<void> {
    if (!this.catalogPromise) {
      this.catalogPromise = (async () => {
        await this.loadBootstrapCatalog();
        const manifest = await this.getManifest();
        const fullPath = manifest.catalog_url || 'catalog.json';
        const bootstrapPath = manifest.bootstrap_catalog_url || fullPath;
        if (fullPath !== bootstrapPath) {
          this.ingestCatalog(await jsonFetch<CatalogFile>(joinUrl(this.baseUrl, fullPath)));
        }
      })();
    }
    return this.catalogPromise;
  }

  private warmFullCatalogWhenIdle(): void {
    if (this.catalogPromise || typeof window === 'undefined') return;
    const connection = (navigator as Navigator & {
      connection?: { saveData?: boolean; effectiveType?: string };
    }).connection;
    if (connection?.saveData || connection?.effectiveType === 'slow-2g' || connection?.effectiveType === '2g') return;
    const idle = window.requestIdleCallback;
    if (idle) idle(() => { void this.loadCatalog(); }, { timeout: 5000 });
  }

  private async loadFacets(): Promise<FacetsFile> {
    if (!this.facetsPromise) {
      this.facetsPromise = this.getManifest().then((manifest) =>
        jsonFetch<FacetsFile>(joinUrl(this.baseUrl, manifest.facets_url || 'facets.json'))
      );
    }
    return this.facetsPromise;
  }

  private async loadCompactRecommendationPool(
    seedId: number,
    manifest: DatasetManifest
  ): Promise<RecommendationPool | undefined> {
    if (!manifest.recommendation_index_url) return undefined;
    const bucket = bucketForNovel(seedId);
    let promise = this.compactRecommendationPromises.get(bucket);
    if (!promise) {
      const path = manifest.recommendation_index_url.replace('{bucket}', bucket);
      promise = jsonFetch<CompactRecommendationShard>(joinUrl(this.baseUrl, path));
      this.compactRecommendationPromises.set(bucket, promise);
    }
    const shard = await promise;
    const compact = shard.pools?.[String(seedId)];
    if (!compact) return undefined;
    return {
      seed: seedId,
      algorithm_version: shard.algorithm_version,
      channels: shard.channels,
      candidates: compact.map(([id, r, sharedTagIds]) => ({
        id,
        r,
        shared_tag_ids: sharedTagIds || []
      })),
      ...(compact.length ? {} : { reason: 'insufficient_evidence' })
    };
  }

  async searchNovels(query: string, limit: number): Promise<NovelSearchResult[]> {
    await this.loadBootstrapCatalog();
    const needle = normalize(query);
    if (!needle) return [];
    const tokens = needle.split(/\s+/).filter(Boolean);
    let selectedTypes: string[] = [];
    try {
      const { getSelectedMediaTypes } = await import('../mediaFilterState');
      selectedTypes = getSelectedMediaTypes().map((t) => t.toLowerCase());
    } catch {
      selectedTypes = [];
    }
    const results = [...this.cards.values()]
      .map((card) => {
        const cardType = inferMediaType(card.id, card.media_type);
        if (!matchesMediaFilter(cardType, selectedTypes)) return { card, score: Infinity };
        const title = normalize(card.title);
        const author = normalize(card.author);
        const aliases = (this.aliases.get(card.id) || []).map(normalize);
        const haystack = [title, ...aliases, author].join(' ');
        let score = title === needle ? 0 : title.startsWith(needle) ? 1 : aliases.some((item) => item === needle) ? 2
          : aliases.some((item) => item.startsWith(needle)) ? 3 : title.includes(needle) ? 4
          : aliases.some((item) => item.includes(needle)) ? 5 : author.includes(needle) ? 6 : Infinity;
        if (!Number.isFinite(score) && tokens.length && tokens.every((token) => haystack.includes(token))) {
          score = 7;
        }
        return { card, score };
      })
      .filter(({ score }) => Number.isFinite(score))
      .sort((a, b) => a.score - b.score || b.card.reading_list_count - a.card.reading_list_count)
      .slice(0, limit)
      .map(({ card }) => card);
    this.warmFullCatalogWhenIdle();
    return results;
  }

  async getOptions(): Promise<FilterOptions> {
    try {
      const manifest = await this.getManifest();
      const options = await jsonFetch<OptionsFile>(
        joinUrl(this.baseUrl, manifest.options_url || 'options.json')
      );
      this.genres = options.genres || [];
      this.tags = options.tags || [];
      this.languages = options.languages || [];
      return {
        genres: this.genres,
        tags: this.tags,
        languages: this.languages.filter(Boolean)
      };
    } catch {
      // Compatibility path for normalized snapshots that predate options.json.
      // New snapshots avoid downloading the full catalog during app startup.
      await this.loadCatalog();
    }
    if ((!this.genres.length || !this.tags.length)) {
      try {
        const facets = await this.loadFacets();
        if (!this.genres.length) this.genres = facets.genres || [];
        if (!this.tags.length) this.tags = facets.tags || [];
      } catch {
        // Older static exports may contain only the compact catalog. Browse
        // remains usable and the UI hides unsupported facet controls.
      }
    }
    return {
      genres: this.genres,
      tags: this.tags,
      languages: this.languages.filter(Boolean)
    };
  }

  async resolveSlugs(items: Array<{ slug: string; title: string }>): Promise<Map<string, NovelSearchResult>> {
    await this.loadCatalog();
    const requested = new Set(items.map((item) => item.slug.toLowerCase()));
    const result = new Map<string, NovelSearchResult>();
    for (const card of this.cards.values()) {
      const slug = card.slug.toLowerCase();
      if (requested.has(slug)) result.set(slug, card);
    }
    for (const item of items) {
      const key = item.slug.toLowerCase();
      if (result.has(key)) continue;
      const title = normalize(item.title);
      const matches = [...this.cards.values()].filter((card) =>
        normalize(card.title) === title ||
        (this.aliases.get(card.id) || []).some((alias) => normalize(alias) === title)
      );
      if (matches.length === 1) result.set(key, matches[0]);
    }
    return result;
  }

  async getNovel(id: number): Promise<NovelDetail> {
    await this.loadBootstrapCatalog();
    if (!this.cards.has(id)) await this.loadCatalog();
    const card = this.cards.get(id);
    if (!card) throw new DataSourceError(`Novel ${id} is not in this static snapshot.`);
    let detail: any = {};
    try {
      detail = await jsonFetch<any>(
        joinUrl(this.baseUrl, `details/${bucketForNovel(id)}/${id}.json`)
      );
    } catch (error) {
      if (!(error instanceof DataSourceError) || !error.message.includes('returned 404')) throw error;
      // Full-catalog Browse entries outside the bounded bootstrap intentionally
      // expose catalog metadata without pretending a detail shard exists.
    }
    const genreIds: number[] = detail.genre_ids || card.genre_ids || [];
    const tagIds: number[] = detail.tag_ids || [];
    return {
      id,
      title: card.title,
      slug: card.slug,
      novelupdates_url: card.external_url || card.novelupdates_url || novelUpdatesUrl(id),
      external_url: detail.external_url || card.external_url,
      media_type: detail.media_type || card.media_type,
      source: detail.source || card.source,
      external_id: detail.external_id || card.external_id,
      associated_names: detail.associated_names || this.aliases.get(id) || [],
      author: card.author,
      language: card.language,
      synopsis: detail.synopsis || '',
      rating: card.rating,
      rating_votes: card.rating_votes,
      reading_list_count: card.reading_list_count,
      chapters_orig: Number(detail.original_chapters || 0),
      chapters_trans: card.chapters_trans,
      status_trans: card.status_trans,
      year: card.year,
      cover_url: card.cover_url,
      genres: genreIds.map((genreId) => this.genres[genreId]).filter(Boolean),
      tags: tagIds.map((tagId) => this.tags[tagId]).filter(Boolean),
      direct_recommendation_count: Number(detail.direct_recommendation_count || 0),
      related_series_count: Number(detail.related_series_count || 0),
      recommendation_list_count: Number(detail.recommendation_list_count || 0)
    };
  }

  async getNovelInsights(id: number): Promise<NovelInsights> {
    await this.loadCatalog();
    const card = this.cards.get(id);
    if (!card) throw new DataSourceError(`Novel ${id} is not in this static snapshot.`);
    const catalog = [...this.cards.values()];
    const metric = (key: 'rating' | 'rating_votes' | 'readers', value: number, read: (item: CatalogCard) => number) => ({
      key, value,
      percentile: Math.round(1000 * catalog.filter((item) => read(item) <= value).length / catalog.length) / 10,
      rank: catalog.filter((item) => read(item) > value).length + 1,
      population: catalog.length
    });
    const genreNames = card.genre_ids.map((genreId) => this.genres[genreId]).filter(Boolean).sort();
    const primaryGenre = genreNames[0];
    const cohort = (
      dimension: 'primary_genre' | 'language' | 'year',
      value: string,
      members: CatalogCard[]
    ) => ({
      dimension, value, population: members.length,
      readership_rank: members.filter((item) => item.reading_list_count > card.reading_list_count).length + 1
    });
    const cohorts: NovelInsights['cohorts'] = [];
    if (primaryGenre) cohorts.push(cohort('primary_genre', primaryGenre,
      catalog.filter((item) => item.genre_ids.some((genreId) => this.genres[genreId] === primaryGenre))));
    if (card.language) cohorts.push(cohort('language', card.language,
      catalog.filter((item) => normalize(item.language) === normalize(card.language))));
    if (card.year) cohorts.push(cohort('year', String(card.year),
      catalog.filter((item) => item.year === card.year)));

    let facets: FacetsFile | undefined;
    try { facets = await this.loadFacets(); } catch { facets = undefined; }
    const seedTags = new Set(facets?.novels?.[String(id)]?.t || []);
    const peers = primaryGenre ? catalog
      .filter((item) => item.id !== id && normalize(item.language) === normalize(card.language) &&
        item.genre_ids.some((genreId) => this.genres[genreId] === primaryGenre))
      .map((item) => ({
        ...item,
        genres: item.genre_ids.map((genreId) => this.genres[genreId]).filter(Boolean),
        shared_genre_count: item.genre_ids.filter((genreId) => card.genre_ids.includes(genreId)).length,
        shared_tag_count: (facets?.novels?.[String(item.id)]?.t || []).filter((tagId) => seedTags.has(tagId)).length
      }))
      .sort((a, b) => b.shared_tag_count - a.shared_tag_count ||
        b.shared_genre_count - a.shared_genre_count ||
        b.reading_list_count - a.reading_list_count || a.id - b.id)
      .slice(0, 10) : [];
    return {
      novel_id: id, catalog_size: catalog.length,
      metrics: [
        metric('rating', card.rating, (item) => item.rating),
        metric('rating_votes', card.rating_votes, (item) => item.rating_votes),
        metric('readers', card.reading_list_count, (item) => item.reading_list_count)
      ],
      cohorts, peers,
      cohort_definition: 'Peers share the alphabetically first catalog genre and exact language; they are ordered by shared tags, shared genres, then readers.',
      capabilities: { relationships: false, tags: Boolean(facets) }
    };
  }

  async getRecommendations(request: RecommendRequest): Promise<RecommendResponse> {
    await this.loadBootstrapCatalog();
    const seedId = Number(request.query);
    if (seedId && !this.cards.has(seedId)) await this.loadCatalog();
    const seedCard = this.cards.get(seedId);
    if (!seedId || !seedCard) throw new DataSourceError('Select a novel from the search results.');
    let pool: RecommendationPool;
    const manifest = await this.getManifest();
    try {
      pool = await jsonFetch<RecommendationPool>(
        joinUrl(this.baseUrl, `recs/${bucketForNovel(seedId)}/${seedId}.json`)
      );
    } catch (error) {
      if (error instanceof DataSourceError && error.message.includes('returned 404')) {
        const compactPool = await this.loadCompactRecommendationPool(seedId, manifest);
        if (!compactPool) {
          throw new DataSourceError(
            'Recommendations for this title are unavailable in this static snapshot.'
          );
        }
        pool = compactPool;
      } else {
        throw error;
      }
    }
    const needsTagTraits = Boolean(
      request.exclude_harem || request.exclude_bl || request.exclude_yuri ||
      request.include_tags?.length || request.exclude_tags?.length
    );
    const facets = needsTagTraits ? await this.loadFacets() : undefined;
    const genreNames = this.genres;
    const tagNames = this.tags;
    const channels = pool.channels || DEFAULT_CHANNELS;
    const weights = { ...DEFAULT_WEIGHTS, ...request.channel_weights };

    const scored = pool.candidates.flatMap((candidate): Array<Recommendation & { adjusted: number }> => {
      const card = this.cards.get(candidate.id);
      if (!card) return [];
      const novelFacet = facets?.novels?.[String(candidate.id)];
      const genreIds = card.genre_ids.length ? card.genre_ids : novelFacet?.g || [];
      const genres = genreIds.map((id) => genreNames[id]).filter(Boolean).map(normalize);
      const tags = (novelFacet?.t || []).map((id) => tagNames[id]).filter(Boolean).map(normalize);
      if (!passesFilters(card, genres, tags, request)) return [];

      const ranks: Record<string, number> = { ...candidate.ranks };
      (candidate.r || []).forEach((rank, index) => {
        if (rank != null && channels[index]) ranks[channels[index]] = rank;
      });
      const score = Object.entries(ranks).reduce((sum, [channel, rank]) =>
        sum + Math.max(0, weights[channel] || 0) / (60 + rank), 0);
      const hiddenGemMultiplier = request.hidden_gem_mode
        ? 1 + Math.max(0, request.hidden_gem_strength ?? 0.3) *
          Math.log10(10010 / (Math.max(0, card.reading_list_count) + 10))
        : 1;
      const sharedTags = candidate.shared_tags ||
        (candidate.shared_tag_ids || []).map((id) => tagNames[id]).filter(Boolean) as string[];
      return [{
        target_id: card.id,
        title: card.title,
        author: card.author,
        cover_url: card.cover_url,
        slug: card.slug,
        novelupdates_url: novelUpdatesUrl(card.id),
        language: card.language,
        rating: card.rating,
        rating_votes: card.rating_votes,
        reading_list_count: card.reading_list_count,
        status_trans: card.status_trans,
        chapters_trans: card.chapters_trans,
        rrf_score: score,
        match_score_percent: 0,
        channel_ranks: ranks,
        shared_tags: sharedTags,
        curated_lists: candidate.lists || (candidate.list_ids || []).map((id) => ({ id, title: null })),
        evidence_bullets: candidate.evidence_bullets
          ? sanitizeEvidence(candidate.evidence_bullets, candidate.lists || [])
          : buildEvidence(candidate, sharedTags),
        adjusted: score * hiddenGemMultiplier
      }];
    });

    const activeChannels = new Set(scored.flatMap((candidate) => Object.keys(candidate.channel_ranks)));
    const maximum = [...activeChannels].reduce(
      (sum, channel) => sum + Math.max(0, weights[channel] || 0) / 61,
      0
    );
    const results = scored
      .map((candidate) => ({
        ...candidate,
        match_score_percent: maximum > 0
          ? Math.max(0, Math.min(100, Math.round(100 * candidate.rrf_score / maximum)))
          : 0
      }))
      .sort((a, b) => b.adjusted - a.adjusted || a.target_id - b.target_id);

    const recommendations = results.slice(0, request.limit || 30).map(({ adjusted: _, ...result }) => result);
    const seed: SeedNovel = {
      id: seedCard.id,
      title: seedCard.title,
      slug: seedCard.slug,
      cover_url: seedCard.cover_url,
      novelupdates_url: novelUpdatesUrl(seedCard.id)
    };
    return { seed_novel: seed, count: recommendations.length, recommendations };
  }

  async browseNovels(request: BrowseRequest): Promise<BrowseResponse> {
    await this.loadCatalog();
    const query = normalize(request.query || '');
    const genre = normalize(request.genre || '');
    const tag = normalize(request.tag || '');
    const includeGenres = (request.include_genres || '').split(',').map(normalize).filter(Boolean);
    const excludeGenres = (request.exclude_genres || '').split(',').map(normalize).filter(Boolean);
    const includeTags = (request.include_tags || '').split(',').map(normalize).filter(Boolean);
    const excludeTags = (request.exclude_tags || '').split(',').map(normalize).filter(Boolean);
    const excludedIds = new Set((request.exclude_ids || '').split(',').map(Number).filter(Number.isFinite));
    let facets: FacetsFile | undefined;
    let tagSupported = true;
    if (tag || includeTags.length || excludeTags.length) {
      try {
        facets = await this.loadFacets();
      } catch {
        tagSupported = false;
      }
    }
    const reqMediaTypes = (request.media_type || '').split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);
    const items = [...this.cards.values()].filter((card) => {
      const cardType = inferMediaType(card.id, card.media_type);
      if (!matchesMediaFilter(cardType, reqMediaTypes)) return false;
      if (query && !normalize(`${card.title} ${card.author} ${(this.aliases.get(card.id) || []).join(' ')}`).includes(query)) return false;
      if (request.language && normalize(card.language) !== normalize(request.language)) return false;
      if (request.author && normalize(card.author) !== normalize(request.author)) return false;
      if ((request.min_rating || 0) > card.rating || (request.min_votes || 0) > card.rating_votes) return false;
      if (request.max_rating && card.rating > request.max_rating) return false;
      if (request.min_year && (!card.year || card.year < request.min_year)) return false;
      if (request.max_year && (!card.year || card.year > request.max_year)) return false;
      if (request.status && !normalize(card.status_trans).includes(normalize(request.status))) return false;
      if (request.min_chapters && card.chapters_trans < request.min_chapters) return false;
      if (request.max_chapters && card.chapters_trans > request.max_chapters) return false;
      if (request.min_readers && card.reading_list_count < request.min_readers) return false;
      if (request.max_readers && card.reading_list_count > request.max_readers) return false;
      if (excludedIds.has(card.id)) return false;
      const genreNames = card.genre_ids.map((id) => this.genres[id]).filter(Boolean).map(normalize);
      if (genre && !genreNames.includes(genre)) return false;
      if (includeGenres.some((item) => !genreNames.includes(item))) return false;
      if (excludeGenres.some((item) => genreNames.includes(item))) return false;
      if ((tag || includeTags.length || excludeTags.length) && tagSupported) {
        const tagNames = (facets?.novels?.[String(card.id)]?.t || []).map((id) => this.tags[id]).filter(Boolean).map(normalize);
        if (tag && !tagNames.includes(tag)) return false;
        if (includeTags.some((item) => !tagNames.includes(item))) return false;
        if (excludeTags.some((item) => tagNames.includes(item))) return false;
      }
      return true;
    });
    const sort = request.sort || 'popular';
    items.sort((a, b) => {
      const direction = request.direction === 'asc' ? 1 : -1;
      if (sort === 'rating') return direction * (a.rating - b.rating || a.rating_votes - b.rating_votes);
      if (sort === 'votes') return direction * (a.rating_votes - b.rating_votes || a.rating - b.rating);
      if (sort === 'title') return direction * a.title.localeCompare(b.title);
      if (sort === 'newest') return direction * ((a.year || 0) - (b.year || 0) || a.reading_list_count - b.reading_list_count);
      return direction * (a.reading_list_count - b.reading_list_count || a.rating_votes - b.rating_votes);
    });
    const page = Math.max(1, request.page || 1);
    const pageSize = Math.max(1, Math.min(100, request.page_size || 24));
    const start = (page - 1) * pageSize;
    const selected: BrowseNovel[] = items.slice(start, start + pageSize).map((card) => ({
      ...card,
      genres: card.genre_ids.map((id) => this.genres[id]).filter(Boolean)
    }));
    return {
      items: selected,
      page,
      page_size: pageSize,
      total: items.length,
      has_more: start + selected.length < items.length,
      capabilities: { genres: this.genres.length > 0, tags: !tag || tagSupported, total_is_exact: true }
    };
  }

  async getRandomNovel(request: BrowseRequest, randomValue = Math.random()): Promise<BrowseNovel> {
    const count = await this.browseNovels({ ...request, page: 1, page_size: 1 });
    if (!count.total) throw new DataSourceError('No novels match the active filters.');
    const page = Math.min(count.total, Math.floor(Math.max(0, Math.min(0.999999, randomValue)) * count.total) + 1);
    const result = await this.browseNovels({ ...request, page, page_size: 1 });
    if (!result.items[0]) throw new DataSourceError('The selected novel is unavailable.');
    return result.items[0];
  }
}

function passesFilters(
  card: CatalogCard,
  genres: string[],
  tags: string[],
  request: RecommendRequest
): boolean {
  const genreSet = new Set(genres);
  const tagSet = new Set(tags);
  const has = (values: string[], needle: string) => values.some((value) => value.includes(needle));
  if (request.language && normalize(card.language) !== normalize(request.language)) return false;
  if ((request.min_rating || 0) > card.rating) return false;
  if ((request.min_rating_votes || 0) > card.rating_votes) return false;
  if (request.max_readers && card.reading_list_count > request.max_readers) return false;
  if (request.min_year && (!card.year || card.year < request.min_year)) return false;
  if (request.max_year && (!card.year || card.year > request.max_year)) return false;
  if (request.min_chapters && card.chapters_trans < request.min_chapters) return false;
  if (request.require_completed && !normalize(card.status_trans).includes('complete')) return false;
  if (request.exclude_harem && (has(genres, 'harem') || has(tags, 'harem'))) return false;
  if (request.exclude_bl && (has(genres, 'boys love') || has(genres, 'yaoi') || has(tags, 'boys love'))) return false;
  if (request.exclude_yuri && (has(genres, 'girls love') || has(genres, 'yuri') || has(tags, 'girls love'))) return false;
  if (request.include_genres?.some((genre) => !genreSet.has(normalize(genre)))) return false;
  if (request.exclude_genres?.some((genre) => genreSet.has(normalize(genre)))) return false;
  if (request.include_tags?.some((tag) => !tagSet.has(normalize(tag)))) return false;
  if (request.exclude_tags?.some((tag) => tagSet.has(normalize(tag)))) return false;
  return true;
}

function buildEvidence(candidate: StaticCandidate, sharedTags: string[]): string[] {
  const evidence: string[] = [];
  if (sharedTags.length) evidence.push(`Shared key tropes: ${sharedTags.slice(0, 5).join(', ')}`);
  if (candidate.direct_votes) evidence.push(`${candidate.mutual ? 'Mutual' : 'Human'} recommendation (${candidate.direct_votes} votes)`);
  if (candidate.list_count) {
    const named = candidate.lists?.find((item) => item.title)?.title;
    evidence.push(named
      ? `Co-occurs on ${candidate.list_count} curated list(s) including '${named}'`
      : `Co-occurs on ${candidate.list_count} curated list(s); list titles are unavailable in this snapshot`);
  }
  return evidence.length ? evidence : ['Related through catalog evidence'];
}

function sanitizeEvidence(
  bullets: string[],
  lists: Array<{ id: number; title?: string | null }>
): string[] {
  const titles = new Map(lists.filter((item) => item.title).map((item) => [item.id, item.title!]));
  return bullets.map((bullet) => bullet.replace(
    /Novel Updates List\s+(\d+)/gi,
    (_match, rawId) => titles.get(Number(rawId)) || `curated list #${rawId} (title unavailable)`
  ));
}
