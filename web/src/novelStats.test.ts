import { describe, expect, it } from 'vitest';
import {
  buildCorpus,
  facetAnalysis,
  fitAnalysis,
  lengthAnalysis,
  shrink,
  trustAnalysis,
  wilsonInterval,
  type AnalyticsCorpus,
} from './novelStats';
import type { LocalUserProfile, ProfileEntry } from './profile/types';

const GENRES = ['Action', 'Romance'];
const TAGS = ['Isekai', 'Yandere', 'School', 'Revenge', 'Rare Thing'];

/** 120 anime with ids 3,000,001+. Tag 2 (School) is on everything; tag 4 (Rare Thing) on one title. */
function animeCorpus(extra: Parameters<typeof buildCorpus>[0] = []): AnalyticsCorpus {
  const rows = Array.from({ length: 120 }, (_, i) => ({
    id: 3_000_001 + i,
    mediaType: 'anime',
    rating: 3 + (i % 10) / 5, // 3.0 .. 4.8
    votes: 100 + i * 10,
    readers: 1000 + i,
    units: 12 + (i % 5) * 12,
    genres: [i % 2],
    tags: [2, ...(i % 3 === 0 ? [0] : []), ...(i % 4 === 0 ? [1] : []), ...(i === 7 ? [4] : [])],
  }));
  return buildCorpus([...rows, ...extra], GENRES, TAGS);
}

describe('shrink', () => {
  it('pulls few-vote ratings toward the prior and leaves well-voted ones nearly alone', () => {
    expect(shrink(5, 2, 3.5, 100)).toBeCloseTo(3.53, 2);
    expect(shrink(4.4, 10_000, 3.5, 100)).toBeGreaterThan(4.39);
    expect(shrink(4, 0, 3.5, 100)).toBe(3.5);
  });
});

describe('wilsonInterval', () => {
  it('is wide at small n and tight at large n, and stays inside [0, 1]', () => {
    const small = wilsonInterval(9, 10)!;
    const large = wilsonInterval(900, 1000)!;
    expect(small.high - small.low).toBeGreaterThan(large.high - large.low);
    expect(small.high).toBeLessThanOrEqual(1);
    expect(wilsonInterval(0, 5)!.low).toBe(0);
    expect(wilsonInterval(1, 0)).toBeNull();
  });
});

describe('trustAnalysis', () => {
  it('demotes a perfect-rated title with almost no votes', () => {
    const corpus = animeCorpus([
      { id: 3_999_999, mediaType: 'anime', rating: 5, votes: 3, readers: 5, units: 12, genres: [0], tags: [2] },
    ]);
    const trust = trustAnalysis(corpus, 3_999_999)!;
    expect(trust.rawRank).toBe(1);
    expect(trust.adjustedRank).toBeGreaterThan(10);
    expect(trust.adjusted).toBeLessThan(trust.rating);
    expect(trust.sample).toBe('thin');
    expect(trust.population).toBe(121);
  });

  it('is null for unrated titles and adds a positive-share interval when the star histogram exists', () => {
    const corpus = animeCorpus([{ id: 3_999_998, mediaType: 'anime', rating: 0, votes: 0, readers: 1, units: 0, genres: [], tags: [] }]);
    expect(trustAnalysis(corpus, 3_999_998)).toBeNull();
    expect(trustAnalysis(corpus, 123)).toBeNull();
    const withDist = trustAnalysis(corpus, 3_000_001, { '1': 5, '2': 5, '3': 10, '4': 40, '5': 40 })!;
    expect(withDist.positive!.share).toBeCloseTo(0.8, 5);
    expect(withDist.positive!.low).toBeLessThan(0.8);
    expect(withDist.positive!.high).toBeGreaterThan(0.8);
    expect(trustAnalysis(corpus, 3_000_001, { '1': 1, '2': 0, '3': 0, '4': 1, '5': 1 })!.positive).toBeUndefined();
  });
});

describe('facetAnalysis', () => {
  it('finds rare tags, skips tiny niches, and compares only within the format', () => {
    // A novel sharing the "Rare Thing" tag must not count toward the anime cohort.
    const corpus = animeCorpus([
      { id: 10, mediaType: 'novel', rating: 4, votes: 50, readers: 9, units: 0, genres: [0], tags: [4] },
    ]);
    const analysis = facetAnalysis(corpus, 3_000_008)!; // i === 7
    expect(analysis.bucket).toBe('anime');
    expect(analysis.bucketSize).toBe(120);
    const rare = analysis.distinctive.find((c) => c.name === 'Rare Thing')!;
    expect(rare.population).toBe(1);
    expect(rare.prevalence).toBeCloseTo(1 / 120, 5);
    expect(analysis.niches.every((c) => c.population >= 40)).toBe(true);
    expect(analysis.niches.map((c) => c.name)).not.toContain('Rare Thing');
    expect(analysis.common.map((c) => c.name)).toContain('School');
  });

  it('ranks the title inside each niche by adjusted rating, not raw rating', () => {
    const corpus = animeCorpus();
    // Ids 3_000_010 / 3_000_020 are i=9 / i=19: the same 4.8 rating, but i=19 has more votes behind it.
    const fewerVotes = facetAnalysis(corpus, 3_000_010)!;
    const moreVotes = facetAnalysis(corpus, 3_000_020)!;
    expect(fewerVotes.niches.length).toBeGreaterThan(0);
    for (const niche of fewerVotes.niches) {
      const same = moreVotes.niches.find((n) => n.name === niche.name);
      if (same) expect(same.ratingRank).toBeLessThanOrEqual(niche.ratingRank);
    }
    // i=0 has the lowest rating, so it ranks below i=9 wherever they share a niche.
    const lowest = facetAnalysis(corpus, 3_000_001)!;
    for (const niche of lowest.niches) {
      const same = fewerVotes.niches.find((n) => n.name === niche.name);
      if (same) expect(niche.ratingRank).toBeGreaterThan(same.ratingRank);
    }
  });
});

describe('lengthAnalysis', () => {
  it('only exists for anime and manga with a known length', () => {
    const corpus = animeCorpus([
      { id: 10, mediaType: 'novel', rating: 4, votes: 50, readers: 9, units: 900, genres: [], tags: [] },
    ]);
    expect(lengthAnalysis(corpus, 10)).toBeNull();
    const result = lengthAnalysis(corpus, 3_000_005)!; // i=4 -> 60 episodes
    expect(result.unitLabel).toBe('episodes');
    expect(result.units).toBe(60);
    expect(result.hours).toBe(24);
    expect(result.shape).toBe('A long-runner');
    expect(result.percentile).toBeGreaterThan(50);
  });
});

describe('fitAnalysis', () => {
  const entry = (id: number, rating: number, status: ProfileEntry['status'] = 'completed'): ProfileEntry => ({
    novel_id: id, slug: `a-${id}`, imported_title: `Title ${id}`, status, rating, source_file: 'test', media_kind: 'anime',
  });
  const profile = (entries: ProfileEntry[]): LocalUserProfile => ({
    profile_id: 'p', parser_version: 1, dataset_version: 'd', imported_at: '', source_fingerprints: [], entries, curated_lists: [],
  });
  const title = (id: number, tags: number[]) => ({ id, mediaType: 'anime', rating: 4, votes: 100, readers: 1, units: 12, genres: [], tags });
  // Loved: tags Isekai + Yandere + School. Dropped: Revenge. Targets: A = loved tags, B = Revenge, C = unrelated.
  const loved = [3_000_001, 3_000_002, 3_000_003];
  const dropped = [3_000_011, 3_000_012, 3_000_013];
  const corpus = buildCorpus(
    [
      ...loved.map((id) => title(id, [0, 1, 2])),
      ...dropped.map((id) => title(id, [3])),
      title(3_000_021, [0, 1, 2]),
      title(3_000_022, [3]),
      title(3_000_023, [4]),
    ],
    GENRES,
    TAGS,
  );
  const library = profile([...loved.map((id) => entry(id, 5)), ...dropped.map((id) => entry(id, 1.5, 'dropped'))]);

  it('asks for a library, then for more ratings, before saying anything', () => {
    expect(fitAnalysis(corpus, 3_000_021, null)).toEqual({ reason: 'no-profile' });
    expect(fitAnalysis(corpus, 3_000_021, profile([entry(loved[0], 5), entry(loved[1], 5)]))).toEqual({ reason: 'few-seeds' });
  });

  it('reports a strong fit for a title that shares tags with what you loved, and names the closest ones', () => {
    const result = fitAnalysis(corpus, 3_000_021, library);
    if (!('verdict' in result)) throw new Error('expected a verdict');
    expect(result.verdict).toBe('strong');
    expect(result.scope).toBe('anime');
    expect(result.liked).toEqual(expect.arrayContaining(['Isekai', 'Yandere', 'School']));
    expect(result.avoided).toEqual([]);
    expect(result.closest).toHaveLength(3);
    expect(result.closest.every((c) => c.shared === 3 && c.rating === 5)).toBe(true);
  });

  it('flags a title that overlaps what you dropped', () => {
    const result = fitAnalysis(corpus, 3_000_022, library);
    if (!('verdict' in result)) throw new Error('expected a verdict');
    expect(result.verdict).toBe('weak');
    expect(result.avoided).toEqual(['Revenge']);
    expect(result.liked).toEqual([]);
  });

  it('does not call it strong on thin evidence, even when the weights are high', () => {
    // Shares only two of the loved tags, so it can't be a "strong" call.
    const thin = buildCorpus(
      [
        ...loved.map((id) => title(id, [0, 1, 2])),
        title(3_000_031, [0, 1]),
      ],
      GENRES,
      TAGS,
    );
    const result = fitAnalysis(thin, 3_000_031, profile(loved.map((id) => entry(id, 5))));
    if (!('verdict' in result)) throw new Error('expected a verdict');
    expect(result.liked).toHaveLength(2);
    expect(result.verdict).toBe('mixed');
  });

  it('stays neutral when nothing overlaps either way', () => {
    const result = fitAnalysis(corpus, 3_000_023, library);
    if (!('verdict' in result)) throw new Error('expected a verdict');
    expect(result.verdict).toBe('mixed');
  });

  it('falls back to the whole library when the title\'s own format is thin', () => {
    const asManga = profile(loved.map((id) => ({ ...entry(id, 5), media_kind: 'manga' as const })));
    const result = fitAnalysis(corpus, 3_000_021, asManga);
    if (!('verdict' in result)) throw new Error('expected a verdict');
    expect(result.scope).toBe('all');
  });
});

describe('small and odd corpora', () => {
  const lone = (extra: Partial<Parameters<typeof buildCorpus>[0][number]> = {}) =>
    buildCorpus([{ id: 3_000_001, mediaType: 'anime', rating: 4, votes: 10, readers: 1, units: 12, genres: [], tags: [], ...extra }], GENRES, TAGS);

  it('returns nothing, not NaN or a crash, when there is no tag or length data', () => {
    const corpus = lone();
    expect(facetAnalysis(corpus, 3_000_001)).toBeNull();
    expect(lengthAnalysis(corpus, 3_000_001)).toBeNull(); // fewer than 10 titles to compare with
    const trust = trustAnalysis(corpus, 3_000_001)!;
    expect(trust.adjusted).toBeCloseTo(4, 5);
    expect(trust.adjustedRank).toBe(1);
    expect(Number.isFinite(trust.votesPercentile)).toBe(true);
  });

  it('ignores facet ids that are missing from the name tables', () => {
    const corpus = lone({ genres: [99], tags: [250] });
    const analysis = facetAnalysis(corpus, 3_000_001)!;
    expect(analysis.niches).toEqual([]);
    expect(analysis.distinctive).toEqual([]);
  });

  it('is null for ids that are not in the catalog', () => {
    const corpus = lone();
    expect(trustAnalysis(corpus, 42)).toBeNull();
    expect(facetAnalysis(corpus, 42)).toBeNull();
    expect(lengthAnalysis(corpus, 42)).toBeNull();
    expect(fitAnalysis(corpus, 42, null)).toEqual({ reason: 'no-profile' });
  });
});
