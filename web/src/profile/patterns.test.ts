import { describe, expect, it } from 'vitest';
import {
  averageRanks,
  calibration,
  calibrationPoints,
  detailLoadOrder,
  dropOffCurves,
  facetPatterns,
  fitRatingModel,
  kaplanMeier,
  PatternRow,
  ridgePath,
  spearman,
  startWith,
  tCritical,
  wilson,
} from './patterns';
import type { NovelDetail } from '../types';
import type { ProfileEntry } from './types';

/** Small deterministic generator so synthetic datasets are the same on every run. */
function rng(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

const detail = (id: number, overrides: Partial<NovelDetail> = {}): NovelDetail => ({
  id,
  title: `Title ${id}`,
  slug: `t-${id}`,
  novelupdates_url: '',
  associated_names: [],
  rating: 3.8,
  rating_votes: 100,
  reading_list_count: 1000,
  chapters_orig: 100,
  chapters_trans: 100,
  genres: [],
  tags: [],
  direct_recommendation_count: 0,
  related_series_count: 0,
  recommendation_list_count: 0,
  ...overrides,
});

const entry = (id: number, overrides: Partial<ProfileEntry> = {}): ProfileEntry => ({
  novel_id: id,
  slug: `t-${id}`,
  imported_title: `Title ${id}`,
  status: 'completed',
  source_file: 'f',
  ...overrides,
});

const row = (id: number, e: Partial<ProfileEntry> = {}, d: Partial<NovelDetail> = {}): PatternRow => ({
  entry: entry(id, e),
  detail: detail(id, d),
});

describe('statistics helpers', () => {
  it('gives tied values the average of the ranks they span', () => {
    expect(averageRanks([10, 20, 20, 30, 20])).toEqual([1, 3, 3, 5, 3]);
  });

  it('computes Spearman on tie-averaged ranks', () => {
    // ranks x = [1, 2.5, 2.5, 4], ranks y = [1, 3, 2, 4]  ->  rho = 4.5 / sqrt(4.5 * 5)
    const result = spearman([1, 2, 2, 3], [1, 3, 2, 4])!;
    expect(result.value).toBeCloseTo(4.5 / Math.sqrt(22.5), 6);
    expect(result.lo).toBeLessThan(result.value);
    expect(result.hi).toBeGreaterThan(result.value);
    expect(result.hi).toBeLessThanOrEqual(1);
  });

  it('is 1 for any monotone relationship and undefined for a constant column', () => {
    expect(spearman([1, 2, 3, 4, 5, 6], [1, 4, 9, 16, 25, 36])!.value).toBeCloseTo(1, 10);
    expect(spearman([1, 2, 3, 4, 5], [3, 3, 3, 3, 3])).toBeNull();
  });

  it('matches the textbook Wilson interval for 8 of 10', () => {
    const w = wilson(8, 10);
    expect(w.lo).toBeCloseTo(0.4902, 3);
    expect(w.hi).toBeCloseTo(0.9433, 3);
  });

  it('approximates the Student-t critical value', () => {
    expect(tCritical(9)).toBeCloseTo(2.262, 2);
    expect(tCritical(30)).toBeCloseTo(2.042, 2);
  });
});

describe('calibration', () => {
  const pair = (id: number, mine: number, community: number, votes = 100) =>
    row(id, { rating: mine }, { rating: community, rating_votes: votes });

  it('ignores community scores resting on fewer than 10 votes and unrated titles', () => {
    const points = calibrationPoints([pair(1, 4, 3.5, 9), pair(2, 4, 3.5, 10), row(3, {}, {})]);
    expect(points.map((p) => p.detail.id)).toEqual([2]);
  });

  it('refuses to describe fewer than 10 comparable titles', () => {
    expect(calibration(calibrationPoints(Array.from({ length: 9 }, (_, i) => pair(i + 1, 4, 3.5))))).toBeNull();
  });

  it('measures a known +0.5 star bias and ranks the biggest disagreements', () => {
    // Twelve titles you rate 0.4 or 0.6 above the community, plus one big miss each way.
    const exact = Array.from({ length: 12 }, (_, i) => pair(i + 1, 3 + (i % 3) * 0.5 + (i % 2 ? 0.4 : 0.6), 3 + (i % 3) * 0.5));
    exact.push(pair(100, 1, 4.5), pair(101, 5, 2));
    const result = calibration(calibrationPoints(exact))!;
    expect(result.n).toBe(14);
    expect(result.lower[0].detail.id).toBe(100);
    expect(result.higher[0].detail.id).toBe(101);
    // (12 * 0.5 + (-3.5) + 3) / 14
    expect(result.bias.value).toBeCloseTo(5.5 / 14, 6);
    expect(result.bias.lo).toBeLessThan(result.bias.value);
    expect(result.bias.hi).toBeGreaterThan(result.bias.value);
  });

  it('reports a perfect rank agreement when you rate exactly in the community order', () => {
    const rows = Array.from({ length: 12 }, (_, i) => pair(i + 1, 1 + i / 3, 1 + i / 4));
    const result = calibration(calibrationPoints(rows))!;
    expect(result.spearman!.value).toBeCloseTo(1, 10);
    expect(result.line!.slope).toBeCloseTo(4 / 3, 10);
  });
});

describe('facetPatterns', () => {
  // 40 outcomes: 30 completed, 10 dropped, so your baseline completion is 75%.
  const outcomeRows = (): PatternRow[] =>
    Array.from({ length: 40 }, (_, i) => row(i + 1, { status: i < 30 ? 'completed' : 'dropped' }, { tags: i >= 36 ? ['Rare'] : [], genres: ['Everything'] }));

  it('shrinks a small facet toward your baseline by n / (n + 6)', () => {
    const { completion } = facetPatterns(outcomeRows());
    const rare = completion!.negative.find((f) => f.name === 'Rare')!;
    expect(rare.n).toBe(4);
    expect(rare.raw).toBe(0);
    expect(rare.effect).toBeCloseTo((4 / 10) * (0 - 0.75), 10);
    expect(Math.abs(rare.effect)).toBeLessThan(Math.abs(rare.raw - completion!.baseline));
  });

  it('stays quiet about facets that match your baseline or have under 4 titles', () => {
    const rows = outcomeRows();
    rows[0].detail.tags = ['Tiny'];
    rows[1].detail.tags = ['Tiny'];
    rows[2].detail.tags = ['Tiny'];
    const { completion } = facetPatterns(rows);
    const names = [...completion!.positive, ...completion!.negative].map((f) => f.name);
    expect(names).not.toContain('Everything');
    expect(names).not.toContain('Tiny');
    expect(completion!.tested).toBe(2);
    expect(completion!.expectedByChance).toBeCloseTo(0.1, 10);
  });

  it('needs enough finished and dropped titles', () => {
    const { completion } = facetPatterns(outcomeRows().slice(0, 8));
    expect(completion).toBeNull();
  });

  it('separates tags you rate above and below your own average', () => {
    const rows: PatternRow[] = Array.from({ length: 40 }, (_, i) => {
      const loved = i < 10;
      const bad = i >= 30;
      return row(i + 1, { rating: loved ? 5 : bad ? 2 : 3.5 }, { tags: loved ? ['Loved'] : bad ? ['Meh'] : ['Common'] });
    });
    const { rating } = facetPatterns(rows);
    expect(rating!.positive.map((f) => f.name)).toContain('Loved');
    expect(rating!.negative.map((f) => f.name)).toContain('Meh');
    const loved = rating!.positive.find((f) => f.name === 'Loved')!;
    // raw residual is above the shrunk figure, which sums residuals over n + 4
    expect(loved.raw).toBeGreaterThan(loved.effect);
    expect(loved.effect).toBeCloseTo((loved.raw * 10) / 14, 10);
  });
});

describe('kaplanMeier', () => {
  it('handles ties between events and censored readers on a hand-worked example', () => {
    // t=1 event (5 at risk) -> 0.8; t=3 event with a reader censored at 3 still at risk (3 at risk) -> 0.8 * 2/3;
    // t=4 event with 1 at risk -> 0.
    const steps = kaplanMeier([
      { t: 1, event: true },
      { t: 2, event: false },
      { t: 3, event: true },
      { t: 3, event: false },
      { t: 4, event: true },
    ]);
    expect(steps.map((s) => s.t)).toEqual([1, 3, 4]);
    expect(steps.map((s) => s.atRisk)).toEqual([5, 3, 1]);
    expect(steps[0].survival).toBeCloseTo(0.8, 10);
    expect(steps[1].survival).toBeCloseTo((0.8 * 2) / 3, 10);
    expect(steps[2].survival).toBe(0);
    // Greenwood: var = 1/(5*4) + 1/(3*2); se = S * sqrt(var); band = S -+ 1.96 se
    const se = (0.8 * 2 / 3) * Math.sqrt(1 / 20 + 1 / 6);
    expect(steps[1].lo).toBeCloseTo(0.8 * 2 / 3 - 1.959964 * se, 6);
    expect(steps[1].hi).toBe(1);
  });
});

describe('dropOffCurves', () => {
  const dropped = (id: number, units: number, kind: ProfileEntry['media_kind'] = 'novel') =>
    entry(id, { status: 'dropped', progress_units: units, media_kind: kind });
  const finished = (id: number, units: number, kind: ProfileEntry['media_kind'] = 'novel') =>
    entry(id, { status: 'completed', progress_units: units, media_kind: kind });

  it('finds the median drop and the share dropped by then', () => {
    // Nine drops at 10..90, three readers finishing later. At 50 the risk sets are 12,11,10,9,8.
    const entries = [
      ...[10, 20, 30, 40, 50, 60, 70, 80, 90].map((u, i) => dropped(i + 1, u)),
      ...[100, 200, 300].map((u, i) => finished(i + 20, u)),
    ];
    const result = dropOffCurves(entries, new Map());
    const [curve] = result.curves;
    expect(curve.drops).toBe(9);
    expect(curve.median!.x).toBe(50);
    expect(curve.median!.share.value).toBeCloseTo(5 / 12, 10);
    expect(curve.median!.share.lo).toBeLessThan(5 / 12);
    expect(curve.median!.share.hi).toBeGreaterThan(5 / 12);
    // Only 9 titles are still at risk at chapter 40, so the drawn curve stops at chapter 30.
    expect(curve.points.map((p) => p.x)).toEqual([10, 20, 30]);
    expect(curve.cutoff).toBe(30);
  });

  it('draws nothing from fewer than 8 drops, ignoring zero-progress drops and plan-to-read', () => {
    const entries = [
      ...Array.from({ length: 7 }, (_, i) => dropped(i + 1, 10 + i)),
      dropped(50, 0),
      entry(60, { status: 'plan_to_read', progress_units: 5 }),
    ];
    const result = dropOffCurves(entries, new Map());
    expect(result.curves).toEqual([]);
    expect(result.totalDrops).toBe(7);
  });

  it('splits by format only when two formats each have 10 drops', () => {
    const both = [
      ...Array.from({ length: 10 }, (_, i) => dropped(i + 1, 10 + i)),
      ...Array.from({ length: 10 }, (_, i) => dropped(i + 100, 3 + i, 'anime')),
    ];
    expect(dropOffCurves(both, new Map()).curves.map((c) => c.kind).sort()).toEqual(['anime', 'novel']);

    const lopsided = [
      ...Array.from({ length: 12 }, (_, i) => dropped(i + 1, 10 + i)),
      ...Array.from({ length: 4 }, (_, i) => dropped(i + 100, 3 + i, 'anime')),
    ];
    const result = dropOffCurves(lopsided, new Map());
    expect(result.curves.map((c) => c.kind)).toEqual(['novel']);
    expect(result.omitted).toEqual([{ kind: 'anime', drops: 4 }]);
  });
});

describe('ridgePath', () => {
  it('recovers a known linear signal', () => {
    const rand = rng(1);
    const X = Array.from({ length: 200 }, () => [rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1]);
    const y = X.map(([a, b]) => 2 + 1.5 * a - 0.8 * b + (rand() - 0.5) * 0.1);
    const [fit] = ridgePath(X, y, [0.01]);
    expect(fit.beta[0]).toBeCloseTo(1.5, 1);
    expect(fit.beta[1]).toBeCloseTo(-0.8, 1);
    expect(Math.abs(fit.beta[2])).toBeLessThan(0.1);
    expect(fit.intercept).toBeCloseTo(2, 1);
  });

  it('shrinks coefficients toward zero as lambda grows', () => {
    const rand = rng(2);
    const X = Array.from({ length: 50 }, () => [rand(), rand()]);
    const y = X.map(([a]) => 3 * a + rand() * 0.2);
    const [weak, strong] = ridgePath(X, y, [0.01, 1000]);
    expect(Math.abs(strong.beta[0])).toBeLessThan(Math.abs(weak.beta[0]) / 10);
  });

  it('gives hat-matrix leave-one-out predictions equal to refitting without each row', () => {
    const rand = rng(3);
    const X = Array.from({ length: 14 }, () => [rand(), rand() > 0.5 ? 1 : 0, rand()]);
    const y = X.map(([a, b]) => 1 + 2 * a + b + rand() * 0.5);
    const lambda = 0.7;
    const [full] = ridgePath(X, y, [lambda]);
    for (const i of [0, 5, 13]) {
      const [without] = ridgePath(X.filter((_, k) => k !== i), y.filter((_, k) => k !== i), [lambda]);
      const refit = without.intercept + X[i].reduce((s, v, j) => s + v * without.beta[j], 0);
      expect(full.loo[i]).toBeCloseTo(refit, 8);
    }
  });
});

describe('fitRatingModel', () => {
  const tagPool = ['A', 'B', 'C', 'D', 'E', 'F'];
  const make = (n: number, seed: number, rate: (tags: string[], rand: () => number) => number): PatternRow[] => {
    const rand = rng(seed);
    return Array.from({ length: n }, (_, i) => {
      const tags = tagPool.filter(() => rand() < 0.4);
      return row(i + 1, { rating: rate(tags, rand) }, { tags, year: 2000 + Math.floor(rand() * 20), rating: 3 + rand() * 1.5 });
    });
  };
  const clip = (v: number) => Math.round(Math.min(5, Math.max(1, v)) * 2) / 2;

  it('asks for more ratings below 30 titles', () => {
    const model = fitRatingModel(make(29, 1, () => 4));
    expect(model).toEqual({ status: 'needs-data', n: 29 });
  });

  it('beats guessing your mean when ratings follow tags, and predicts in that direction', () => {
    const model = fitRatingModel(make(150, 4, (tags, rand) => clip(3 + (tags.includes('A') ? 1.5 : 0) - (tags.includes('B') ? 1 : 0) + (rand() - 0.5) * 0.8)));
    expect(model.status).toBe('better');
    if (model.status !== 'better') return;
    expect(model.gain.lo).toBeGreaterThan(0);
    expect(model.improvement).toBeGreaterThanOrEqual(0.05);
    expect(model.modelMae).toBeLessThan(model.baselineMae);
    const withA = model.predict(detail(1, { tags: ['A'], year: 2010, rating: 4 }));
    const withB = model.predict(detail(2, { tags: ['B'], year: 2010, rating: 4 }));
    expect(withA.rating - withB.rating).toBeGreaterThan(1.5);
    expect(withA.up[0].label).toBe('Tag: A');
  });

  it('does not claim to beat your average when ratings are pure noise', () => {
    for (const seed of [5, 6, 7]) {
      const model = fitRatingModel(make(120, seed, (_, rand) => clip(1 + rand() * 4)));
      expect(model.status).toBe('not-better');
    }
  });

  it('ranks only unrated plan-to-read titles, best predicted first', () => {
    const rows = make(150, 8, (tags, rand) => clip(3 + (tags.includes('A') ? 1.5 : 0) + (rand() - 0.5) * 0.6));
    const model = fitRatingModel(rows);
    if (model.status !== 'better') throw new Error('model should validate on a strong signal');
    const queue = [
      row(500, { status: 'plan_to_read', rating: undefined }, { tags: ['A'], year: 2010 }),
      row(501, { status: 'plan_to_read', rating: undefined }, { tags: ['C'], year: 2010 }),
      row(502, { status: 'plan_to_read', rating: 5 }, { tags: ['A'], year: 2010 }),
      row(503, { status: 'completed', rating: undefined }, { tags: ['A'], year: 2010 }),
    ];
    expect(startWith(model, queue, 6).map((p) => p.detail.id)).toEqual([500, 501]);
  });
});

describe('detailLoadOrder', () => {
  it('loads rated titles first, plan-to-read last, and each id once at its best rank', () => {
    const order = detailLoadOrder([
      entry(1, { status: 'plan_to_read' }),
      entry(2, { status: 'reading' }),
      entry(3, { status: 'completed' }),
      entry(4, { status: 'paused', rating: 4 }),
      entry(1, { status: 'completed', rating: 3 }),
      { ...entry(9), novel_id: undefined },
    ]);
    expect(order).toEqual([1, 4, 3, 2]);
  });
});
