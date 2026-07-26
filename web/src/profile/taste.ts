/**
 * Derive a personal TasteProfile from the local library + feedback.
 * Pure client-side, static-safe. Unmatched titles still count in evidence stats
 * but cannot seed ranking until catalog-matched.
 */
import type { NovelDetail, Recommendation, RecommendRequest, RecommendResponse } from '../types';
import type { RecommendationDataSource } from '../data';
import type { LocalUserProfile, ProfileEntry, ProfileMediaKind } from './types';
import { inferMediaKind } from './profileStats';

export const TASTE_PROFILE_VERSION = 1;
export const DEFAULT_SEED_LIMIT = 12;
export const DEFAULT_DETAIL_LIMIT = 80;

export type WeightedFacet = {
  name: string;
  weight: number;
  count: number;
  /** Positive affinity vs avoid */
  polarity: 'like' | 'avoid';
};

export type TasteSeed = {
  novel_id: number;
  title: string;
  weight: number;
  reason: string;
};

export type TasteProfile = {
  version: typeof TASTE_PROFILE_VERSION;
  computed_at: string;
  dataset_version: string;
  scope: 'all' | ProfileMediaKind;
  positive_seeds: TasteSeed[];
  negative_ids: number[];
  /** Matched library IDs to exclude from recs (already know / in list). */
  exclude_ids: number[];
  liked_genres: WeightedFacet[];
  liked_tags: WeightedFacet[];
  avoid_genres: WeightedFacet[];
  avoid_tags: WeightedFacet[];
  evidence: {
    total_entries: number;
    matched: number;
    unmatched: number;
    rated: number;
    completed: number;
    dropped: number;
    feedback_love: number;
    feedback_not_for_me: number;
    sources: string[];
    /** Honest limitations shown in UI. */
    caveats: string[];
  };
};

function entryWeight(entry: ProfileEntry, loveIds: Set<number>): { weight: number; reason: string } | null {
  if (entry.novel_id == null) return null;
  const loved = loveIds.has(entry.novel_id);
  if (entry.status === 'dropped') return null;
  if (entry.rating != null && entry.rating <= 2.5) return null;

  if (loved && entry.rating != null && entry.rating >= 4) {
    return { weight: Math.max(entry.rating, 4.5) + 0.5, reason: `Loved · ${entry.rating}★` };
  }
  if (loved) return { weight: 4.5, reason: 'Loved' };
  if (entry.rating != null && entry.rating >= 4) {
    return { weight: entry.rating, reason: `${entry.rating}★ personal rating` };
  }
  if (entry.status === 'completed') {
    return { weight: entry.rating ?? 3.8, reason: entry.rating ? `Completed · ${entry.rating}★` : 'Completed (unrated)' };
  }
  if (entry.rating != null && entry.rating >= 3.5) {
    return { weight: entry.rating * 0.85, reason: `${entry.rating}★ (still reading / other status)` };
  }
  return null;
}

function isNegative(entry: ProfileEntry, notForMe: Set<number>): boolean {
  if (entry.novel_id == null) return false;
  if (notForMe.has(entry.novel_id)) return true;
  if (entry.status === 'dropped') return true;
  if (entry.rating != null && entry.rating <= 2.5) return true;
  return false;
}

function accumulateFacets(
  details: NovelDetail[],
  weightById: Map<number, number>,
  kind: 'genres' | 'tags'
): Map<string, { weight: number; count: number }> {
  const out = new Map<string, { weight: number; count: number }>();
  for (const detail of details) {
    const w = weightById.get(detail.id) ?? 0;
    if (w === 0) continue;
    const values = kind === 'genres' ? detail.genres || [] : detail.tags || [];
    for (const raw of values) {
      const name = raw.trim();
      if (!name) continue;
      const row = out.get(name) || { weight: 0, count: 0 };
      row.weight += w;
      row.count += 1;
      out.set(name, row);
    }
  }
  return out;
}

function topFacets(
  map: Map<string, { weight: number; count: number }>,
  polarity: 'like' | 'avoid',
  limit: number
): WeightedFacet[] {
  return [...map.entries()]
    .map(([name, row]) => ({
      name,
      weight: Math.round(row.weight * 100) / 100,
      count: row.count,
      polarity,
    }))
    .sort((a, b) => b.weight - a.weight || b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, limit);
}

export function selectPositiveSeeds(
  profile: LocalUserProfile,
  options: { limit?: number; scope?: 'all' | ProfileMediaKind } = {}
): TasteSeed[] {
  const limit = options.limit ?? DEFAULT_SEED_LIMIT;
  const scope = options.scope ?? 'all';
  const loveIds = new Set(
    (profile.feedback || []).filter((f) => f.signal === 'love').map((f) => f.novel_id)
  );
  const seeds: TasteSeed[] = [];
  for (const entry of profile.entries) {
    if (entry.novel_id == null) continue;
    if (scope !== 'all' && inferMediaKind(entry) !== scope) continue;
    const scored = entryWeight(entry, loveIds);
    if (!scored) continue;
    seeds.push({
      novel_id: entry.novel_id,
      title: entry.imported_title,
      weight: scored.weight,
      reason: scored.reason,
    });
  }
  seeds.sort((a, b) => b.weight - a.weight || a.title.localeCompare(b.title));
  // Dedupe by novel_id keeping highest weight
  const seen = new Set<number>();
  const unique: TasteSeed[] = [];
  for (const seed of seeds) {
    if (seen.has(seed.novel_id)) continue;
    seen.add(seed.novel_id);
    unique.push(seed);
    if (unique.length >= limit) break;
  }
  return unique;
}

export function buildExcludeIds(profile: LocalUserProfile): number[] {
  const ids = new Set<number>();
  for (const entry of profile.entries) {
    if (entry.novel_id != null) ids.add(entry.novel_id);
  }
  for (const fb of profile.feedback || []) {
    if (fb.signal === 'not_for_me') ids.add(fb.novel_id);
  }
  return [...ids];
}

export function buildNegativeIds(profile: LocalUserProfile): number[] {
  const notForMe = new Set(
    (profile.feedback || []).filter((f) => f.signal === 'not_for_me').map((f) => f.novel_id)
  );
  const ids = new Set<number>();
  for (const entry of profile.entries) {
    if (isNegative(entry, notForMe) && entry.novel_id != null) ids.add(entry.novel_id);
  }
  for (const id of notForMe) ids.add(id);
  return [...ids];
}

/**
 * Compute taste profile. `details` should cover seed + negative matched titles
 * when facet weights are desired; missing details still produce seed/exclude lists.
 */
export function computeTasteProfile(
  profile: LocalUserProfile,
  details: NovelDetail[],
  options: {
    datasetVersion?: string;
    scope?: 'all' | ProfileMediaKind;
    seedLimit?: number;
  } = {}
): TasteProfile {
  const scope = options.scope ?? 'all';
  const seeds = selectPositiveSeeds(profile, { limit: options.seedLimit ?? DEFAULT_SEED_LIMIT, scope });
  const exclude_ids = buildExcludeIds(profile);
  const negative_ids = buildNegativeIds(profile);
  const detailById = new Map(details.map((d) => [d.id, d]));

  const posWeight = new Map(seeds.map((s) => [s.novel_id, s.weight]));
  const negWeight = new Map<number, number>();
  for (const id of negative_ids) {
    const entry = profile.entries.find((e) => e.novel_id === id);
    const w = entry?.rating != null ? Math.max(0.5, 5 - entry.rating) : 2;
    negWeight.set(id, w);
  }

  const posDetails = seeds.map((s) => detailById.get(s.novel_id)).filter(Boolean) as NovelDetail[];
  const negDetails = negative_ids.map((id) => detailById.get(id)).filter(Boolean) as NovelDetail[];

  const likedGenreMap = accumulateFacets(posDetails, posWeight, 'genres');
  const likedTagMap = accumulateFacets(posDetails, posWeight, 'tags');
  const avoidGenreMap = accumulateFacets(negDetails, negWeight, 'genres');
  const avoidTagMap = accumulateFacets(negDetails, negWeight, 'tags');

  const matched = profile.entries.filter((e) => e.novel_id != null).length;
  const unmatched = profile.entries.length - matched;
  const rated = profile.entries.filter((e) => e.rating != null).length;
  const completed = profile.entries.filter((e) => e.status === 'completed').length;
  const dropped = profile.entries.filter((e) => e.status === 'dropped').length;
  const feedback_love = (profile.feedback || []).filter((f) => f.signal === 'love').length;
  const feedback_not_for_me = (profile.feedback || []).filter((f) => f.signal === 'not_for_me').length;
  const sources = [...new Set(profile.entries.map((e) => e.source_file).filter(Boolean))];

  const caveats: string[] = [];
  if (unmatched > 0) {
    caveats.push(
      `${unmatched.toLocaleString()} library titles are not in this catalog snapshot, so they cannot seed or exclude recommendations yet.`
    );
  }
  if (seeds.length === 0) {
    caveats.push(
      'No strong positive seeds yet. Rate titles 4★+, mark Completed, or use Love on recommendations.'
    );
  } else if (seeds.length < 3) {
    caveats.push(
      `Only ${seeds.length} positive seed${seeds.length === 1 ? '' : 's'} — For You will be noisier until you rate more matched titles.`
    );
  }
  if (posDetails.length < seeds.length) {
    caveats.push(
      `Loaded ${posDetails.length}/${seeds.length} seed details for genre/tag affinity; missing details still seed ranking by ID.`
    );
  }
  if (feedback_love + feedback_not_for_me === 0) {
    caveats.push('No Love / Not-for-me feedback yet — personalization leans on ratings and status only.');
  }
  if (rated === 0 && completed === 0) {
    caveats.push('Import Completed lists or add personal ratings for a useful taste signal.');
  }

  return {
    version: TASTE_PROFILE_VERSION,
    computed_at: new Date().toISOString(),
    dataset_version: options.datasetVersion || profile.dataset_version || 'unknown',
    scope,
    positive_seeds: seeds,
    negative_ids,
    exclude_ids,
    liked_genres: topFacets(likedGenreMap, 'like', 10),
    liked_tags: topFacets(likedTagMap, 'like', 16),
    avoid_genres: topFacets(avoidGenreMap, 'avoid', 8),
    avoid_tags: topFacets(avoidTagMap, 'avoid', 12),
    evidence: {
      total_entries: profile.entries.length,
      matched,
      unmatched,
      rated,
      completed,
      dropped,
      feedback_love,
      feedback_not_for_me,
      sources,
      caveats,
    },
  };
}

export type AffinityMaps = {
  likedTags: Map<string, number>;
  avoidTags: Map<string, number>;
  likedGenres: Map<string, number>;
  avoidGenres: Map<string, number>;
};

export function affinityMapsFromTaste(taste: Pick<TasteProfile, 'liked_tags' | 'avoid_tags' | 'liked_genres' | 'avoid_genres'>): AffinityMaps {
  const toMap = (facets: WeightedFacet[]) => new Map(facets.map((f) => [f.name.toLowerCase(), f.weight]));
  return {
    likedTags: toMap(taste.liked_tags),
    avoidTags: toMap(taste.avoid_tags),
    likedGenres: toMap(taste.liked_genres),
    avoidGenres: toMap(taste.avoid_genres),
  };
}

/**
 * Soft personalization on shared tags (and optional genre names).
 * Multiplier is clamped so one trope cannot erase multi-seed consensus.
 */
export function tasteAffinityAdjustment(
  tags: string[] | undefined,
  genres: string[] | undefined,
  affinity?: AffinityMaps | null
): { multiplier: number; liked: string[]; avoided: string[] } {
  if (!affinity) return { multiplier: 1, liked: [], avoided: [] };
  let likeScore = 0;
  let avoidScore = 0;
  const liked: string[] = [];
  const avoided: string[] = [];
  for (const raw of tags || []) {
    const key = raw.toLowerCase();
    const lw = affinity.likedTags.get(key);
    const aw = affinity.avoidTags.get(key);
    if (lw) {
      likeScore += lw;
      liked.push(raw);
    }
    if (aw) {
      avoidScore += aw;
      avoided.push(raw);
    }
  }
  for (const raw of genres || []) {
    const key = raw.toLowerCase();
    const lw = affinity.likedGenres.get(key);
    const aw = affinity.avoidGenres.get(key);
    if (lw) {
      likeScore += lw * 0.85;
      liked.push(raw);
    }
    if (aw) {
      avoidScore += aw * 0.85;
      avoided.push(raw);
    }
  }
  // Scale: a few strong tags → ~±15–30%; hard cap so multi-seed structure remains.
  const raw = 1 + Math.min(0.35, likeScore * 0.012) - Math.min(0.4, avoidScore * 0.016);
  const multiplier = Math.max(0.55, Math.min(1.45, raw));
  return { multiplier, liked: liked.slice(0, 4), avoided: avoided.slice(0, 4) };
}

/** Merge multi-seed recommendation responses with seed weights (static + API safe). */
export function mergeSeedRecommendations(
  seedResults: Array<{ seed: TasteSeed; response: RecommendResponse }>,
  options: {
    excludeIds?: Set<number> | number[];
    limit?: number;
    affinity?: AffinityMaps | null;
  } = {}
): Recommendation[] {
  const exclude = new Set(
    options.excludeIds instanceof Set ? options.excludeIds : options.excludeIds || []
  );
  const limit = options.limit ?? 40;
  type Acc = {
    rec: Recommendation;
    score: number;
    seeds: Array<{ id: number; title: string; weight: number }>;
  };
  const byId = new Map<number, Acc>();

  for (const { seed, response } of seedResults) {
    for (const rec of response.recommendations || []) {
      if (exclude.has(rec.target_id)) continue;
      if (rec.target_id === seed.novel_id) continue;
      const contribution = (rec.rrf_score || rec.match_score_percent / 100 || 0.01) * seed.weight;
      const existing = byId.get(rec.target_id);
      if (!existing) {
        byId.set(rec.target_id, {
          rec: { ...rec },
          score: contribution,
          seeds: [{ id: seed.novel_id, title: seed.title, weight: seed.weight }],
        });
      } else {
        existing.score += contribution;
        existing.seeds.push({ id: seed.novel_id, title: seed.title, weight: seed.weight });
        // Keep richer evidence fields when present
        if ((rec.shared_tags?.length || 0) > (existing.rec.shared_tags?.length || 0)) {
          existing.rec.shared_tags = rec.shared_tags;
        }
        existing.rec.channel_ranks = { ...existing.rec.channel_ranks, ...rec.channel_ranks };
        existing.rec.rrf_score = Math.max(existing.rec.rrf_score || 0, rec.rrf_score || 0);
      }
    }
  }

  // Apply taste affinity after multi-seed consensus (explainable soft boost/penalty).
  for (const item of byId.values()) {
    const adj = tasteAffinityAdjustment(item.rec.shared_tags, undefined, options.affinity);
    item.score *= adj.multiplier;
    (item as Acc & { affinity?: typeof adj }).affinity = adj;
  }

  const merged = [...byId.values()]
    .sort((a, b) => b.score - a.score || b.rec.rating - a.rec.rating)
    .slice(0, limit)
    .map((item, _index, all) => {
      const topScore = all[0]?.score || 1;
      const match_score_percent = Math.round(1000 * (item.score / topScore)) / 10;
      const seedTitles = item.seeds
        .sort((a, b) => b.weight - a.weight)
        .slice(0, 3)
        .map((s) => s.title);
      const multiSeedBullet =
        item.seeds.length > 1
          ? `Appeared under ${item.seeds.length} of your seeds (e.g. ${seedTitles.join(', ')})`
          : `From your seed: ${seedTitles[0] || 'library favorite'}`;
      const affinity = (item as Acc & { affinity?: ReturnType<typeof tasteAffinityAdjustment> }).affinity;
      const affinityBullets: string[] = [];
      if (affinity && affinity.multiplier !== 1) {
        if (affinity.liked.length) {
          affinityBullets.push(
            `Taste boost ×${affinity.multiplier.toFixed(2)} via liked tropes: ${affinity.liked.join(', ')}`
          );
        }
        if (affinity.avoided.length) {
          affinityBullets.push(
            `Taste penalty ×${affinity.multiplier.toFixed(2)} via avoided tropes: ${affinity.avoided.join(', ')}`
          );
        }
        if (!affinity.liked.length && !affinity.avoided.length && affinity.multiplier !== 1) {
          affinityBullets.push(`Taste affinity ×${affinity.multiplier.toFixed(2)}`);
        }
      }
      const evidence = [multiSeedBullet, ...affinityBullets, ...(item.rec.evidence_bullets || [])].slice(0, 7);
      return {
        ...item.rec,
        rrf_score: item.score,
        match_score_percent,
        evidence_bullets: evidence,
      };
    });

  return merged;
}

export type ForYouResult = {
  recommendations: Recommendation[];
  seeds_used: TasteSeed[];
  seeds_failed: Array<{ seed: TasteSeed; error: string }>;
  exclude_count: number;
  mode: 'api-multi-seed' | 'client-merge';
  affinity_applied: boolean;
};

/**
 * For You: prefer live multi-seed API when available; otherwise merge single-seed
 * pools (static GitHub Pages path). Individual seed failures are reported, not hidden.
 */
export async function fetchForYouRecommendations(
  source: RecommendationDataSource,
  profile: LocalUserProfile,
  baseRequest: Omit<RecommendRequest, 'query'>,
  options: {
    seedLimit?: number;
    scope?: 'all' | ProfileMediaKind;
    onProgress?: (done: number, total: number, seedTitle: string) => void;
    /** Precomputed taste; if omitted, seeds/excludes only (no tag affinity). */
    taste?: TasteProfile | null;
  } = {}
): Promise<ForYouResult> {
  const seeds = options.taste?.positive_seeds?.length
    ? options.taste.positive_seeds.slice(0, options.seedLimit ?? DEFAULT_SEED_LIMIT)
    : selectPositiveSeeds(profile, {
        limit: options.seedLimit ?? DEFAULT_SEED_LIMIT,
        scope: options.scope ?? 'all',
      });
  const excludeIds = options.taste?.exclude_ids?.length
    ? options.taste.exclude_ids
    : buildExcludeIds(profile);
  const excludeSet = new Set(excludeIds);
  const affinity =
    options.taste && (options.taste.liked_tags.length || options.taste.avoid_tags.length)
      ? affinityMapsFromTaste(options.taste)
      : null;

  // Live API: one request multi-seed path (faster, shared filter).
  if (source.mode === 'api' && seeds.length > 0) {
    try {
      options.onProgress?.(0, 1, 'server multi-seed');
      const response = await (source as RecommendationDataSource & {
        getForYouRecommendations?: (body: unknown) => Promise<RecommendResponse & {
          seeds_used?: Array<{ id: number; title: string; weight: number }>;
          seeds_missing?: number[];
        }>;
      }).getForYouRecommendations?.({
        ...baseRequest,
        seeds: seeds.map((s) => ({ id: s.novel_id, weight: s.weight, title: s.title })),
        exclude_novel_ids: excludeIds,
        liked_tags: options.taste?.liked_tags.map((f) => ({ name: f.name, weight: f.weight })) || [],
        avoid_tags: options.taste?.avoid_tags.map((f) => ({ name: f.name, weight: f.weight })) || [],
        limit: baseRequest.limit || 40,
      });
      if (response?.recommendations) {
        options.onProgress?.(1, 1, 'server multi-seed');
        const usedFromServer = (response.seeds_used || []).map((s) => ({
          novel_id: s.id,
          title: s.title,
          weight: s.weight,
          reason: seeds.find((x) => x.novel_id === s.id)?.reason || 'server seed',
        }));
        const missing = new Set(response.seeds_missing || []);
        const seeds_failed = seeds
          .filter((s) => missing.has(s.novel_id) || !usedFromServer.some((u) => u.novel_id === s.novel_id))
          .filter((s) => missing.has(s.novel_id))
          .map((s) => ({ seed: s, error: 'Seed not found in live catalog' }));
        return {
          recommendations: response.recommendations,
          seeds_used: usedFromServer.length ? usedFromServer : seeds.filter((s) => !missing.has(s.novel_id)),
          seeds_failed,
          exclude_count: excludeIds.length,
          mode: 'api-multi-seed',
          affinity_applied: Boolean(affinity),
        };
      }
    } catch {
      // Fall through to client merge (older API or offline).
    }
  }

  const seeds_failed: Array<{ seed: TasteSeed; error: string }> = [];
  const seedResults: Array<{ seed: TasteSeed; response: RecommendResponse }> = [];

  let done = 0;
  for (const seed of seeds) {
    options.onProgress?.(done, seeds.length, seed.title);
    try {
      const response = await source.getRecommendations({
        ...baseRequest,
        query: String(seed.novel_id),
        limit: Math.max(baseRequest.limit || 24, 24),
        exclude_novel_ids: excludeIds,
      });
      seedResults.push({ seed, response });
    } catch (error) {
      seeds_failed.push({
        seed,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    done += 1;
    options.onProgress?.(done, seeds.length, seed.title);
  }

  const recommendations = mergeSeedRecommendations(seedResults, {
    excludeIds: excludeSet,
    limit: baseRequest.limit || 40,
    affinity,
  });

  return {
    recommendations,
    seeds_used: seedResults.map((r) => r.seed),
    seeds_failed,
    exclude_count: excludeIds.length,
    mode: 'client-merge',
    affinity_applied: Boolean(affinity),
  };
}
