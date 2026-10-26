import { useEffect, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Scatter,
  ScatterChart,
  XAxis,
  YAxis,
} from 'recharts';
import { NovelDetail } from '../types';
import { RecommendationDataSource } from '../data';
import { LocalUserProfile, ProfileMediaKind } from './types';
import { usePatternCards } from './ProfilePatterns';
import StatsNav from './StatsNav';
import { detailLoadOrder } from './patterns';
import { novelPageUrl } from '../novelLinks';
import { ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from '../chart';
import {
  activityByMonth,
  filterEntriesByScope,
  genreBreakdown,
  languageBreakdown,
  formatSummaries,
  mediaKindBreakdown,
  overviewKpis,
  profileHasDates,
  releaseYearDistribution,
  scoreDistribution,
  StatsScope,
} from './profileStats';

/** Matched details to fetch; larger libraries load rated titles first (see detailLoadOrder). */
const DETAIL_LIMIT = 800;
const DETAIL_CONCURRENCY = 10;

const FORMAT_NOUNS: Record<ProfileMediaKind, string> = { anime: 'Anime', manga: 'Manga', novel: 'Novels' };

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

export default function ProfileAnalytics({
  profile,
  source,
}: {
  profile: LocalUserProfile;
  source: RecommendationDataSource | null;
}) {
  const [scope, setScope] = useState<StatsScope>('all');
  const [details, setDetails] = useState<NovelDetail[]>([]);
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

  const matchedIds = useMemo(() => detailLoadOrder(profile.entries), [profile.entries]);

  useEffect(() => {
    if (!source) return;
    const ids = matchedIds.slice(0, DETAIL_LIMIT);
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
  }, [matchedIds, source]);

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

  // Titles in scope that exist in the catalog, whether or not their details made it under the fetch cap.
  const matchedInScope = useMemo(
    () => new Set(scopedEntries.flatMap((entry) => (entry.novel_id == null ? [] : [entry.novel_id]))).size,
    [scopedEntries]
  );

  const summaries = useMemo(() => formatSummaries(scopedEntries, detailById), [scopedEntries, detailById]);
  const kpis = useMemo(() => overviewKpis(scopedEntries), [scopedEntries]);
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

  const showFormatFilter = availableScopes.size > 1;

  const { ready, cards, unavailable: unavailablePatterns } = usePatternCards(scopedEntries, detailById, loading);
  const showScores = kpis.rated > 0;
  const showActivity = hasDates && activityData.length > 0;
  const showTaste = Boolean(cards.finishing || cards.rating) || genreData.length > 0;
  const showHabits = Boolean(cards.drop) || showActivity;
  const showCatalog = yearData.length > 1 || scatterData.length > 0 || languageData.length > 0;

  const unavailable = [
    ...unavailablePatterns,
    ...(!showActivity ? [{ id: 'activity', title: 'Activity over time', reason: 'needs start and finish dates, which AniList exports include' }] : []),
    ...(!matchedIds.length ? [{ id: 'catalog', title: 'Genres, years and languages', reason: 'need titles matched to the catalog' }] : []),
  ];

  const sections = [
    { id: 'stats-overview', label: 'Overview', show: true },
    { id: 'stats-ratings', label: 'Ratings', show: Boolean(cards.calibration) },
    { id: 'stats-taste', label: 'Taste', show: showTaste },
    { id: 'stats-picks', label: 'Picks', show: Boolean(cards.model) },
    { id: 'stats-habits', label: 'Habits', show: showHabits },
    { id: 'stats-catalog', label: 'Catalog', show: showCatalog },
  ].filter((section) => section.show);

  return (
    <section className="profile-analytics" aria-label="Library stats">
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

      <StatsNav sections={sections} reducedMotion={reducedMotion} />

      <section id="stats-overview" className="stats-section" aria-labelledby="stats-overview-title">
        <h3 id="stats-overview-title">Overview</h3>
        <div className="analytics-summaries">
          {summaries.map((summary) => (
            <article key={summary.kind} className="analytics-summary" aria-label={`${FORMAT_NOUNS[summary.kind]} summary`}>
              <div className="analytics-summary-stats">
                <div><strong>{summary.total.toLocaleString()}</strong><span>Total {FORMAT_NOUNS[summary.kind]}</span></div>
                <div title={summary.kind === 'anime' ? 'Estimated at 24 minutes per episode' : undefined}>
                  <strong>{summary.kind === 'anime' ? '~' : ''}{summary.progressValue.toLocaleString()}</strong>
                  <span>{summary.progressLabel}</span>
                </div>
                <div><strong>{summary.meanScore != null ? summary.meanScore.toFixed(2) : '—'}</strong><span>Mean score (of 5)</span></div>
              </div>
              <div className="analytics-summary-bar" role="img" aria-label={summary.statuses.map((row) => `${row.label} ${row.count}`).join(', ')}>
                {summary.statuses.map((row) => (
                  <i key={row.status} style={{ background: STATUS_COLORS[row.status], flexGrow: row.count }} title={`${row.label}: ${row.count}`} />
                ))}
              </div>
              <ul className="analytics-summary-legend">
                {summary.statuses.map((row) => (
                  <li key={row.status}><i style={{ background: STATUS_COLORS[row.status] }} />{row.label} <strong>{row.count.toLocaleString()}</strong></li>
                ))}
              </ul>
            </article>
          ))}
        </div>

        <div className="analytics-kpi-grid">
          <div><strong>{kpis.rated.toLocaleString()}</strong><span>Rated</span></div>
          <div><strong>{kpis.completionRate}%</strong><span>Completed</span></div>
          <div><strong>{kpis.matched.toLocaleString()}</strong><span>In catalog</span></div>
        </div>

        {(showScores || mediaData.length > 1) && (
          <div className="analytics-grid">
            {showScores && (
              <article className="analytics-card">
                <h4>Score distribution</h4>
                <ChartContainer config={scoreChartConfig} className="analytics-chart">
                  <BarChart accessibilityLayer data={scoreData} margin={{ left: 8, right: 12, top: 12, bottom: 4 }}>
                    <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
                    <XAxis dataKey="score" tickLine={false} axisLine={false} tickMargin={8} tick={{ fill: 'var(--muted)', fontSize: 11 }} tickFormatter={(value) => `${value}★`} />
                    <YAxis allowDecimals={false} width={32} tickLine={false} axisLine={false} tick={{ fill: 'var(--muted)', fontSize: 11 }} />
                    <ChartTooltip cursor={false} content={<ChartTooltipContent config={scoreChartConfig} />} />
                    <Bar dataKey="count" fill="var(--color-count)" radius={[4, 4, 0, 0]} maxBarSize={56} isAnimationActive={!reducedMotion} />
                  </BarChart>
                </ChartContainer>
              </article>
            )}
            {mediaData.length > 1 && (
              <article className="analytics-card">
                <h4>Format mix</h4>
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
          </div>
        )}
      </section>

      {cards.calibration && (
        <section id="stats-ratings" className="stats-section" aria-labelledby="stats-ratings-title">
          <h3 id="stats-ratings-title">Ratings</h3>
          <div className="analytics-grid">{cards.calibration}</div>
        </section>
      )}

      {showTaste && (
        <section id="stats-taste" className="stats-section" aria-labelledby="stats-taste-title">
          <h3 id="stats-taste-title">Taste</h3>
          <div className="analytics-grid">
            {cards.finishing}
            {cards.rating}
            {genreData.length > 0 && (
              <article className="analytics-card analytics-card-wide">
                <h4>Top genres</h4>
                <p>Titles per genre. Hover for your mean score.</p>
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
          </div>
        </section>
      )}

      {cards.model && (
        <section id="stats-picks" className="stats-section" aria-labelledby="stats-picks-title">
          <h3 id="stats-picks-title">Picks</h3>
          <div className="analytics-grid">{cards.model}</div>
        </section>
      )}

      {showHabits && (
        <section id="stats-habits" className="stats-section" aria-labelledby="stats-habits-title">
          <h3 id="stats-habits-title">Habits</h3>
          <div className="analytics-grid">
            {cards.drop}
            {hasDates && activityData.length > 0 && (
              <article className="analytics-card analytics-card-wide">
                <h4>Activity over time</h4>
                <p>From AniList start and finish dates.</p>
                <ChartContainer config={activityChartConfig} className="analytics-chart analytics-chart-wide">
                  <BarChart accessibilityLayer data={activityData} barGap={1} margin={{ left: 8, right: 12, top: 12, bottom: 4 }}>
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
                    <Bar dataKey="started" fill="var(--color-started)" radius={[2, 2, 0, 0]} isAnimationActive={!reducedMotion} />
                    <Bar dataKey="finished" fill="var(--color-finished)" radius={[2, 2, 0, 0]} isAnimationActive={!reducedMotion} />
                  </BarChart>
                </ChartContainer>
              </article>
            )}
          </div>
        </section>
      )}

      {showCatalog && (
        <section id="stats-catalog" className="stats-section" aria-labelledby="stats-catalog-title">
          <h3 id="stats-catalog-title">Catalog</h3>
          <div className="analytics-grid">
            {yearData.length > 1 && (
              <article className="analytics-card analytics-card-wide">
                <h4>Release years</h4>
                <ChartContainer config={yearChartConfig} className="analytics-chart analytics-chart-wide">
                  <BarChart accessibilityLayer data={yearData} margin={{ left: 8, right: 12, top: 12, bottom: 4 }}>
                    <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
                    <XAxis dataKey="year" tickLine={false} axisLine={false} tickMargin={8} minTickGap={20} tick={{ fill: 'var(--muted)', fontSize: 10 }} />
                    <YAxis allowDecimals={false} width={32} tickLine={false} axisLine={false} tick={{ fill: 'var(--muted)', fontSize: 11 }} />
                    <ChartTooltip cursor={false} content={<ChartTooltipContent config={yearChartConfig} />} />
                    <Bar dataKey="count" fill="var(--color-count)" radius={[2, 2, 0, 0]} isAnimationActive={!reducedMotion} />
                  </BarChart>
                </ChartContainer>
              </article>
            )}
            {scatterData.length > 0 && (
              <article className="analytics-card analytics-card-wide scatter-card">
                <h4>Hidden gems</h4>
                <p>Gold points are possible hidden gems: rated 4.2+ with under 2,000 on lists.</p>
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
            {languageData.length > 0 && (
              <article className="analytics-card analytics-card-wide">
                <h4>Languages</h4>
                <ChartContainer config={languageChartConfig} className="analytics-chart analytics-chart-wide analytics-chart-bars">
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
        </section>
      )}

      {loading && <p className="analytics-state" aria-live="polite">Loading catalog details…</p>}
      {error && <p className="analytics-state analytics-error">{error}</p>}

      {ready && unavailable.length > 0 && (
        <aside className="analytics-pending" aria-label="Not enough data yet">
          <h4>Not enough data yet</h4>
          <ul>
            {unavailable.map((item) => (
              <li key={item.title}><strong>{item.title}</strong> {item.reason}</li>
            ))}
          </ul>
        </aside>
      )}

      <p className="analytics-coverage">
        Catalog charts and patterns use {scopedDetails.length.toLocaleString()} of {matchedInScope.toLocaleString()} matched titles
        {scopedDetails.length < matchedInScope ? ' (rated and finished load first)' : ''}
        {failed ? `, ${failed} unavailable` : ''}. Ranges are 95% intervals; sections without enough data are left out.
      </p>
    </section>
  );
}
