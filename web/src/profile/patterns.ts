/**
 * "Your patterns": statistics relating a local library to the catalog.
 * Every function is pure, returns the numbers needed to judge how much to trust it (n and an
 * interval), and refuses to answer below a minimum sample instead of returning noise.
 */
import type { NovelDetail } from '../types';
import { inferMediaKind, mean, progressUnits, stdDev } from './profileStats';
import type { ProfileEntry, ProfileMediaKind } from './types';

export const MIN_COMMUNITY_VOTES = 10;
export const MIN_CALIBRATION = 10;
export const MIN_FACET_TITLES = 4;
export const MIN_OUTCOMES = 12;
export const MIN_RATED_FOR_FACETS = 12;
export const MIN_DROPS = 8;
export const MIN_DROPS_PER_SPLIT = 10;
/** The drawn curve stops once fewer titles than this remain at risk; beyond that one drop swings it wildly. */
const MIN_AT_RISK = 10;
export const MIN_MODEL_TITLES = 30;
export const MODEL_FEATURE_LIMIT = 60;
const MODEL_MIN_SUPPORT = 3;
/** Smallest relative drop in leave-one-out error that counts as "better than guessing". */
const MODEL_MIN_IMPROVEMENT = 0.05;
/** Pseudo-counts that pull small-sample facet effects toward your baseline. */
const COMPLETION_PRIOR = 6;
const RATING_PRIOR = 4;
const Z95 = 1.959964;

export interface Interval {
  value: number;
  lo: number;
  hi: number;
}

export interface PatternRow {
  entry: ProfileEntry;
  detail: NovelDetail;
}

const isRated = (entry: ProfileEntry): entry is ProfileEntry & { rating: number } =>
  entry.rating != null && entry.rating > 0;

/** Library entries that have a loaded catalog record, one per title. */
export function patternRows(entries: ProfileEntry[], detailById: Map<number, NovelDetail>): PatternRow[] {
  const seen = new Set<number>();
  const rows: PatternRow[] = [];
  for (const entry of entries) {
    const detail = entry.novel_id != null ? detailById.get(entry.novel_id) : undefined;
    if (!detail || seen.has(detail.id)) continue;
    seen.add(detail.id);
    rows.push({ entry, detail });
  }
  return rows;
}

/**
 * Catalog ids in the order their details are worth loading when a big library has to be capped:
 * rated titles first, then finished/dropped, then in-progress, then plan-to-read.
 */
export function detailLoadOrder(entries: ProfileEntry[]): number[] {
  const rank = (entry: ProfileEntry): number => {
    if (isRated(entry)) return 0;
    if (entry.status === 'completed' || entry.status === 'dropped') return 1;
    return entry.status === 'plan_to_read' ? 3 : 2;
  };
  const best = new Map<number, number>();
  for (const entry of entries) {
    if (entry.novel_id == null) continue;
    best.set(entry.novel_id, Math.min(best.get(entry.novel_id) ?? 3, rank(entry)));
  }
  // Array.prototype.sort is stable, so ties keep library order.
  return [...best.keys()].sort((a, b) => best.get(a)! - best.get(b)!);
}

/* ---------------------------------------------------------------- statistics helpers */

/** Two-sided 95% Student-t critical value (Cornish–Fisher expansion; within 0.1% for df >= 5). */
export function tCritical(df: number): number {
  if (df <= 0) return Infinity;
  const z = Z95;
  const z3 = z ** 3;
  const z5 = z ** 5;
  return z + (z3 + z) / (4 * df) + (5 * z5 + 16 * z3 + 3 * z) / (96 * df * df);
}

export function meanInterval(values: number[]): Interval {
  const n = values.length;
  const value = mean(values);
  if (n < 2) return { value, lo: value, hi: value };
  const half = tCritical(n - 1) * stdDev(values) / Math.sqrt(n);
  return { value, lo: value - half, hi: value + half };
}

export function wilson(successes: number, n: number): Interval {
  if (n === 0) return { value: 0, lo: 0, hi: 1 };
  const p = successes / n;
  const z2 = Z95 ** 2;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const half = (Z95 * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return { value: p, lo: Math.max(0, centre - half), hi: Math.min(1, centre + half) };
}

/** Ranks starting at 1, tied values sharing the average of the ranks they span. */
export function averageRanks(values: number[]): number[] {
  const order = values.map((_, i) => i).sort((a, b) => values[a] - values[b]);
  const ranks = new Array<number>(values.length);
  for (let start = 0; start < order.length;) {
    let end = start;
    while (end + 1 < order.length && values[order[end + 1]] === values[order[start]]) end++;
    const rank = (start + end) / 2 + 1;
    for (let k = start; k <= end; k++) ranks[order[k]] = rank;
    start = end + 1;
  }
  return ranks;
}

function pearson(x: number[], y: number[]): number | null {
  const mx = mean(x);
  const my = mean(y);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < x.length; i++) {
    sxy += (x[i] - mx) * (y[i] - my);
    sxx += (x[i] - mx) ** 2;
    syy += (y[i] - my) ** 2;
  }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : null;
}

/** Spearman rank correlation with a Bonett–Wright 95% interval; null when either side is constant. */
export function spearman(x: number[], y: number[]): Interval | null {
  const n = x.length;
  if (n < 4) return null;
  const rho = pearson(averageRanks(x), averageRanks(y));
  if (rho == null) return null;
  const clamped = Math.max(-0.999999, Math.min(0.999999, rho));
  const se = Math.sqrt((1 + (clamped * clamped) / 2) / (n - 3));
  const z = Math.atanh(clamped);
  return { value: rho, lo: Math.tanh(z - Z95 * se), hi: Math.tanh(z + Z95 * se) };
}

/** Least-squares line y = intercept + slope * x. */
export function olsLine(x: number[], y: number[]): { slope: number; intercept: number } | null {
  const mx = mean(x);
  const my = mean(y);
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < x.length; i++) {
    sxy += (x[i] - mx) * (y[i] - my);
    sxx += (x[i] - mx) ** 2;
  }
  if (sxx === 0) return null;
  const slope = sxy / sxx;
  return { slope, intercept: my - slope * mx };
}

/* ---------------------------------------------------------------- 1. rating calibration */

export interface CalibrationPoint {
  detail: NovelDetail;
  mine: number;
  community: number;
  /** mine − community. */
  diff: number;
}

export interface Calibration {
  n: number;
  points: CalibrationPoint[];
  spearman: Interval | null;
  /** Mean of (yours − community), in stars. */
  bias: Interval;
  line: { slope: number; intercept: number } | null;
  sdMine: number;
  sdCommunity: number;
  /** Share of your ratings at 4★ or above, and the same share among the community scores of those titles. */
  highShare: Interval;
  communityHighShare: number;
  higher: CalibrationPoint[];
  lower: CalibrationPoint[];
}

/** Rated titles whose community rating rests on enough votes to compare against. */
export function calibrationPoints(rows: PatternRow[]): CalibrationPoint[] {
  return rows.flatMap(({ entry, detail }) =>
    isRated(entry) && detail.rating_votes >= MIN_COMMUNITY_VOTES && detail.rating > 0
      ? [{ detail, mine: entry.rating, community: detail.rating, diff: entry.rating - detail.rating }]
      : []);
}

export function calibration(points: CalibrationPoint[], extremes = 5): Calibration | null {
  const n = points.length;
  if (n < MIN_CALIBRATION) return null;
  const mine = points.map((p) => p.mine);
  const community = points.map((p) => p.community);
  const byDiff = [...points].sort((a, b) => b.diff - a.diff);
  return {
    n,
    points,
    spearman: spearman(community, mine),
    bias: meanInterval(points.map((p) => p.diff)),
    line: olsLine(community, mine),
    sdMine: stdDev(mine),
    sdCommunity: stdDev(community),
    highShare: wilson(mine.filter((v) => v >= 4).length, n),
    communityHighShare: community.filter((v) => v >= 4).length / n,
    higher: byDiff.filter((p) => p.diff > 0).slice(0, extremes),
    lower: byDiff.filter((p) => p.diff < 0).reverse().slice(0, extremes),
  };
}

/* ---------------------------------------------------------------- 2. what predicts finishing and rating */

export interface FacetEffect {
  kind: 'genre' | 'tag';
  name: string;
  n: number;
  /** Shrunk effect: completion-rate points (0–1 scale) or stars of rating residual. */
  effect: number;
  lo: number;
  hi: number;
  /** The unshrunk figure: raw completion rate, or raw mean residual. */
  raw: number;
}

export interface FacetFamily {
  /** Facets with enough titles to be tested. */
  tested: number;
  /** Facets whose interval excludes zero; `positive` and `negative` hold all of them. */
  shown: number;
  /** Facets that would clear the bar by chance alone at 95%. */
  expectedByChance: number;
  positive: FacetEffect[];
  negative: FacetEffect[];
}

export interface FacetPatterns {
  outcomes: number;
  rated: number;
  completion: (FacetFamily & { baseline: number }) | null;
  rating: (FacetFamily & { mean: number; sd: number }) | null;
}

function groupByFacet<T extends { detail: NovelDetail }>(items: T[]): Map<string, { kind: 'genre' | 'tag'; name: string; items: T[] }> {
  const groups = new Map<string, { kind: 'genre' | 'tag'; name: string; items: T[] }>();
  const add = (kind: 'genre' | 'tag', name: string, item: T) => {
    const key = `${kind}:${name}`;
    const group = groups.get(key);
    if (group) group.items.push(item);
    else groups.set(key, { kind, name, items: [item] });
  };
  for (const item of items) {
    for (const name of new Set(item.detail.genres)) add('genre', name, item);
    for (const name of new Set(item.detail.tags)) add('tag', name, item);
  }
  return groups;
}

function family(effects: Array<FacetEffect | null>, tested: number): FacetFamily {
  const cleared = effects.filter((e): e is FacetEffect => e != null);
  const strongest = (a: FacetEffect, b: FacetEffect) =>
    Math.abs(b.effect) - Math.abs(a.effect) || b.n - a.n || a.name.localeCompare(b.name);
  return {
    tested,
    shown: cleared.length,
    expectedByChance: tested * 0.05,
    positive: cleared.filter((e) => e.lo > 0).sort(strongest),
    negative: cleared.filter((e) => e.hi < 0).sort(strongest),
  };
}

export function facetPatterns(rows: PatternRow[]): FacetPatterns {
  const outcomeRows = rows.filter(({ entry }) => entry.status === 'completed' || entry.status === 'dropped');
  const completedCount = outcomeRows.filter(({ entry }) => entry.status === 'completed').length;
  const ratedRows = rows.filter(({ entry }) => isRated(entry));
  const ratings = ratedRows.map(({ entry }) => entry.rating!);
  const result: FacetPatterns = { outcomes: outcomeRows.length, rated: ratedRows.length, completion: null, rating: null };

  if (outcomeRows.length >= MIN_OUTCOMES && completedCount >= 3 && outcomeRows.length - completedCount >= 3) {
    const baseline = completedCount / outcomeRows.length;
    let tested = 0;
    const effects = [...groupByFacet(outcomeRows).values()].map((group): FacetEffect | null => {
      const n = group.items.length;
      if (n < MIN_FACET_TITLES) return null;
      tested++;
      const { value: rate, lo, hi } = wilson(group.items.filter(({ entry }) => entry.status === 'completed').length, n);
      const w = n / (n + COMPLETION_PRIOR);
      const effect = { kind: group.kind, name: group.name, n, raw: rate, effect: w * (rate - baseline), lo: w * (lo - baseline), hi: w * (hi - baseline) };
      return effect.lo > 0 || effect.hi < 0 ? effect : null;
    });
    result.completion = { ...family(effects, tested), baseline };
  }

  const sd = stdDev(ratings);
  if (ratedRows.length >= MIN_RATED_FOR_FACETS && sd > 0) {
    const overall = mean(ratings);
    let tested = 0;
    const effects = [...groupByFacet(ratedRows).values()].map((group): FacetEffect | null => {
      const m = group.items.length;
      if (m < MIN_FACET_TITLES) return null;
      tested++;
      const residual = group.items.reduce((sum, { entry }) => sum + (entry.rating! - overall), 0);
      const effect = residual / (m + RATING_PRIOR);
      const half = (Z95 * sd / Math.sqrt(m)) * (m / (m + RATING_PRIOR));
      const found = { kind: group.kind, name: group.name, n: m, raw: residual / m, effect, lo: effect - half, hi: effect + half };
      return found.lo > 0 || found.hi < 0 ? found : null;
    });
    result.rating = { ...family(effects, tested), mean: overall, sd };
  }
  return result;
}

/* ---------------------------------------------------------------- 3. drop-off curve */

export interface KaplanMeierStep {
  /** Progress at which at least one event happened. */
  t: number;
  /** Probability of still being on the title past `t`. */
  survival: number;
  /** Greenwood 95% band on `survival`. */
  lo: number;
  hi: number;
  atRisk: number;
  events: number;
}

/** Kaplan–Meier estimate; observations censored at the same time as an event stay at risk for it. */
export function kaplanMeier(observations: Array<{ t: number; event: boolean }>): KaplanMeierStep[] {
  const sorted = [...observations].sort((a, b) => a.t - b.t);
  const steps: KaplanMeierStep[] = [];
  let survival = 1;
  let greenwood = 0;
  let atRisk = sorted.length;
  for (let i = 0; i < sorted.length;) {
    const t = sorted[i].t;
    let events = 0;
    let leaving = 0;
    while (i < sorted.length && sorted[i].t === t) {
      if (sorted[i].event) events++;
      leaving++;
      i++;
    }
    if (events > 0) {
      survival *= 1 - events / atRisk;
      if (atRisk > events) greenwood += events / (atRisk * (atRisk - events));
      const half = Z95 * survival * Math.sqrt(greenwood);
      steps.push({ t, survival, lo: Math.max(0, survival - half), hi: Math.min(1, survival + half), atRisk, events });
    }
    atRisk -= leaving;
  }
  return steps;
}

export interface DropCurvePoint {
  /** Progress (chapters or episodes). */
  x: number;
  /** Share of titles dropped by this progress, with its Greenwood band. */
  dropped: number;
  lo: number;
  hi: number;
}

export interface DropCurve {
  kind: ProfileMediaKind;
  /** Titles that contribute (dropped plus everything started and not dropped). */
  titles: number;
  drops: number;
  points: DropCurvePoint[];
  /** Progress past which the curve is not drawn because too few titles remain; null if all of it is shown. */
  cutoff: number | null;
  /** Progress by which half of the drops had happened, and the share of all titles dropped by then. */
  median: { x: number; share: Interval } | null;
}

export interface DropOff {
  /** Dropped titles with a usable progress count, all formats. */
  totalDrops: number;
  curves: DropCurve[];
  /** Formats left out because they had too few drops to draw alongside the others. */
  omitted: Array<{ kind: ProfileMediaKind; drops: number }>;
}

export function dropOffCurves(entries: ProfileEntry[], detailById: Map<number, NovelDetail>): DropOff {
  const byKind = new Map<ProfileMediaKind, Array<{ t: number; event: boolean }>>();
  for (const entry of entries) {
    if (entry.status === 'plan_to_read') continue;
    const t = progressUnits(entry);
    // Zero progress means "not recorded" for most imports, so it carries no timing information.
    if (t <= 0) continue;
    const kind = inferMediaKind(entry, entry.novel_id != null ? detailById.get(entry.novel_id) : undefined);
    const list = byKind.get(kind) ?? [];
    list.push({ t, event: entry.status === 'dropped' });
    byKind.set(kind, list);
  }
  const dropsOf = (list: Array<{ event: boolean }>) => list.filter((o) => o.event).length;
  const kinds = [...byKind.entries()]
    .map(([kind, list]) => ({ kind, list, drops: dropsOf(list) }))
    .filter((k) => k.drops > 0)
    .sort((a, b) => b.drops - a.drops);
  const totalDrops = kinds.reduce((sum, k) => sum + k.drops, 0);
  const split = kinds.filter((k) => k.drops >= MIN_DROPS_PER_SPLIT);
  const drawn = split.length >= 2 ? split : kinds.slice(0, 1).filter((k) => k.drops >= MIN_DROPS);
  const curves = drawn.flatMap(({ kind, list, drops }): DropCurve[] => {
    const steps = kaplanMeier(list);
    const eventTimes = list.filter((o) => o.event).map((o) => o.t).sort((a, b) => a - b);
    const x = eventTimes[Math.ceil(eventTimes.length / 2) - 1];
    const at = [...steps].reverse().find((s) => s.t <= x);
    const reliable = steps.filter((s) => s.atRisk >= Math.min(MIN_AT_RISK, list.length));
    // Early readers who never dropped can leave every event step with too few titles at risk.
    if (!reliable.length) return [];
    return [{
      kind,
      titles: list.length,
      drops,
      cutoff: reliable.length < steps.length ? reliable[reliable.length - 1].t : null,
      points: reliable.map((s) => ({ x: s.t, dropped: 1 - s.survival, lo: 1 - s.hi, hi: 1 - s.lo })),
      median: at ? { x, share: { value: 1 - at.survival, lo: 1 - at.hi, hi: 1 - at.lo } } : null,
    }];
  });
  const omitted = kinds.filter((k) => !curves.some((c) => c.kind === k.kind)).map(({ kind, drops }) => ({ kind, drops }));
  return { totalDrops, curves, omitted };
}

/* ---------------------------------------------------------------- 4. predicted-rating model */

export interface RidgeFit {
  lambda: number;
  intercept: number;
  beta: number[];
  /** Leave-one-out prediction for every training row (exact, via the hat matrix). */
  loo: number[];
}

/** In-place Cholesky factorisation of a symmetric positive-definite p×p matrix; false if it is not. */
function cholesky(a: Float64Array, p: number): boolean {
  for (let j = 0; j < p; j++) {
    let d = a[j * p + j];
    for (let k = 0; k < j; k++) d -= a[j * p + k] ** 2;
    if (!(d > 1e-12)) return false;
    const diag = Math.sqrt(d);
    a[j * p + j] = diag;
    for (let i = j + 1; i < p; i++) {
      let s = a[i * p + j];
      for (let k = 0; k < j; k++) s -= a[i * p + k] * a[j * p + k];
      a[i * p + j] = s / diag;
    }
  }
  return true;
}

/** Solves L z = b in place for the lower triangle left by `cholesky`. */
function forwardSolve(l: Float64Array, p: number, b: Float64Array): void {
  for (let i = 0; i < p; i++) {
    let s = b[i];
    for (let k = 0; k < i; k++) s -= l[i * p + k] * b[k];
    b[i] = s / l[i * p + i];
  }
}

function backSolve(l: Float64Array, p: number, b: Float64Array): void {
  for (let i = p - 1; i >= 0; i--) {
    let s = b[i];
    for (let k = i + 1; k < p; k++) s -= l[k * p + i] * b[k];
    b[i] = s / l[i * p + i];
  }
}

/**
 * Ridge regression with an unpenalised intercept, fit once per lambda from shared cross-products.
 * Leave-one-out predictions come from the hat matrix, h_ii = 1/n + (xᵢ−x̄)ᵀ(X̃ᵀX̃ + λI)⁻¹(xᵢ−x̄), so they
 * equal refitting without each row but cost a single fit. Most columns are 0/1 tag flags, so rows are
 * handled through their non-zero entries and the inverse is formed once per lambda.
 */
export function ridgePath(X: number[][], y: number[], lambdas: number[]): RidgeFit[] {
  const n = y.length;
  const p = n ? X[0].length : 0;
  const meanX = new Float64Array(p);
  for (const row of X) for (let j = 0; j < p; j++) meanX[j] += row[j] / n;
  const meanY = mean(y);
  const nonZero = X.map((row) => row.flatMap((v, j) => (v === 0 ? [] : [j])));
  // Centred cross-products: XᵀX − n·x̄x̄ᵀ and Xᵀ(y − ȳ), accumulated over non-zeros only.
  const gram = new Float64Array(p * p);
  const xty = new Float64Array(p);
  X.forEach((row, i) => {
    for (const a of nonZero[i]) {
      xty[a] += row[a] * (y[i] - meanY);
      for (const b of nonZero[i]) if (b <= a) gram[a * p + b] += row[a] * row[b];
    }
  });
  for (let a = 0; a < p; a++) for (let b = 0; b <= a; b++) gram[a * p + b] -= n * meanX[a] * meanX[b];

  return lambdas.map((lambda) => {
    const l = Float64Array.from(gram);
    for (let j = 0; j < p; j++) l[j * p + j] += lambda;
    if (!cholesky(l, p)) throw new Error('ridge system is not positive definite');
    const beta = Float64Array.from(xty);
    forwardSolve(l, p, beta);
    backSolve(l, p, beta);
    let intercept = meanY;
    for (let j = 0; j < p; j++) intercept -= meanX[j] * beta[j];

    const inverse = new Float64Array(p * p);
    for (let c = 0; c < p; c++) {
      const column = new Float64Array(p);
      column[c] = 1;
      forwardSolve(l, p, column);
      backSolve(l, p, column);
      inverse.set(column, c * p);
    }
    const inverseMean = new Float64Array(p);
    for (let a = 0; a < p; a++) for (let b = 0; b < p; b++) inverseMean[a] += inverse[a * p + b] * meanX[b];
    let meanQuad = 0;
    for (let a = 0; a < p; a++) meanQuad += meanX[a] * inverseMean[a];

    const loo = X.map((row, i) => {
      let quad = 0;
      let cross = 0;
      let fitted = intercept;
      for (const a of nonZero[i]) {
        cross += row[a] * inverseMean[a];
        fitted += row[a] * beta[a];
        for (const b of nonZero[i]) quad += row[a] * row[b] * inverse[a * p + b];
      }
      const h = 1 / n + quad - 2 * cross + meanQuad;
      return y[i] - (y[i] - fitted) / (1 - h);
    });
    return { lambda, intercept, beta: Array.from(beta), loo };
  });
}

export interface ModelContribution {
  label: string;
  /** Stars this feature adds to (or removes from) the prediction relative to an average title. */
  stars: number;
}

export interface Prediction {
  rating: number;
  up: ModelContribution[];
  down: ModelContribution[];
}

export interface ModelEvidence {
  n: number;
  /** Typical error (mean absolute, leave-one-out) of the model and of always guessing your mean. */
  modelMae: number;
  baselineMae: number;
  /** Mean per-title error reduction versus guessing your mean, in stars, with its 95% interval. */
  gain: Interval;
  /** gain / baselineMae. */
  improvement: number;
}

export type RatingModel =
  | { status: 'needs-data'; n: number }
  | ({ status: 'not-better' } & ModelEvidence)
  | ({ status: 'better'; predict: (detail: NovelDetail) => Prediction } & ModelEvidence);

// Nearly unregularised up to heavy shrinkage; the ninth point, "ignore every feature", is the
// always-guess-your-mean baseline, which is what every fit is compared against.
const LAMBDAS = Array.from({ length: 8 }, (_, k) => 0.1 * 4 ** k);

const clampStars = (v: number) => Math.min(5, Math.max(1, v));

interface ModelFeature {
  label: string;
  value: (detail: NovelDetail) => number;
  /** Binary features only explain a title that has them. */
  binary: boolean;
}

function standardizer(values: number[]): { mean: number; sd: number } | null {
  if (values.length < MIN_COMMUNITY_VOTES) return null;
  const sd = stdDev(values);
  return sd > 1e-9 ? { mean: mean(values), sd } : null;
}

export function fitRatingModel(rows: PatternRow[]): RatingModel {
  const train = rows.filter(({ entry }) => isRated(entry));
  const n = train.length;
  if (n < MIN_MODEL_TITLES) return { status: 'needs-data', n };

  const support = new Map<string, { label: string; kind: 'genre' | 'tag'; name: string; count: number }>();
  for (const { detail } of train) {
    for (const [kind, names] of [['genre', detail.genres], ['tag', detail.tags]] as const) {
      for (const name of new Set(names)) {
        const key = `${kind}:${name}`;
        const found = support.get(key);
        if (found) found.count++;
        else support.set(key, { label: `${kind === 'genre' ? 'Genre' : 'Tag'}: ${name}`, kind, name, count: 1 });
      }
    }
  }
  const features: ModelFeature[] = [...support.values()]
    .filter((s) => s.count >= MODEL_MIN_SUPPORT)
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, MODEL_FEATURE_LIMIT)
    .map((s) => ({
      label: s.label,
      binary: true,
      value: (detail) => ((s.kind === 'genre' ? detail.genres : detail.tags).includes(s.name) ? 1 : 0),
    }));

  // Missing values sit at the training mean (0 after standardising) so they neither help nor hurt.
  const year = standardizer(train.flatMap(({ detail }) => (detail.year ? [detail.year] : [])));
  if (year) features.push({ label: 'Release year', binary: false, value: (d) => (d.year ? (d.year - year.mean) / year.sd : 0) });
  const votedRating = (d: NovelDetail) => (d.rating_votes >= MIN_COMMUNITY_VOTES && d.rating > 0 ? d.rating : null);
  const community = standardizer(train.flatMap(({ detail }) => { const r = votedRating(detail); return r == null ? [] : [r]; }));
  if (community) {
    features.push({
      label: 'Community rating',
      binary: false,
      value: (d) => { const r = votedRating(d); return r == null ? 0 : (r - community.mean) / community.sd; },
    });
  }

  const y = train.map(({ entry }) => entry.rating!);
  const total = y.reduce((s, v) => s + v, 0);
  const baselineErr = y.map((v) => Math.abs(v - (total - v) / (n - 1)));
  const baselineMae = mean(baselineErr);
  const fits = ridgePath(train.map(({ detail }) => features.map((f) => f.value(detail))), y, LAMBDAS);
  const scored = fits.map((fit) => {
    const err = fit.loo.map((p, i) => Math.abs(y[i] - clampStars(p)));
    return { fit, err, mae: mean(err) };
  });
  const best = scored.reduce((a, b) => (b.mae < a.mae ? b : a));
  const gains = baselineErr.map((e, i) => e - best.err[i]);
  const gain = meanInterval(gains);
  const evidence: ModelEvidence = {
    n,
    modelMae: best.mae,
    baselineMae,
    gain,
    improvement: baselineMae > 0 ? gain.value / baselineMae : 0,
  };
  if (!(gain.lo > 0 && evidence.improvement >= MODEL_MIN_IMPROVEMENT)) return { status: 'not-better', ...evidence };

  const trainMeans = features.map((f) => mean(train.map(({ detail }) => f.value(detail))));
  const { intercept, beta } = best.fit;
  return {
    status: 'better',
    ...evidence,
    predict: (detail) => {
      const values = features.map((f) => f.value(detail));
      const rating = clampStars(intercept + values.reduce((s, v, j) => s + v * beta[j], 0));
      const parts = features.flatMap((f, j) =>
        f.binary && values[j] === 0
          ? []
          : [{ label: f.label, stars: beta[j] * (values[j] - trainMeans[j]) }]);
      return {
        rating,
        up: parts.filter((c) => c.stars > 0.005).sort((a, b) => b.stars - a.stars).slice(0, 3),
        down: parts.filter((c) => c.stars < -0.005).sort((a, b) => a.stars - b.stars).slice(0, 3),
      };
    },
  };
}

export interface StartWithPick {
  detail: NovelDetail;
  prediction: Prediction;
}

/** Highest-predicted plan-to-read titles. Only call with a model that passed validation. */
export function startWith(
  model: Extract<RatingModel, { status: 'better' }>,
  rows: PatternRow[],
  limit = 6,
): StartWithPick[] {
  return rows
    .filter(({ entry }) => entry.status === 'plan_to_read' && !isRated(entry))
    .map(({ detail }) => ({ detail, prediction: model.predict(detail) }))
    .sort((a, b) => b.prediction.rating - a.prediction.rating || b.detail.rating - a.detail.rating)
    .slice(0, limit);
}
