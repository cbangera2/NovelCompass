import { useDeferredValue, useMemo } from 'react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  Scatter,
  ScatterChart,
  XAxis,
  YAxis,
} from 'recharts';
import type { NovelDetail } from '../types';
import { ChartConfig, ChartContainer, ChartTooltip } from '../chart';
import { browseFacetUrl } from '../metadataLinks';
import { novelPageUrl } from '../novelLinks';
import { displayNovelTitle, useDisplaySettings } from '../settings';
import {
  calibration,
  calibrationPoints,
  CalibrationPoint,
  DropCurve,
  dropOffCurves,
  FacetEffect,
  FacetFamily,
  facetPatterns,
  fitRatingModel,
  MIN_CALIBRATION,
  MIN_DROPS,
  MIN_MODEL_TITLES,
  MIN_OUTCOMES,
  MIN_RATED_FOR_FACETS,
  patternRows,
  startWith,
} from './patterns';
import type { ProfileEntry, ProfileMediaKind } from './types';

const KIND_COLORS: Record<ProfileMediaKind, string> = { novel: 'var(--chart-1)', manga: 'var(--chart-2)', anime: 'var(--chart-3)' };
const KIND_NOUNS: Record<ProfileMediaKind, string> = { novel: 'Novels', manga: 'Manga', anime: 'Anime' };
const FACET_LIST_LIMIT = 6;
const TICK = { fill: 'var(--muted)', fontSize: 11 };

const fixed = (value: number, digits = 1) => value.toFixed(digits);
const signed = (value: number, digits = 1) => {
  const text = Math.abs(value).toFixed(digits);
  return Number(text) === 0 ? text : `${value < 0 ? '−' : '+'}${text}`;
};
const pct = (value: number) => `${Math.round(value * 100)}%`;
const range = (a: string, b: string) => `${a} to ${b}`;

function agreementWord(rho: number): string {
  const size = Math.abs(rho);
  const strength = size >= 0.7 ? 'strongly' : size >= 0.4 ? 'moderately' : size >= 0.2 ? 'weakly' : 'barely';
  return rho < 0 ? `${strength} against the community` : `${strength} in line with the community`;
}

/** Clips the line y = a + b·x to the plot box so it never leaves the chart. */
function clippedSegment(line: { slope: number; intercept: number }, x0: number, x1: number, y0: number, y1: number) {
  const clip = (x: number) => {
    const y = line.intercept + line.slope * x;
    if (y > y1) return { x: (y1 - line.intercept) / line.slope, y: y1 };
    if (y < y0) return { x: (y0 - line.intercept) / line.slope, y: y0 };
    return { x, y };
  };
  return Math.abs(line.slope) < 1e-9
    ? ([{ x: x0, y: line.intercept }, { x: x1, y: line.intercept }] as const)
    : ([clip(x0), clip(x1)] as const);
}

function PatternCard({ title, lede, children }: { title: string; lede: string; children: React.ReactNode }): JSX.Element {
  return (
    <article className="analytics-card analytics-card-wide pattern-card">
      <h4>{title}</h4>
      <p>{lede}</p>
      {children}
    </article>
  );
}

/* ---------------------------------------------------------------- 1. calibration */

const calibrationConfig = {
  mine: { label: 'You', color: 'var(--chart-1)' },
  community: { label: 'Community', color: 'var(--chart-2)' },
} satisfies ChartConfig;

function Disagreements({ label, points }: { label: string; points: CalibrationPoint[] }): JSX.Element | null {
  const { settings } = useDisplaySettings();
  if (!points.length) return null;
  return (
    <div>
      <h5>{label}</h5>
      <ul className="pattern-list">
        {points.map((point) => (
          <li key={point.detail.id}>
            <a href={novelPageUrl(point.detail.id)}>
              {displayNovelTitle(point.detail.title, point.detail.associated_names, settings.titlePreference)}
            </a>
            <small>You {fixed(point.mine, point.mine % 1 ? 1 : 0)}★ · community {fixed(point.community)}★</small>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CalibrationCard({ rows }: { rows: ReturnType<typeof patternRows> }): JSX.Element {
  const points = useMemo(() => calibrationPoints(rows), [rows]);
  const result = useMemo(() => calibration(points), [points]);
  const lede = 'Your star ratings against the catalog rating, on the same 1–5 scale. Only titles with 10 or more community votes count.';
  if (!result) {
    return (
      <PatternCard title="You vs the community" lede={lede}>
        <p className="analytics-state">
          Rate {MIN_CALIBRATION - points.length} more catalog title{MIN_CALIBRATION - points.length === 1 ? '' : 's'} with 10+ community votes to compare
          ({points.length} of {MIN_CALIBRATION} so far).
        </p>
      </PatternCard>
    );
  }
  const { bias, spearman, highShare, line } = result;
  const half = (bias.hi - bias.lo) / 2;
  const headline = bias.lo > 0
    ? `You rate ${fixed(bias.value)}★ above the community on average (±${fixed(half)})`
    : bias.hi < 0
      ? `You rate ${fixed(-bias.value)}★ below the community on average (±${fixed(half)})`
      : `You rate about the same as the community on average (${signed(bias.value)}★, ±${fixed(half)})`;
  const segment = line ? clippedSegment(line, 1, 5, 0.5, 5.5) : null;
  const summary = `${headline}. ${result.n} rated titles.${spearman ? ` Rank agreement ${fixed(spearman.value, 2)}.` : ''}`;
  return (
    <PatternCard title="You vs the community" lede={lede}>
      <p className="pattern-headline">{headline}.</p>
      <div className="pattern-split">
        <div role="img" aria-label={`Scatter plot. ${summary}`}>
          <ChartContainer config={calibrationConfig} className="analytics-chart pattern-chart-scatter">
            <ScatterChart margin={{ top: 8, right: 12, bottom: 22, left: 0 }}>
              <CartesianGrid stroke="var(--chart-grid)" />
              <XAxis
                type="number"
                dataKey="community"
                name="Community"
                domain={[1, 5]}
                ticks={[1, 2, 3, 4, 5]}
                tick={TICK}
                tickLine={false}
                axisLine={false}
                label={{ value: 'Community rating', position: 'bottom', fill: 'var(--muted)', fontSize: 11 }}
              />
              <YAxis type="number" dataKey="mine" name="You" domain={[0.5, 5.5]} ticks={[1, 2, 3, 4, 5]} width={28} tick={TICK} tickLine={false} axisLine={false} />
              <ReferenceLine segment={[{ x: 1, y: 1 }, { x: 5, y: 5 }]} stroke="var(--border-strong)" strokeDasharray="4 4" />
              {segment && <ReferenceLine segment={segment} stroke="var(--chart-2)" strokeWidth={2} />}
              <ChartTooltip
                cursor={{ strokeDasharray: '3 3', stroke: 'var(--border-strong)' }}
                content={({ active, payload }) => {
                  const point = active ? (payload?.[0]?.payload as CalibrationPoint | undefined) : undefined;
                  if (!point) return null;
                  return (
                    <div className="chart-tooltip" role="status">
                      <strong>{point.detail.title}</strong>
                      <div className="chart-tooltip-row"><i style={{ background: 'var(--chart-1)' }} /><span>You</span><b>{fixed(point.mine)}★</b></div>
                      <div className="chart-tooltip-row"><i style={{ background: 'var(--chart-2)' }} /><span>Community</span><b>{fixed(point.community)}★</b></div>
                    </div>
                  );
                }}
              />
              <Scatter data={result.points} fill="var(--chart-1)" fillOpacity={0.6} stroke="var(--surface)" isAnimationActive={false} />
            </ScatterChart>
          </ChartContainer>
          <p className="pattern-legend">
            <span><i className="pattern-key-line" /> Fit through your ratings</span>
            <span><i className="pattern-key-dash" /> You agree exactly</span>
          </p>
        </div>
        <dl className="pattern-stats">
          <div>
            <dt>Rank agreement</dt>
            <dd>
              {spearman ? (
                <>
                  <strong>{fixed(spearman.value, 2)}</strong>
                  <small>95% {range(fixed(spearman.lo, 2), fixed(spearman.hi, 2))}: {agreementWord(spearman.value)}</small>
                </>
              ) : <small>Undefined: one side gives every title the same score.</small>}
            </dd>
          </div>
          <div>
            <dt>Average gap</dt>
            <dd>
              <strong>{signed(bias.value)}★</strong>
              <small>95% {range(signed(bias.lo), signed(bias.hi))}★ (yours minus community)</small>
            </dd>
          </div>
          <div>
            <dt>How spread out</dt>
            <dd>
              <strong>{fixed(result.sdMine, 2)} vs {fixed(result.sdCommunity, 2)}</strong>
              <small>Std. dev. of your ratings vs theirs. {pct(highShare.value)} of yours are 4★+ (95% {range(pct(highShare.lo), pct(highShare.hi))}) against {pct(result.communityHighShare)} of theirs.</small>
            </dd>
          </div>
        </dl>
      </div>
      <div className="pattern-columns">
        <Disagreements label="You rated higher than everyone" points={result.higher} />
        <Disagreements label="You rated lower than everyone" points={result.lower} />
      </div>
      <p className="pattern-basis">
        Reliability: {result.n} rated titles. The true average gap is likely between {signed(bias.lo)}★ and {signed(bias.hi)}★.
        Rank agreement needs roughly 30 titles before its interval narrows.
      </p>
    </PatternCard>
  );
}

/* ---------------------------------------------------------------- 2. facets */

function FacetList({ label, rows, scale, format, tone }: {
  label: string;
  rows: FacetEffect[];
  scale: number;
  format: (value: number) => string;
  tone: 'good' | 'warn';
}): JSX.Element {
  const at = (value: number) => `${50 + (Math.max(-scale, Math.min(scale, value)) / scale) * 50}%`;
  return (
    <div>
      <h5>{label}</h5>
      {rows.length ? (
        <ul className="pattern-facets">
          {rows.slice(0, FACET_LIST_LIMIT).map((facet) => (
            <li key={`${facet.kind}:${facet.name}`}>
              <span>
                <a href={browseFacetUrl(facet.kind, facet.name)} title={`Open ${facet.kind} ${facet.name} in Browse`}>{facet.name}</a>
                <small>{facet.kind} · n = {facet.n}</small>
              </span>
              <span
                className={`pattern-ci pattern-ci-${tone}`}
                role="img"
                aria-label={`95% interval ${range(format(facet.lo), format(facet.hi))}`}
              >
                <i style={{ left: at(facet.lo), width: `calc(${at(facet.hi)} - ${at(facet.lo)})` }} />
                <b style={{ left: at(facet.effect) }} />
              </span>
              <strong>{format(facet.effect)}</strong>
            </li>
          ))}
        </ul>
      ) : <p className="pattern-none">Nothing clear.</p>}
    </div>
  );
}

function FacetFamilyView({ heading, intro, family, format, labels }: {
  heading: string;
  intro: string;
  family: FacetFamily;
  format: (value: number) => string;
  labels: [string, string];
}): JSX.Element {
  const shown = [...family.positive, ...family.negative].slice(0, FACET_LIST_LIMIT * 2);
  const scale = Math.max(1e-6, ...shown.flatMap((f) => [Math.abs(f.lo), Math.abs(f.hi)]));
  return (
    <section>
      <h5 className="pattern-subhead">{heading}</h5>
      <p className="pattern-basis">{intro}</p>
      {family.shown <= family.expectedByChance * 1.5 && (
        <p className="pattern-caution">
          That is about as many as chance alone would produce, so read these as hints to check, not findings.
        </p>
      )}
      <div className="pattern-columns">
        <FacetList label={labels[0]} rows={family.positive} scale={scale} format={format} tone="good" />
        <FacetList label={labels[1]} rows={family.negative} scale={scale} format={format} tone="warn" />
      </div>
      <p className="pattern-footnote">
        {family.shown} of {family.tested} genres and tags with 4+ titles showed a clear effect (95% interval clear of zero); about{' '}
        {fixed(family.expectedByChance)} would show up by chance alone, and {family.tested - family.shown} were unclear.
        Effects are pulled toward your average, most for the facets with the fewest titles.
      </p>
    </section>
  );
}

function FacetsCard({ rows }: { rows: ReturnType<typeof patternRows> }): JSX.Element {
  const result = useMemo(() => facetPatterns(rows), [rows]);
  return (
    <PatternCard
      title="What predicts how you rate or drop"
      lede="Genres and tags that shift how often you finish a title, or how high you rate it, compared with your own averages."
    >
      {result.completion ? (
        <FacetFamilyView
          heading="Finishing vs dropping"
          intro={`You finished ${pct(result.completion.baseline)} of the ${result.outcomes} titles you finished or dropped. Bars show the shift in that rate, in percentage points.`}
          family={result.completion}
          format={(v) => `${signed(v * 100, 0)} pts`}
          labels={['You tend to finish', 'You tend to drop']}
        />
      ) : (
        <p className="analytics-state">
          Needs at least {MIN_OUTCOMES} finished or dropped titles, with 3 or more of each ({result.outcomes} so far).
        </p>
      )}
      {result.rating ? (
        <FacetFamilyView
          heading="How you rate"
          intro={`Your average across ${result.rated} rated titles is ${fixed(result.rating.mean, 2)}★. Bars show how far a facet's titles sit above or below it.`}
          family={result.rating}
          format={(v) => `${signed(v)}★`}
          labels={['You rate higher', 'You rate lower']}
        />
      ) : (
        <p className="analytics-state">
          Needs at least {MIN_RATED_FOR_FACETS} rated titles that are not all the same score ({result.rated} so far).
        </p>
      )}
    </PatternCard>
  );
}

/* ---------------------------------------------------------------- 3. drop-off */

interface CurveDatum { x: number; dropped: number; band: [number, number] }

function curveData(curve: DropCurve): CurveDatum[] {
  return [
    { x: 1, dropped: 0, band: [0, 0] },
    ...curve.points.map((p): CurveDatum => ({ x: Math.max(1, p.x), dropped: p.dropped, band: [p.lo, p.hi] })),
  ];
}

const LOG_TICKS = [1, 3, 10, 30, 100, 300, 1000, 3000, 10000];

function DropCurveView({ curve, unit }: { curve: DropCurve; unit: string }): JSX.Element {
  const data = useMemo(() => curveData(curve), [curve]);
  const xMax = Math.max(2, data[data.length - 1].x);
  const topBand = Math.max(...data.map((d) => d.band[1]));
  const yStep = [0.05, 0.1, 0.25, 0.5].find((step) => topBand / step <= 5) ?? 0.5;
  const yMax = Math.min(1, Math.max(yStep, Math.ceil(topBand / yStep) * yStep));
  const yTicks = Array.from({ length: Math.round(yMax / yStep) + 1 }, (_, i) => i * yStep);
  const config = { dropped: { label: 'Dropped by now', color: KIND_COLORS[curve.kind] } } satisfies ChartConfig;
  const { median } = curve;
  const summary = median
    ? `Half of your drops happen by ${unit} ${Math.round(median.x)}. By then about ${pct(median.share.value)} of the titles you started (95% ${range(pct(median.share.lo), pct(median.share.hi))}) had been dropped.`
    : 'No median could be estimated.';
  return (
    <div>
      <p className="pattern-headline">{summary}</p>
      <div role="img" aria-label={`Step chart of the share of titles dropped by ${unit}. ${summary} Based on ${curve.drops} drops among ${curve.titles} titles.`}>
        <ChartContainer config={config} className="analytics-chart pattern-chart-drop">
          <ComposedChart data={data} margin={{ top: 8, right: 14, bottom: 22, left: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
            <XAxis
              type="number"
              dataKey="x"
              scale="log"
              domain={[1, xMax]}
              allowDataOverflow
              ticks={LOG_TICKS.filter((t) => t <= xMax)}
              tick={TICK}
              tickLine={false}
              axisLine={false}
              label={{ value: `${unit[0].toUpperCase()}${unit.slice(1)}s read · log scale`, position: 'bottom', fill: 'var(--muted)', fontSize: 11 }}
            />
            <YAxis domain={[0, yMax]} ticks={yTicks} tickFormatter={pct} width={40} tick={TICK} tickLine={false} axisLine={false} />
            <ChartTooltip
              cursor={{ stroke: 'var(--border-strong)' }}
              content={({ active, payload }) => {
                const datum = active ? (payload?.[0]?.payload as CurveDatum | undefined) : undefined;
                if (!datum) return null;
                return (
                  <div className="chart-tooltip" role="status">
                    <strong>By {unit} {Math.round(datum.x)}</strong>
                    <div className="chart-tooltip-row">
                      <i style={{ background: KIND_COLORS[curve.kind] }} /><span>Dropped</span>
                      <b>{pct(datum.dropped)} ({pct(datum.band[0])}–{pct(datum.band[1])})</b>
                    </div>
                  </div>
                );
              }}
            />
            <Area dataKey="band" type="stepAfter" stroke="none" fill={KIND_COLORS[curve.kind]} fillOpacity={0.18} isAnimationActive={false} activeDot={false} />
            <Line dataKey="dropped" type="stepAfter" stroke={KIND_COLORS[curve.kind]} strokeWidth={2} dot={false} isAnimationActive={false} />
            {median && median.x <= xMax && <ReferenceLine x={Math.max(1, median.x)} stroke="var(--muted)" strokeDasharray="4 4" />}
          </ComposedChart>
        </ChartContainer>
      </div>
      <p className="pattern-basis">
        {curve.drops} drops among {curve.titles} titles with a recorded {unit} count. The shaded band is the 95% Greenwood interval.
        {curve.cutoff != null && ` The curve stops at ${unit} ${Math.round(curve.cutoff)}, past which fewer than 10 titles remain.`}
      </p>
    </div>
  );
}

function DropOffCard({ entries, detailById }: { entries: ProfileEntry[]; detailById: Map<number, NovelDetail> }): JSX.Element {
  const result = useMemo(() => dropOffCurves(entries, detailById), [entries, detailById]);
  return (
    <PatternCard
      title="Where you drop titles"
      lede="How far into a title you get before dropping it. Titles you finished or are still reading count as 'not dropped yet' at the progress you logged."
    >
      {result.curves.length ? (
        <div className={result.curves.length > 1 ? 'pattern-columns' : undefined}>
          {result.curves.map((curve) => (
            <div key={curve.kind}>
              {result.curves.length > 1 && <h5>{KIND_NOUNS[curve.kind]}</h5>}
              <DropCurveView curve={curve} unit={curve.kind === 'anime' ? 'episode' : 'chapter'} />
            </div>
          ))}
        </div>
      ) : (
        <p className="analytics-state">
          Needs at least {MIN_DROPS} dropped titles with a recorded chapter or episode count; you have {result.totalDrops}.
        </p>
      )}
      {result.omitted.length > 0 && result.curves.length > 0 && (
        <p className="pattern-footnote">
          Left out because there are too few drops to draw: {result.omitted.map((o) => `${KIND_NOUNS[o.kind]} (${o.drops})`).join(', ')}.
        </p>
      )}
      {result.curves.length > 0 && (
        <p className="pattern-footnote">
          Finishing a title is treated as 'could still have dropped it later', so the share dropped by the right-hand end is the least certain part.
        </p>
      )}
    </PatternCard>
  );
}

/* ---------------------------------------------------------------- 4. predicted ratings */

function ModelCard({ rows }: { rows: ReturnType<typeof patternRows> }): JSX.Element {
  const { settings } = useDisplaySettings();
  const model = useMemo(() => fitRatingModel(rows), [rows]);
  const picks = useMemo(() => (model.status === 'better' ? startWith(model, rows) : []), [model, rows]);
  const lede = 'Learns from your ratings which genres, tags, release years and community scores go with a higher rating, then tests itself on titles it has not seen.';
  return (
    <PatternCard title="Start with these" lede={lede}>
      {model.status === 'needs-data' && (
        <p className="analytics-state">
          Needs {MIN_MODEL_TITLES} rated catalog titles to learn from and test on ({model.n} so far).
        </p>
      )}
      {model.status === 'not-better' && (
        <>
          <p className="pattern-headline">Not better than guessing your average yet. Rate more titles.</p>
          <p className="pattern-basis">
            Tested by leaving each of {model.n} rated titles out in turn: the model misses by {fixed(model.modelMae, 2)}★ on typical, against
            {' '}{fixed(model.baselineMae, 2)}★ for always guessing your mean. Its gain is {signed(model.gain.value, 2)}★ per title
            (95% {range(signed(model.gain.lo, 2), signed(model.gain.hi, 2))}), which is not a clear improvement (it has to be above zero
            with 95% confidence and at least 5%), so no predictions are shown.
          </p>
        </>
      )}
      {model.status === 'better' && (
        <>
          <p className="pattern-headline">
            Predictions miss by {fixed(model.modelMae, 2)}★ on typical, against {fixed(model.baselineMae, 2)}★ for guessing your average.
          </p>
          <p className="pattern-basis">
            Tested by leaving each of {model.n} rated titles out in turn: {pct(model.improvement)} smaller error, {signed(model.gain.value, 2)}★ per
            title (95% {range(signed(model.gain.lo, 2), signed(model.gain.hi, 2))}). The setting was chosen on the same test, so the true gain is
            probably a little lower.
          </p>
          {picks.length > 0 ? (
            <ol className="pattern-picks">
              {picks.map(({ detail, prediction }) => (
                <li key={detail.id}>
                  <a href={novelPageUrl(detail.id)} aria-describedby={`pick-why-${detail.id}`}>
                    <strong>{displayNovelTitle(detail.title, detail.associated_names, settings.titlePreference)}</strong>
                    <span>
                      <b>≈ {fixed(prediction.rating)}★</b> <small>±{fixed(model.modelMae)} typical error</small>
                    </span>
                  </a>
                  <span className="pattern-why" id={`pick-why-${detail.id}`} role="tooltip">
                    {prediction.up.length > 0 && <>Pushes up: {prediction.up.map((c) => `${c.label} (${signed(c.stars, 2)})`).join(', ')}. </>}
                    {prediction.down.length > 0 && <>Pulls down: {prediction.down.map((c) => `${c.label} (${signed(c.stars, 2)})`).join(', ')}.</>}
                  </span>
                </li>
              ))}
            </ol>
          ) : <p className="analytics-state">No unrated plan-to-read titles with catalog details to score.</p>}
        </>
      )}
    </PatternCard>
  );
}

/* ---------------------------------------------------------------- section */

export default function ProfilePatterns({ entries, detailById, matchedTotal, loading }: {
  entries: ProfileEntry[];
  detailById: Map<number, NovelDetail>;
  /** Every catalog-matched title in scope, including those whose details were not loaded. */
  matchedTotal: number;
  loading: boolean;
}): JSX.Element {
  // Deferred so React can slice the chart and model work instead of blocking the tab switch.
  const settledDetails = useDeferredValue(detailById);
  const rows = useMemo(() => patternRows(entries, settledDetails), [entries, settledDetails]);
  return (
    <section className="profile-patterns" aria-labelledby="profile-patterns-title">
      <h3 id="profile-patterns-title">Your patterns</h3>
      <p className="analytics-coverage">
        How your library relates to the catalog. Every result shows how many titles it rests on and a 95% interval; where the data is too thin it says so instead of guessing.
        {' '}Based on {rows.length.toLocaleString()} of {matchedTotal.toLocaleString()} catalog-matched titles
        {rows.length < matchedTotal ? ' (rated and finished titles are loaded first)' : ''}.
      </p>
      {(loading || settledDetails !== detailById) && !rows.length ? (
        <p className="analytics-state" aria-live="polite">Loading catalog details for your titles…</p>
      ) : rows.length ? (
        <div className="pattern-stack">
          <CalibrationCard rows={rows} />
          <FacetsCard rows={rows} />
          <DropOffCard entries={entries} detailById={settledDetails} />
          <ModelCard rows={rows} />
        </div>
      ) : (
        <p className="analytics-state">Patterns need titles matched to the catalog, with ratings or finished and dropped statuses.</p>
      )}
    </section>
  );
}
