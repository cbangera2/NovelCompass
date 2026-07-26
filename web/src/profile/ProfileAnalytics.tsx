import { useEffect, useId, useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  Scatter,
  ScatterChart,
  XAxis,
  YAxis,
} from 'recharts';
import { NovelDetail } from '../types';
import { RecommendationDataSource } from '../data';
import { LocalUserProfile, ProfileMediaKind } from './types';
import { novelPageUrl } from '../novelLinks';
import { ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from '../chart';
import {
  activityByMonth,
  countByStatus,
  filterEntriesByScope,
  genreBreakdown,
  languageBreakdown,
  mediaKindBreakdown,
  overviewKpis,
  profileHasDates,
  releaseYearDistribution,
  scoreDistribution,
  STATUS_LABELS,
  StatsScope,
} from './profileStats';

/** Load more matched details than before, but stay responsive for large NU libraries. */
const DETAIL_LIMIT = 250;
const DETAIL_CONCURRENCY = 10;

const STATUS_COLORS: Record<string, string> = {
  reading: 'var(--chart-1)',
  completed: 'var(--chart-2)',
  plan_to_read: 'var(--chart-3)',
  paused: '#38bdf8',
  dropped: 'var(--red)',
};

const scoreChartConfig = {
  count: { label: 'Titles', color: 'var(--chart-1)' },
} satisfies ChartConfig;

const activityChartConfig = {
  started: { label: 'Started', color: 'var(--chart-1)' },
  finished: { label: 'Finished', color: 'var(--chart-2)' },
} satisfies ChartConfig;

const yearChartConfig = {
  count: { label: 'Titles', color: 'var(--chart-2)' },
} satisfies ChartConfig;

const genreChartConfig = {
  count: { label: 'Count', color: 'var(--chart-1)' },
} satisfies ChartConfig;

const languageChartConfig = {
  count: { label: 'Titles', color: 'var(--chart-2)' },
} satisfies ChartConfig;

const cohortChartConfig = {
  readerScale: { label: 'List count', color: 'var(--chart-1)' },
  rating: { label: 'Catalog rating', color: 'var(--chart-2)' },
} satisfies ChartConfig;

async function mapPool<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index]);
    }
  });
  await Promise.all(runners);
  return results;
}

function GradientDefs({ id, colorVar }: { id: string; colorVar: string }) {
  return (
    <defs>
      <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
        <stop offset="5%" stopColor={colorVar} stopOpacity={0.45} />
        <stop offset="95%" stopColor={colorVar} stopOpacity={0.05} />
      </linearGradient>
    </defs>
  );
}

export default function ProfileAnalytics({
  profile,
  source,
  datasetVersion,
}: {
  profile: LocalUserProfile;
  source: RecommendationDataSource | null;
  datasetVersion: string;
  onOpenNovel: (id: number) => void;
}) {
  const gradId = useId().replace(/:/g, '');
  const [scope, setScope] = useState<StatsScope>('all');
  const [details, setDetails] = useState<NovelDetail[]>([]);
  const [requested, setRequested] = useState(0);
  const [failed, setFailed] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [reducedMotion, setReducedMotion] = useState(false);
  const [selectedPoint, setSelectedPoint] = useState<{
    id: number;
    title: string;
    rating: number;
    readers: number;
    hidden: boolean;
  } | null>(null);

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    if (!source) return;
    const ids = profile.entries
      .flatMap((entry) => (entry.novel_id == null ? [] : [entry.novel_id]))
      .filter((id, index, all) => all.indexOf(id) === index)
      .slice(0, DETAIL_LIMIT);
    setRequested(ids.length);
    if (!ids.length) {
      setDetails([]);
      setFailed(0);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError('');
    mapPool(ids, DETAIL_CONCURRENCY, async (id) => {
      try {
        return await source.getNovel(id);
      } catch {
        return null;
      }
    }).then((results) => {
      if (cancelled) return;
      const loaded = results.filter((item): item is NovelDetail => item != null);
      setDetails(loaded);
      setFailed(results.length - loaded.length);
      setLoading(false);
    }).catch(() => {
      if (!cancelled) {
        setError('Could not load catalog details for analytics.');
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [profile, source]);

  const detailById = useMemo(() => new Map(details.map((detail) => [detail.id, detail])), [details]);

  const availableScopes = useMemo(() => {
    const kinds = new Set<ProfileMediaKind>();
    profile.entries.forEach((entry) => {
      const detail = entry.novel_id != null ? detailById.get(entry.novel_id) : undefined;
      // Local import of profileStats.infer via mediaKindBreakdown source of truth
      if (entry.media_kind) kinds.add(entry.media_kind);
      else if (/^anilist-anime-/i.test(entry.slug) || (entry.novel_id != null && entry.novel_id >= 3_000_000)) kinds.add('anime');
      else if (/^anilist-\d+/i.test(entry.slug) || (entry.novel_id != null && entry.novel_id >= 2_000_000)) kinds.add('manga');
      else kinds.add('novel');
      if (detail?.media_type === 'anime') kinds.add('anime');
      if (detail && ['manga', 'manhwa', 'manhua', 'comic'].includes(detail.media_type || '')) kinds.add('manga');
    });
    return kinds;
  }, [profile.entries, detailById]);

  // If the library is NU-only (or single kind), hide pointless multi-format chips later.
  useEffect(() => {
    if (scope !== 'all' && !availableScopes.has(scope)) setScope('all');
  }, [scope, availableScopes]);

  const scopedEntries = useMemo(
    () => filterEntriesByScope(profile.entries, scope, detailById),
    [profile.entries, scope, detailById]
  );

  const scopedDetails = useMemo(() => {
    const allowed = new Set(scopedEntries.flatMap((entry) => (entry.novel_id == null ? [] : [entry.novel_id])));
    return details.filter((detail) => allowed.has(detail.id));
  }, [details, scopedEntries]);

  const kpis = useMemo(() => overviewKpis(scopedEntries), [scopedEntries]);
  const statusData = useMemo(() => countByStatus(scopedEntries).filter((row) => row.count > 0), [scopedEntries]);
  const scoreData = useMemo(() => scoreDistribution(scopedEntries), [scopedEntries]);
  const activityData = useMemo(() => activityByMonth(scopedEntries), [scopedEntries]);
  const mediaData = useMemo(() => mediaKindBreakdown(scopedEntries, detailById), [scopedEntries, detailById]);
  const languageData = useMemo(() => languageBreakdown(scopedDetails), [scopedDetails]);
  const yearData = useMemo(() => releaseYearDistribution(scopedDetails), [scopedDetails]);
  const genreData = useMemo(() => genreBreakdown(scopedEntries, detailById), [scopedEntries, detailById]);
  const hasDates = useMemo(() => profileHasDates({ ...profile, entries: scopedEntries }), [profile, scopedEntries]);

  const scatterData = useMemo(
    () =>
      scopedDetails
        .filter((detail) => detail.rating > 0)
        .map((detail) => ({
          id: detail.id,
          title: detail.title,
          rating: detail.rating,
          readers: detail.reading_list_count,
          readerScale: Math.log10(detail.reading_list_count + 1),
          hidden: detail.rating >= 4.2 && detail.reading_list_count < 2000,
        })),
    [scopedDetails]
  );

  const progressLabel =
    scope === 'anime' ? 'Episodes logged' : scope === 'manga' ? 'Chapters logged' : 'Chapters / episodes logged';

  const showFormatFilter = availableScopes.size > 1;

  return (
    <section className="profile-analytics" aria-labelledby="analytics-title">
      <div className="profile-library-heading">
        <div>
          <span className="eyebrow">AniList-style overview</span>
          <h2 id="analytics-title">Library stats</h2>
        </div>
        <span>{datasetVersion}</span>
      </div>

      <p className="analytics-coverage">
        Overview KPIs use all {profile.entries.length.toLocaleString()} local entries
        {scope !== 'all' ? ` filtered to ${scope}` : ''}. Catalog charts (genres, years, popularity)
        use {scopedDetails.length.toLocaleString()} of {requested.toLocaleString()} matched titles
        {failed ? ` (${failed} unavailable)` : ''}. NovelUpdates imports work without AniList dates;
        activity-over-time appears when GDPR start/finish dates are present.
      </p>

      {showFormatFilter && (
        <div className="analytics-scope-tabs" role="tablist" aria-label="Stats media scope">
          {([
            ['all', 'All'],
            ['novel', 'Novels'],
            ['manga', 'Manga'],
            ['anime', 'Anime'],
          ] as const).map(([value, label]) => {
            if (value !== 'all' && !availableScopes.has(value)) return null;
            return (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={scope === value}
                className={scope === value ? 'active' : ''}
                onClick={() => setScope(value)}
              >
                {label}
              </button>
            );
          })}
        </div>
      )}

      <div className="analytics-kpi-grid">
        <div><strong>{kpis.total.toLocaleString()}</strong><span>Total titles</span></div>
        <div><strong>{kpis.meanScore ? kpis.meanScore.toFixed(2) : '—'}</strong><span>Mean score</span></div>
        <div><strong>{kpis.stdScore ? kpis.stdScore.toFixed(2) : '—'}</strong><span>Score std. dev.</span></div>
        <div><strong>{kpis.rated.toLocaleString()}</strong><span>Rated</span></div>
        <div><strong>{kpis.completionRate}%</strong><span>Completed</span></div>
        <div><strong>{kpis.progressTotal.toLocaleString()}</strong><span>{progressLabel}</span></div>
        <div><strong>{kpis.matched.toLocaleString()}</strong><span>Matched in catalog</span></div>
      </div>

      {loading && <p className="analytics-state" aria-live="polite">Loading matched catalog analytics…</p>}
      {error && <p className="analytics-state analytics-error">{error}</p>}

      <div className="analytics-grid">
        <article className="analytics-card">
          <h3>Status distribution</h3>
          <p>Your local reading statuses — same buckets for NovelUpdates and AniList imports.</p>
          {statusData.length ? (
            <>
              <ChartContainer
                config={Object.fromEntries(statusData.map((row) => [row.status, { label: row.label, color: STATUS_COLORS[row.status] }]))}
                className="analytics-chart analytics-chart-pie"
              >
                <PieChart>
                  <ChartTooltip
                    content={<ChartTooltipContent config={Object.fromEntries(statusData.map((row) => [row.status, { label: row.label, color: STATUS_COLORS[row.status] }]))} />}
                  />
                  <Pie
                    data={statusData}
                    dataKey="count"
                    nameKey="status"
                    innerRadius={55}
                    outerRadius={90}
                    paddingAngle={2}
                    isAnimationActive={!reducedMotion}
                  >
                    {statusData.map((row) => (
                      <Cell key={row.status} fill={STATUS_COLORS[row.status] || 'var(--chart-1)'} stroke="var(--surface)" />
                    ))}
                  </Pie>
                </PieChart>
              </ChartContainer>
              <ul className="analytics-legend">
                {statusData.map((row) => (
                  <li key={row.status}>
                    <i style={{ background: STATUS_COLORS[row.status] }} />
                    <span>{STATUS_LABELS[row.status]}</span>
                    <strong>{row.count}</strong>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="analytics-state">No status data yet.</p>
          )}
        </article>

        <article className="analytics-card">
          <h3>Score distribution</h3>
          <p>Personal scores on the shared 1–5 scale (NovelUpdates stars and AniList scores both map here).</p>
          <ChartContainer config={scoreChartConfig} className="analytics-chart">
            <AreaChart accessibilityLayer data={scoreData} margin={{ left: 8, right: 12, top: 12, bottom: 4 }}>
              <GradientDefs id={`${gradId}-score`} colorVar="var(--color-count)" />
              <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
              <XAxis dataKey="score" tickLine={false} axisLine={false} tickMargin={8} tick={{ fill: 'var(--muted)', fontSize: 11 }} />
              <YAxis allowDecimals={false} width={32} tickLine={false} axisLine={false} tick={{ fill: 'var(--muted)', fontSize: 11 }} />
              <ChartTooltip cursor={false} content={<ChartTooltipContent config={scoreChartConfig} />} />
              <Area
                dataKey="count"
                type="natural"
                fill={`url(#${gradId}-score)`}
                fillOpacity={1}
                stroke="var(--color-count)"
                strokeWidth={2}
                isAnimationActive={!reducedMotion}
              />
            </AreaChart>
          </ChartContainer>
        </article>

        {mediaData.length > 1 && (
          <article className="analytics-card">
            <h3>Format mix</h3>
            <p>Inferred from import source and catalog metadata when available.</p>
            <ChartContainer
              config={{
                novel: { label: 'Novels', color: 'var(--chart-1)' },
                manga: { label: 'Manga', color: 'var(--chart-2)' },
                anime: { label: 'Anime', color: 'var(--chart-3)' },
              }}
              className="analytics-chart analytics-chart-bars"
            >
              <BarChart data={mediaData} layout="vertical" margin={{ left: 8, right: 16, top: 8, bottom: 8 }}>
                <CartesianGrid horizontal={false} stroke="var(--chart-grid)" />
                <XAxis type="number" allowDecimals={false} tickLine={false} axisLine={false} tick={{ fill: 'var(--muted)', fontSize: 11 }} />
                <YAxis type="category" dataKey="label" width={64} tickLine={false} axisLine={false} tick={{ fill: 'var(--muted)', fontSize: 11 }} />
                <ChartTooltip content={<ChartTooltipContent config={{ count: { label: 'Titles', color: 'var(--chart-1)' } }} />} />
                <Bar dataKey="count" radius={[0, 6, 6, 0]} isAnimationActive={!reducedMotion}>
                  {mediaData.map((row) => (
                    <Cell
                      key={row.kind}
                      fill={row.kind === 'novel' ? 'var(--chart-1)' : row.kind === 'manga' ? 'var(--chart-2)' : 'var(--chart-3)'}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ChartContainer>
          </article>
        )}

        {languageData.length > 0 && (
          <article className="analytics-card">
            <h3>Languages</h3>
            <p>Among matched catalog titles (NovelUpdates language field or AniList country mapping).</p>
            <ChartContainer config={languageChartConfig} className="analytics-chart analytics-chart-bars">
              <BarChart data={languageData.slice(0, 8)} layout="vertical" margin={{ left: 4, right: 16, top: 8, bottom: 8 }}>
                <CartesianGrid horizontal={false} stroke="var(--chart-grid)" />
                <XAxis type="number" allowDecimals={false} tickLine={false} axisLine={false} tick={{ fill: 'var(--muted)', fontSize: 11 }} />
                <YAxis type="category" dataKey="language" width={84} tickLine={false} axisLine={false} tick={{ fill: 'var(--muted)', fontSize: 11 }} />
                <ChartTooltip content={<ChartTooltipContent config={languageChartConfig} />} />
                <Bar dataKey="count" fill="var(--color-count)" radius={[0, 6, 6, 0]} isAnimationActive={!reducedMotion} />
              </BarChart>
            </ChartContainer>
          </article>
        )}
      </div>

      {hasDates && activityData.length > 0 && (
        <article className="analytics-card analytics-card-wide">
          <h3>Activity over time</h3>
          <p>From AniList start/finish dates when present. NovelUpdates HTML imports usually omit dates, so this chart stays empty for pure NU libraries.</p>
          <ChartContainer config={activityChartConfig} className="analytics-chart analytics-chart-wide">
            <AreaChart accessibilityLayer data={activityData} margin={{ left: 8, right: 12, top: 12, bottom: 4 }}>
              <GradientDefs id={`${gradId}-started`} colorVar="var(--color-started)" />
              <GradientDefs id={`${gradId}-finished`} colorVar="var(--color-finished)" />
              <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
              <XAxis
                dataKey="month"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                minTickGap={24}
                tick={{ fill: 'var(--muted)', fontSize: 10 }}
                tickFormatter={(value) => String(value).slice(2)}
              />
              <YAxis allowDecimals={false} width={32} tickLine={false} axisLine={false} tick={{ fill: 'var(--muted)', fontSize: 11 }} />
              <ChartTooltip cursor={false} content={<ChartTooltipContent config={activityChartConfig} />} />
              <Area
                dataKey="started"
                type="natural"
                fill={`url(#${gradId}-started)`}
                stroke="var(--color-started)"
                strokeWidth={2}
                stackId="a"
                isAnimationActive={!reducedMotion}
              />
              <Area
                dataKey="finished"
                type="natural"
                fill={`url(#${gradId}-finished)`}
                stroke="var(--color-finished)"
                strokeWidth={2}
                stackId="b"
                isAnimationActive={!reducedMotion}
              />
            </AreaChart>
          </ChartContainer>
        </article>
      )}

      {yearData.length > 1 && (
        <article className="analytics-card analytics-card-wide">
          <h3>Release years</h3>
          <p>Publication / premiere year from matched catalog metadata.</p>
          <ChartContainer config={yearChartConfig} className="analytics-chart analytics-chart-wide">
            <AreaChart accessibilityLayer data={yearData} margin={{ left: 8, right: 12, top: 12, bottom: 4 }}>
              <GradientDefs id={`${gradId}-year`} colorVar="var(--color-count)" />
              <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
              <XAxis dataKey="year" tickLine={false} axisLine={false} tickMargin={8} minTickGap={20} tick={{ fill: 'var(--muted)', fontSize: 10 }} />
              <YAxis allowDecimals={false} width={32} tickLine={false} axisLine={false} tick={{ fill: 'var(--muted)', fontSize: 11 }} />
              <ChartTooltip cursor={false} content={<ChartTooltipContent config={yearChartConfig} />} />
              <Area
                dataKey="count"
                type="natural"
                fill={`url(#${gradId}-year)`}
                stroke="var(--color-count)"
                strokeWidth={2}
                isAnimationActive={!reducedMotion}
              />
            </AreaChart>
          </ChartContainer>
        </article>
      )}

      {genreData.length > 0 && (
        <article className="analytics-card analytics-card-wide">
          <h3>Top genres</h3>
          <p>Count among matched titles, with mean personal score when you rated them.</p>
          <ChartContainer config={genreChartConfig} className="analytics-chart analytics-chart-wide analytics-chart-bars">
            <BarChart data={genreData} layout="vertical" margin={{ left: 8, right: 16, top: 8, bottom: 8 }}>
              <CartesianGrid horizontal={false} stroke="var(--chart-grid)" />
              <XAxis type="number" allowDecimals={false} tickLine={false} axisLine={false} tick={{ fill: 'var(--muted)', fontSize: 11 }} />
              <YAxis type="category" dataKey="genre" width={110} tickLine={false} axisLine={false} tick={{ fill: 'var(--muted)', fontSize: 11 }} />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    config={genreChartConfig}
                    valueFormatter={(value, _key, payload) =>
                      `${Number(value).toLocaleString()} titles${payload?.meanScore ? ` · mean ${payload.meanScore}★` : ''}`
                    }
                  />
                }
              />
              <Bar dataKey="count" fill="var(--color-count)" radius={[0, 6, 6, 0]} isAnimationActive={!reducedMotion} />
            </BarChart>
          </ChartContainer>
        </article>
      )}

      {scatterData.length > 0 && (
        <article className="analytics-card analytics-card-wide scatter-card">
          <h3>Catalog rating vs list count</h3>
          <p>
            Gold points are potential hidden gems (catalog rating ≥ 4.2 and fewer than 2,000 on lists).
            Uses matched catalog metadata only — works for both NovelUpdates and AniList rows in the snapshot.
          </p>
          <ChartContainer config={cohortChartConfig} className="analytics-chart analytics-chart-scatter">
            <ScatterChart margin={{ top: 16, right: 18, bottom: 28, left: 4 }}>
              <CartesianGrid stroke="var(--chart-grid)" />
              <XAxis
                type="number"
                dataKey="readerScale"
                tick={{ fill: 'var(--muted)', fontSize: 10 }}
                tickFormatter={(value) => Math.round(10 ** Number(value)).toLocaleString()}
                tickLine={false}
                axisLine={false}
                label={{ value: 'List count · log scale', position: 'bottom', fill: 'var(--muted)', fontSize: 11 }}
              />
              <YAxis type="number" dataKey="rating" domain={[0, 5]} width={34} tick={{ fill: 'var(--muted)', fontSize: 10 }} tickLine={false} axisLine={false} />
              <ChartTooltip
                cursor={{ strokeDasharray: '3 3', stroke: 'var(--border-strong)' }}
                content={
                  <ChartTooltipContent
                    config={cohortChartConfig}
                    headingFormatter={(_, payload) => String(payload[0]?.payload?.title || 'Title')}
                    valueFormatter={(value, key, payload) =>
                      key === 'readerScale'
                        ? Number(payload?.readers || 0).toLocaleString()
                        : Number(value).toFixed(2)
                    }
                  />
                }
              />
              <Scatter
                data={scatterData}
                isAnimationActive={!reducedMotion}
                shape={(props: any) => {
                  const point = props.payload;
                  return (
                    <circle
                      cx={props.cx}
                      cy={props.cy}
                      r={6}
                      fill={point.hidden ? '#d89113' : 'var(--chart-1)'}
                      stroke="var(--surface)"
                      strokeWidth={2}
                      className="chart-selectable-point"
                      role="button"
                      tabIndex={0}
                      aria-label={`${point.title}, rating ${point.rating}`}
                      onClick={() => setSelectedPoint(point)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          setSelectedPoint(point);
                        }
                      }}
                    />
                  );
                }}
              />
            </ScatterChart>
          </ChartContainer>
          {selectedPoint && (
            <div className="chart-point-card" role="status">
              <div>
                <strong>{selectedPoint.title}</strong>
                <span>
                  {selectedPoint.rating} rating · {selectedPoint.readers.toLocaleString()} on lists
                </span>
                {selectedPoint.hidden && <span>Potential hidden gem</span>}
              </div>
              <a href={novelPageUrl(selectedPoint.id)}>Open title</a>
            </div>
          )}
        </article>
      )}

      {!loading && !requested && (
        <p className="analytics-state">
          No matched catalog titles yet — status and score charts still use your full local list.
          Import more pages or sync AniList media into the catalog to unlock genres and release years.
        </p>
      )}
    </section>
  );
}
