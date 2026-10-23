/**
 * Catalog-wide analytics for a title page. Everything here is a pure function of an `AnalyticsCorpus`
 * (one compact row per catalog title) so it works from the static snapshot and can be unit-tested.
 *
 * Titles are only ever compared with titles of the same format bucket (novel / manga / anime): ratings and
 * vote counts are not on a comparable footing across formats.
 */
import { resolveMediaBucket, type MediaTypeChoice } from './mediaFilterState';
import {
  affinityMapsFromTaste,
  buildNegativeIds,
  computeTasteProfile,
  selectPositiveSeeds,
  tasteAffinityAdjustment,
} from './profile/taste';
import type { LocalUserProfile } from './profile/types';
import type { NovelDetail } from './types';

export type Bucket = MediaTypeChoice;

export interface CorpusItem {
  id: number;
  bucket: Bucket;
  rating: number;
  votes: number;
  readers: number;
  /** Chapters (manga) or episodes (anime); 0 when the snapshot has none. */
  units: number;
  genres: number[];
  tags: number[];
}

export interface AnalyticsCorpus {
  items: CorpusItem[];
  byId: Map<number, CorpusItem>;
  genreNames: string[];
  tagNames: string[];
}

export const BUCKET_NOUN: Record<Bucket, string> = { novel: 'novels', manga: 'manga', anime: 'anime' };

export function bucketOf(id: number, mediaType?: string | null): Bucket {
  return resolveMediaBucket(id, mediaType);
}

export function buildCorpus(
  rows: Array<Omit<CorpusItem, 'bucket'> & { mediaType?: string | null }>,
  genreNames: string[],
  tagNames: string[],
): AnalyticsCorpus {
  const items = rows.map(({ mediaType, ...row }): CorpusItem => ({ ...row, bucket: bucketOf(row.id, mediaType) }));
  return { items, byId: new Map(items.map((item) => [item.id, item])), genreNames, tagNames };
}

// ---------- per-bucket statistics (cached per corpus) ----------

interface BucketStats {
  items: CorpusItem[];
  rated: CorpusItem[];
  priorMean: number;
  priorVotes: number;
  adjusted: Map<number, number>;
  adjustedSorted: number[];
  ratingSorted: number[];
  votesSorted: number[];
}

const statsCache = new WeakMap<AnalyticsCorpus, Map<Bucket, BucketStats>>();

const isRated = (item: CorpusItem) => item.votes > 0 && item.rating > 0;

function median(sorted: number[]): number {
  if (!sorted.length) return 0;
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Number of values strictly greater than `value` in an ascending array. */
function countGreater(sortedAsc: number[], value: number): number {
  let lo = 0;
  let hi = sortedAsc.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sortedAsc[mid] <= value) lo = mid + 1;
    else hi = mid;
  }
  return sortedAsc.length - lo;
}

function bucketStats(corpus: AnalyticsCorpus, bucket: Bucket): BucketStats {
  let perBucket = statsCache.get(corpus);
  if (!perBucket) statsCache.set(corpus, (perBucket = new Map()));
  const cached = perBucket.get(bucket);
  if (cached) return cached;

  const items = corpus.items.filter((item) => item.bucket === bucket);
  const rated = items.filter(isRated);
  const priorMean = rated.length ? rated.reduce((sum, item) => sum + item.rating, 0) / rated.length : 0;
  const votesSorted = rated.map((item) => item.votes).sort((a, b) => a - b);
  // The prior is "as if every title had the typical number of votes already at the typical rating".
  const priorVotes = Math.max(1, median(votesSorted));
  const adjusted = new Map<number, number>();
  for (const item of rated) adjusted.set(item.id, shrink(item.rating, item.votes, priorMean, priorVotes));
  const stats: BucketStats = {
    items,
    rated,
    priorMean,
    priorVotes,
    adjusted,
    adjustedSorted: [...adjusted.values()].sort((a, b) => a - b),
    ratingSorted: rated.map((item) => item.rating).sort((a, b) => a - b),
    votesSorted,
  };
  perBucket.set(bucket, stats);
  return stats;
}

/** Bayesian average: pulls a rating toward the format mean in proportion to how few votes back it. */
export function shrink(rating: number, votes: number, priorMean: number, priorVotes: number): number {
  return (votes * rating + priorVotes * priorMean) / (votes + priorVotes);
}

/** Wilson score interval for a proportion; stays honest at small n where a plain percentage does not. */
export function wilsonInterval(successes: number, n: number, z = 1.96): { low: number; high: number } | null {
  if (n <= 0) return null;
  const p = successes / n;
  const denom = 1 + (z * z) / n;
  const centre = p + (z * z) / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * n)) / n);
  return { low: Math.max(0, (centre - margin) / denom), high: Math.min(1, (centre + margin) / denom) };
}

// ---------- 1. trust-adjusted rating ----------

export interface TrustAnalysis {
  bucket: Bucket;
  rating: number;
  votes: number;
  adjusted: number;
  priorMean: number;
  priorVotes: number;
  population: number;
  rawRank: number;
  adjustedRank: number;
  votesPercentile: number;
  sample: 'thin' | 'typical' | 'large';
  /** Share of voters giving 4-5 stars with a 95% interval; only where the snapshot has the star histogram. */
  positive?: { share: number; low: number; high: number; votes: number };
}

export function trustAnalysis(
  corpus: AnalyticsCorpus,
  id: number,
  dist?: NovelDetail['rating_dist'],
): TrustAnalysis | null {
  const item = corpus.byId.get(id);
  if (!item || !isRated(item)) return null;
  const stats = bucketStats(corpus, item.bucket);
  const adjusted = stats.adjusted.get(id);
  if (adjusted == null) return null;
  const votesPercentile = Math.round(1000 * (stats.votesSorted.length - countGreater(stats.votesSorted, item.votes)) / stats.votesSorted.length) / 10;
  const result: TrustAnalysis = {
    bucket: item.bucket,
    rating: item.rating,
    votes: item.votes,
    adjusted,
    priorMean: stats.priorMean,
    priorVotes: stats.priorVotes,
    population: stats.rated.length,
    rawRank: countGreater(stats.ratingSorted, item.rating) + 1,
    adjustedRank: countGreater(stats.adjustedSorted, adjusted) + 1,
    votesPercentile,
    sample: votesPercentile < 25 ? 'thin' : votesPercentile > 75 ? 'large' : 'typical',
  };
  if (dist) {
    const total = (['1', '2', '3', '4', '5'] as const).reduce((sum, star) => sum + (dist[star] || 0), 0);
    const interval = total >= 30 ? wilsonInterval((dist['4'] || 0) + (dist['5'] || 0), total) : null;
    if (interval) {
      result.positive = { share: ((dist['4'] || 0) + (dist['5'] || 0)) / total, ...interval, votes: total };
    }
  }
  return result;
}

// ---------- 2 + 3. niches and distinctive tags ----------

export interface FacetCohort {
  kind: 'genre' | 'tag';
  name: string;
  /** Titles in this niche, same format only (includes this title). */
  population: number;
  /** population / all titles of the format. */
  prevalence: number;
  avgRating: number;
  ratingRank: number;
  readerRank: number;
}

export interface FacetAnalysis {
  bucket: Bucket;
  bucketSize: number;
  /** The most specific niches this title belongs to, smallest first. */
  niches: FacetCohort[];
  /** Rare tags and genres: what sets this title apart. */
  distinctive: FacetCohort[];
  /** Very common ones, shown last and muted. */
  common: FacetCohort[];
}

export const MIN_NICHE_SIZE = 40;
const DISTINCTIVE_BELOW = 0.05;
const COMMON_FROM = 0.25;

export function facetAnalysis(corpus: AnalyticsCorpus, id: number): FacetAnalysis | null {
  const item = corpus.byId.get(id);
  if (!item || (!item.genres.length && !item.tags.length)) return null;
  const stats = bucketStats(corpus, item.bucket);
  const mine = stats.adjusted.get(id);

  interface Acc { kind: 'genre' | 'tag'; ref: number; pop: number; ratedPop: number; ratingSum: number; adjBetter: number; readersBetter: number }
  const accs = new Map<string, Acc>();
  const genreAcc = new Map<number, Acc>();
  const tagAcc = new Map<number, Acc>();
  for (const g of item.genres) { const a = { kind: 'genre' as const, ref: g, pop: 0, ratedPop: 0, ratingSum: 0, adjBetter: 0, readersBetter: 0 }; genreAcc.set(g, a); accs.set(`g${g}`, a); }
  for (const t of item.tags) { const a = { kind: 'tag' as const, ref: t, pop: 0, ratedPop: 0, ratingSum: 0, adjBetter: 0, readersBetter: 0 }; tagAcc.set(t, a); accs.set(`t${t}`, a); }

  for (const other of stats.items) {
    const otherAdjusted = stats.adjusted.get(other.id);
    const visit = (acc: Acc | undefined) => {
      if (!acc) return;
      acc.pop += 1;
      if (otherAdjusted != null) {
        acc.ratedPop += 1;
        acc.ratingSum += other.rating;
        if (mine != null && otherAdjusted > mine) acc.adjBetter += 1;
      }
      if (other.readers > item.readers) acc.readersBetter += 1;
    };
    for (const g of other.genres) visit(genreAcc.get(g));
    for (const t of other.tags) visit(tagAcc.get(t));
  }

  const toCohort = (acc: Acc): FacetCohort => ({
    kind: acc.kind,
    name: (acc.kind === 'genre' ? corpus.genreNames[acc.ref] : corpus.tagNames[acc.ref]) || '',
    population: acc.pop,
    prevalence: stats.items.length ? acc.pop / stats.items.length : 0,
    avgRating: acc.ratedPop ? acc.ratingSum / acc.ratedPop : 0,
    ratingRank: acc.adjBetter + 1,
    readerRank: acc.readersBetter + 1,
  });
  const all = [...accs.values()].map(toCohort).filter((c) => c.name && c.population > 0);
  const niches = all
    .filter((c) => c.population >= MIN_NICHE_SIZE)
    .sort((a, b) => a.population - b.population || a.name.localeCompare(b.name))
    .slice(0, 5);
  const distinctive = all
    .filter((c) => c.prevalence < DISTINCTIVE_BELOW)
    .sort((a, b) => a.prevalence - b.prevalence || a.name.localeCompare(b.name))
    .slice(0, 8);
  const common = all
    .filter((c) => c.prevalence >= COMMON_FROM)
    .sort((a, b) => b.prevalence - a.prevalence || a.name.localeCompare(b.name))
    .slice(0, 4);
  return { bucket: item.bucket, bucketSize: stats.items.length, niches, distinctive, common };
}

// ---------- 4. length and time commitment ----------

export interface LengthAnalysis {
  bucket: Bucket;
  units: number;
  unitLabel: 'episodes' | 'chapters';
  percentile: number;
  median: number;
  /** Rough time to finish. An assumption (24 min per episode, 5 per chapter), not catalog data. */
  hours: number;
  shape: string;
}

const MINUTES_PER_UNIT: Partial<Record<Bucket, number>> = { anime: 24, manga: 5 };

function lengthShape(bucket: Bucket, units: number): string {
  if (bucket === 'anime') {
    if (units <= 1) return 'A film or one-off';
    if (units <= 13) return 'One season';
    if (units <= 26) return 'Two seasons';
    if (units <= 52) return 'A multi-season run';
    return 'A long-runner';
  }
  if (units <= 30) return 'A short series';
  if (units <= 100) return 'Mid-length';
  if (units <= 300) return 'A long series';
  return 'An epic';
}

/** Anime and manga only: the snapshot has no chapter counts for novels. */
export function lengthAnalysis(corpus: AnalyticsCorpus, id: number): LengthAnalysis | null {
  const item = corpus.byId.get(id);
  const minutes = item && MINUTES_PER_UNIT[item.bucket];
  if (!item || !minutes || item.units <= 0) return null;
  const withLength = bucketStats(corpus, item.bucket).items.map((other) => other.units).filter((units) => units > 0).sort((a, b) => a - b);
  if (withLength.length < 10) return null;
  const shorter = withLength.length - countGreater(withLength, item.units - 1);
  return {
    bucket: item.bucket,
    units: item.units,
    unitLabel: item.bucket === 'anime' ? 'episodes' : 'chapters',
    percentile: Math.round((1000 * shorter) / withLength.length) / 10,
    median: median(withLength),
    hours: Math.round((item.units * minutes) / 6) / 10,
    shape: lengthShape(item.bucket, item.units),
  };
}

// ---------- 6 + 7. fit with your library ----------

export type FitVerdict = 'strong' | 'mixed' | 'weak';

export interface FitAnalysis {
  verdict: FitVerdict;
  multiplier: number;
  /** Which part of the library the taste was built from. */
  scope: Bucket | 'all';
  seedCount: number;
  liked: string[];
  avoided: string[];
  closest: Array<{ id: number; title: string; rating?: number; shared: number }>;
}

export type FitResult = FitAnalysis | { reason: 'no-profile' | 'few-seeds' };

const MIN_FIT_SEEDS = 3;
const STRONG_FIT = 1.12;
const WEAK_FIT = 0.92;
const MIN_STRONG_TAGS = 3;

const toDetail = (corpus: AnalyticsCorpus, item: CorpusItem): NovelDetail =>
  // computeTasteProfile only reads id, genres and tags from a detail.
  ({
    id: item.id,
    genres: item.genres.map((g) => corpus.genreNames[g]).filter(Boolean),
    tags: item.tags.map((t) => corpus.tagNames[t]).filter(Boolean),
  }) as NovelDetail;

export function fitAnalysis(corpus: AnalyticsCorpus, id: number, profile: LocalUserProfile | null): FitResult {
  const item = corpus.byId.get(id);
  if (!item || !profile?.entries.length) return { reason: 'no-profile' };

  // Prefer a taste built from the same format; fall back to the whole library when that is too thin.
  let scope: Bucket | 'all' = item.bucket;
  let seeds = selectPositiveSeeds(profile, { scope });
  if (seeds.length < MIN_FIT_SEEDS) {
    scope = 'all';
    seeds = selectPositiveSeeds(profile, { scope });
  }
  if (seeds.length < MIN_FIT_SEEDS) return { reason: 'few-seeds' };

  const detailIds = new Set([...seeds.map((s) => s.novel_id), ...buildNegativeIds(profile)]);
  const details = [...detailIds].flatMap((detailId) => {
    const found = corpus.byId.get(detailId);
    return found ? [toDetail(corpus, found)] : [];
  });
  const taste = computeTasteProfile(profile, details, { scope });
  const affinity = affinityMapsFromTaste(taste);
  const here = toDetail(corpus, item);
  const { multiplier } = tasteAffinityAdjustment(here.tags, here.genres, affinity);

  const byWeight = (map: Map<string, number>) => (name: string) => map.get(name.toLowerCase()) ?? 0;
  const likedWeight = byWeight(affinity.likedTags);
  const avoidWeight = byWeight(affinity.avoidTags);
  const liked = here.tags.filter((tag) => likedWeight(tag) > 0).sort((a, b) => likedWeight(b) - likedWeight(a));
  const avoided = here.tags.filter((tag) => avoidWeight(tag) > 0).sort((a, b) => avoidWeight(b) - avoidWeight(a));

  const mineTags = new Set(item.tags);
  const entryById = new Map(profile.entries.flatMap((entry) => (entry.novel_id != null ? [[entry.novel_id, entry] as const] : [])));
  const closest = seeds
    .filter((seed) => seed.novel_id !== id)
    .flatMap((seed) => {
      const other = corpus.byId.get(seed.novel_id);
      if (!other) return [];
      const shared = other.tags.filter((tag) => mineTags.has(tag)).length;
      return shared >= 3 ? [{ id: seed.novel_id, title: seed.title, rating: entryById.get(seed.novel_id)?.rating, shared, weight: seed.weight }] : [];
    })
    .sort((a, b) => b.shared - a.shared || b.weight - a.weight)
    .slice(0, 3)
    .map(({ weight: _weight, ...rest }) => rest);

  // The multiplier alone is generous (a couple of heavily weighted tags can push it over), so a strong or
  // weak call also needs the evidence to be broad and to point clearly one way.
  const verdict: FitVerdict =
    multiplier >= STRONG_FIT && liked.length >= MIN_STRONG_TAGS && avoided.length < liked.length ? 'strong'
    : multiplier <= WEAK_FIT && avoided.length > liked.length ? 'weak'
    : 'mixed';

  return {
    verdict,
    multiplier,
    scope,
    seedCount: seeds.length,
    liked,
    avoided,
    closest,
  };
}

export const FIT_LABEL: Record<FitVerdict, string> = {
  strong: 'Strong fit for you',
  mixed: 'Mixed fit for you',
  weak: 'Probably not for you',
};
