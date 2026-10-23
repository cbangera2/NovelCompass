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

// Hot paths below use typed arrays and counting passes instead of sorting full catalogs and keying Maps by id:
// the title page does this once per visit, on the main thread, so every millisecond is a phone's tenth of one.

interface BucketStats {
  items: CorpusItem[];
  ratedCount: number;
  priorMean: number;
  priorVotes: number;
  /** Sample-size-adjusted rating, parallel to `items`; NaN for unrated titles. */
  adjusted: Float64Array;
  votesSorted: Float64Array;
}

const statsCache = new WeakMap<AnalyticsCorpus, Map<Bucket, BucketStats>>();

const isRated = (item: CorpusItem) => item.votes > 0 && item.rating > 0;

function median(sorted: ArrayLike<number>): number {
  if (!sorted.length) return 0;
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Number of values strictly greater than `value` in an ascending array. */
function countGreater(sortedAsc: ArrayLike<number>, value: number): number {
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
  const votes = new Float64Array(items.length);
  let ratedCount = 0;
  let ratingSum = 0;
  for (const item of items) {
    if (!isRated(item)) continue;
    ratingSum += item.rating;
    votes[ratedCount++] = item.votes;
  }
  const votesSorted = votes.subarray(0, ratedCount).sort();
  const priorMean = ratedCount ? ratingSum / ratedCount : 0;
  // The prior is "as if every title had the typical number of votes already at the typical rating".
  const priorVotes = Math.max(1, median(votesSorted));
  const adjusted = new Float64Array(items.length).fill(NaN);
  items.forEach((item, index) => {
    if (isRated(item)) adjusted[index] = shrink(item.rating, item.votes, priorMean, priorVotes);
  });
  const stats: BucketStats = { items, ratedCount, priorMean, priorVotes, adjusted, votesSorted };
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
  const mine = stats.adjusted[stats.items.indexOf(item)];
  if (Number.isNaN(mine)) return null;
  let rawBetter = 0;
  let adjustedBetter = 0;
  stats.items.forEach((other, index) => {
    if (other.rating > item.rating && isRated(other)) rawBetter += 1;
    if (stats.adjusted[index] > mine) adjustedBetter += 1;
  });
  const votesPercentile = Math.round(1000 * (stats.votesSorted.length - countGreater(stats.votesSorted, item.votes)) / stats.votesSorted.length) / 10;
  const result: TrustAnalysis = {
    bucket: item.bucket,
    rating: item.rating,
    votes: item.votes,
    adjusted: mine,
    priorMean: stats.priorMean,
    priorVotes: stats.priorVotes,
    population: stats.ratedCount,
    rawRank: rawBetter + 1,
    adjustedRank: adjustedBetter + 1,
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
  const mine = stats.adjusted[stats.items.indexOf(item)];

  // One accumulator slot per facet of this title; facet id -> slot through flat lookup tables.
  const facets = [
    ...item.genres.map((ref) => ({ kind: 'genre' as const, ref })),
    ...item.tags.map((ref) => ({ kind: 'tag' as const, ref })),
  ];
  const slotTable = (kind: 'genre' | 'tag', size: number) => {
    const table = new Int32Array(size).fill(-1);
    facets.forEach((facet, slot) => { if (facet.kind === kind) table[facet.ref] = slot; });
    return table;
  };
  const genreSlot = slotTable('genre', Math.max(corpus.genreNames.length, ...item.genres, 0) + 1);
  const tagSlot = slotTable('tag', Math.max(corpus.tagNames.length, ...item.tags, 0) + 1);
  const pop = new Int32Array(facets.length);
  const ratedPop = new Int32Array(facets.length);
  const ratingSum = new Float64Array(facets.length);
  const adjBetter = new Int32Array(facets.length);
  const readersBetter = new Int32Array(facets.length);

  const { items, adjusted } = stats;
  for (let index = 0; index < items.length; index += 1) {
    const other = items[index];
    const otherAdjusted = adjusted[index];
    const rated = otherAdjusted === otherAdjusted; // not NaN
    const moreReaders = other.readers > item.readers;
    const better = rated && otherAdjusted > mine;
    const genres = other.genres;
    for (let k = 0; k < genres.length; k += 1) {
      const genre = genres[k];
      if (genre >= genreSlot.length) continue;
      const slot = genreSlot[genre];
      if (slot < 0) continue;
      pop[slot] += 1;
      if (rated) { ratedPop[slot] += 1; ratingSum[slot] += other.rating; }
      if (better) adjBetter[slot] += 1;
      if (moreReaders) readersBetter[slot] += 1;
    }
    const tags = other.tags;
    for (let k = 0; k < tags.length; k += 1) {
      const tag = tags[k];
      if (tag >= tagSlot.length) continue;
      const slot = tagSlot[tag];
      if (slot < 0) continue;
      pop[slot] += 1;
      if (rated) { ratedPop[slot] += 1; ratingSum[slot] += other.rating; }
      if (better) adjBetter[slot] += 1;
      if (moreReaders) readersBetter[slot] += 1;
    }
  }

  const all = facets.flatMap((facet, slot): FacetCohort[] => {
    const name = (facet.kind === 'genre' ? corpus.genreNames[facet.ref] : corpus.tagNames[facet.ref]) || '';
    if (!name || pop[slot] === 0) return [];
    return [{
      kind: facet.kind,
      name,
      population: pop[slot],
      prevalence: items.length ? pop[slot] / items.length : 0,
      avgRating: ratedPop[slot] ? ratingSum[slot] / ratedPop[slot] : 0,
      ratingRank: adjBetter[slot] + 1,
      readerRank: readersBetter[slot] + 1,
    }];
  });
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
  return { bucket: item.bucket, bucketSize: items.length, niches, distinctive, common };
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
