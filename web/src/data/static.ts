import {
  DatasetManifest,
  FilterOptions,
  NovelDetail,
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
};

type FacetsFile = {
  genres?: string[];
  tags?: string[];
  novels?: Record<string, { g?: number[]; t?: number[] }>;
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
  evidence_bullets?: string[];
};

type RecommendationPool = {
  seed: number;
  algorithm_version?: number;
  channels?: string[];
  candidates: StaticCandidate[];
  reason?: string;
};

const SUPPORTED_SCHEMA = 1;
const DEFAULT_CHANNELS = ['tag', 'direct_rec', 'rec_list', 'structural', 'vector'];
const DEFAULT_WEIGHTS: Record<string, number> = {
  tag: 0.8,
  direct_rec: 1.2,
  rec_list: 1,
  structural: 0.6,
  vector: 1
};

function normalize(value: string): string {
  return value.toLocaleLowerCase().normalize('NFKD').replace(/\p{Diacritic}/gu, '').trim();
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
  private catalogPromise?: Promise<void>;
  private facetsPromise?: Promise<FacetsFile>;
  private cards = new Map<number, CatalogCard>();
  private aliases = new Map<number, string[]>();
  private languages: string[] = [];
  private statuses: string[] = [];

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
          return manifest;
        });
    }
    return this.manifestPromise;
  }

  private async loadCatalog(): Promise<void> {
    if (!this.catalogPromise) {
      this.catalogPromise = (async () => {
        const manifest = await this.getManifest();
        const catalog = await jsonFetch<CatalogFile>(joinUrl(this.baseUrl, manifest.catalog_url || 'catalog.json'));
        const indexes = new Map(catalog.fields.map((field, index) => [field, index]));
        const at = (row: unknown[], field: string): any => row[indexes.get(field) ?? -1];
        this.languages = catalog.languages || [];
        this.statuses = catalog.statuses || [];
        for (const row of catalog.rows) {
          const id = Number(at(row, 'id'));
          const languageValue = at(row, 'language') ?? this.languages[Number(at(row, 'language_id'))] ?? '';
          const statusValue = at(row, 'status_trans') ?? this.statuses[Number(at(row, 'status_id'))] ?? '';
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
            novelupdates_url: novelUpdatesUrl(id)
          });
        }
        for (const [id, aliases] of catalog.aliases || []) this.aliases.set(id, aliases);
      })();
    }
    return this.catalogPromise;
  }

  private async loadFacets(): Promise<FacetsFile> {
    if (!this.facetsPromise) {
      this.facetsPromise = this.getManifest().then((manifest) =>
        jsonFetch<FacetsFile>(joinUrl(this.baseUrl, manifest.facets_url || 'facets.json'))
      );
    }
    return this.facetsPromise;
  }

  async searchNovels(query: string, limit: number): Promise<NovelSearchResult[]> {
    await this.loadCatalog();
    const needle = normalize(query);
    if (!needle) return [];
    return [...this.cards.values()]
      .map((card) => {
        const title = normalize(card.title);
        const author = normalize(card.author);
        const aliases = (this.aliases.get(card.id) || []).map(normalize);
        let score = title === needle ? 0 : title.startsWith(needle) ? 1 : aliases.some((item) => item === needle) ? 2
          : aliases.some((item) => item.startsWith(needle)) ? 3 : title.includes(needle) ? 4
          : aliases.some((item) => item.includes(needle)) ? 5 : author.includes(needle) ? 6 : Infinity;
        if (!Number.isFinite(score)) {
          const tokens = needle.split(/\s+/);
          if (tokens.every((token) => title.includes(token))) score = 7;
        }
        return { card, score };
      })
      .filter(({ score }) => Number.isFinite(score))
      .sort((a, b) => a.score - b.score || b.card.reading_list_count - a.card.reading_list_count)
      .slice(0, limit)
      .map(({ card }) => card);
  }

  async getOptions(): Promise<FilterOptions> {
    const facets = await this.loadFacets();
    await this.loadCatalog();
    return {
      genres: facets.genres || [],
      tags: facets.tags || [],
      languages: this.languages.filter(Boolean)
    };
  }

  async getNovel(id: number): Promise<NovelDetail> {
    await this.loadCatalog();
    const card = this.cards.get(id);
    if (!card) throw new DataSourceError(`Novel ${id} is not in this static snapshot.`);
    const [detail, facets] = await Promise.all([
      jsonFetch<any>(joinUrl(this.baseUrl, `details/${bucketForNovel(id)}/${id}.json`)),
      this.loadFacets()
    ]);
    const genreIds: number[] = detail.genre_ids || card.genre_ids || [];
    const tagIds: number[] = detail.tag_ids || facets.novels?.[String(id)]?.t || [];
    return {
      id,
      title: card.title,
      slug: card.slug,
      novelupdates_url: novelUpdatesUrl(id),
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
      genres: genreIds.map((genreId) => facets.genres?.[genreId]).filter(Boolean) as string[],
      tags: tagIds.map((tagId) => facets.tags?.[tagId]).filter(Boolean) as string[],
      direct_recommendation_count: Number(detail.direct_recommendation_count || 0),
      related_series_count: Number(detail.related_series_count || 0),
      recommendation_list_count: Number(detail.recommendation_list_count || 0)
    };
  }

  async getRecommendations(request: RecommendRequest): Promise<RecommendResponse> {
    await this.loadCatalog();
    const seedId = Number(request.query);
    const seedCard = this.cards.get(seedId);
    if (!seedId || !seedCard) throw new DataSourceError('Select a novel from the search results.');
    const pool = await jsonFetch<RecommendationPool>(
      joinUrl(this.baseUrl, `recs/${bucketForNovel(seedId)}/${seedId}.json`)
    );
    // Options initialization normally warms this request. It is also required
    // for turning compact genre/tag IDs into filters and readable evidence.
    const facets = await this.loadFacets();
    const genreNames = facets.genres || [];
    const tagNames = facets.tags || [];
    const channels = pool.channels || DEFAULT_CHANNELS;
    const weights = { ...DEFAULT_WEIGHTS, ...(request.channel_weights || {}) };
    const maximum = channels.reduce((sum, channel) => sum + Math.max(0, weights[channel] || 0) / 61, 0);

    const results = pool.candidates.flatMap((candidate): Array<Recommendation & { adjusted: number }> => {
      const card = this.cards.get(candidate.id);
      if (!card) return [];
      const novelFacet = facets.novels?.[String(candidate.id)];
      const genreIds = card.genre_ids.length ? card.genre_ids : novelFacet?.g || [];
      const genres = genreIds.map((id) => genreNames[id]).filter(Boolean).map(normalize);
      const tags = (novelFacet?.t || []).map((id) => tagNames[id]).filter(Boolean).map(normalize);
      if (!passesFilters(card, genres, tags, request)) return [];

      const ranks: Record<string, number> = { ...(candidate.ranks || {}) };
      (candidate.r || []).forEach((rank, index) => {
        if (rank != null && channels[index]) ranks[channels[index]] = rank;
      });
      const score = Object.entries(ranks).reduce((sum, [channel, rank]) =>
        sum + Math.max(0, weights[channel] || 0) / (60 + rank), 0);
      const hiddenGemMultiplier = request.hidden_gem_mode
        ? 1 + Math.max(0, request.hidden_gem_strength ?? 0.3) / Math.max(1, Math.log10(card.reading_list_count + 10))
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
        match_score_percent: maximum > 0 ? Math.max(0, Math.min(100, Math.round(100 * score / maximum))) : 0,
        channel_ranks: ranks,
        shared_tags: sharedTags,
        evidence_bullets: candidate.evidence_bullets || buildEvidence(candidate, sharedTags),
        adjusted: score * hiddenGemMultiplier
      }];
    }).sort((a, b) => b.adjusted - a.adjusted || a.target_id - b.target_id);

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
  if (candidate.list_count) evidence.push(`Co-occurs on ${candidate.list_count} curated list(s)`);
  return evidence.length ? evidence : ['Related through catalog evidence'];
}
