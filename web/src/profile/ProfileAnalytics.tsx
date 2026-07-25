import { useEffect, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  XAxis,
  YAxis
} from 'recharts';
import { NovelDetail } from '../types';
import { RecommendationDataSource } from '../data';
import { LocalUserProfile } from './types';
import { novelPageUrl } from '../novelLinks';
import { ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from '../chart';

const SAMPLE_LIMIT = 40;
const ratingChartConfig = {
  count: {
    label: 'Rated titles',
    color: 'var(--chart-1)'
  }
} satisfies ChartConfig;

function AnalyticsTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const item = payload[0]?.payload || {};
  return <div className="analytics-tooltip">
    <strong>{item.title || item.language || item.label || label}</strong>
    {item.count != null && <span>{item.count} titles</span>}
    {item.rating != null && <span>Rating {item.rating}</span>}
    {item.readers != null && <span>{Number(item.readers).toLocaleString()} readers</span>}
    {item.hidden && <span>Potential hidden gem</span>}
    {item.id != null && <span>Select for novel details</span>}
  </div>;
}

export default function ProfileAnalytics({
  profile,
  source,
  datasetVersion
}: {
  profile: LocalUserProfile;
  source: RecommendationDataSource | null;
  datasetVersion: string;
  onOpenNovel: (id: number) => void;
}) {
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
    const ids = profile.entries.flatMap((entry) => entry.novel_id == null ? [] : [entry.novel_id]).slice(0, SAMPLE_LIMIT);
    setRequested(ids.length);
    if (!ids.length) { setDetails([]); return; }
    let cancelled = false;
    setLoading(true);
    setError('');
    Promise.allSettled(ids.map((id) => source.getNovel(id))).then((results) => {
      if (cancelled) return;
      const loaded = results.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []);
      setDetails(loaded);
      setFailed(results.length - loaded.length);
      setLoading(false);
    }).catch(() => {
      if (!cancelled) { setError('Could not load catalog details for analytics.'); setLoading(false); }
    });
    return () => { cancelled = true; };
  }, [profile, source]);

  const languages = useMemo(() => {
    const counts = new Map<string, number>();
    details.forEach((detail) => {
      const language = detail.language?.trim() || 'Unknown';
      counts.set(language, (counts.get(language) || 0) + 1);
    });
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [details]);
  const ratingCounts = useMemo(() => {
    const counts = new Map<number, number>();
    profile.entries.forEach((entry) => {
      if (entry.rating == null) return;
      counts.set(entry.rating, (counts.get(entry.rating) || 0) + 1);
    });
    return [...counts.entries()].sort((a, b) => a[0] - b[0]);
  }, [profile]);
  const scatter = details.filter((detail) => detail.rating > 0);
  const hiddenGem = (detail: NovelDetail) => detail.rating >= 4.2 && detail.reading_list_count < 2000;
  const scatterData = scatter.map((detail) => ({
    id: detail.id,
    title: detail.title,
    rating: detail.rating,
    readers: detail.reading_list_count,
    readerScale: Math.log10(detail.reading_list_count + 1),
    hidden: hiddenGem(detail)
  }));
  const languageData = languages.map(([language, count]) => ({ language, count }));
  const ratingLookup = new Map(ratingCounts);
  const ratingData = [1, 2, 3, 4, 5].map((rating) => ({
    rating,
    label: `${rating}★`,
    count: ratingLookup.get(rating) || 0
  }));

  return (
    <section className="profile-analytics" aria-labelledby="analytics-title">
      <div className="profile-library-heading">
        <div><span className="eyebrow">Evidence-based snapshot</span><h2 id="analytics-title">Profile analytics</h2></div>
        <span>{datasetVersion}</span>
      </div>
      <p className="analytics-coverage">
        Full-profile summaries use {profile.entries.length.toLocaleString()} normalized entries. Catalog charts loaded {details.length} of {requested} sampled matched titles
        {failed ? `; ${failed} detail file${failed === 1 ? '' : 's'} unavailable` : ''}. Metadata reflects this dataset snapshot, not reading history.
      </p>
      {loading && <p className="analytics-state" aria-live="polite">Loading matched catalog analytics…</p>}
      {error && <p className="analytics-state analytics-error">{error}</p>}
      {!loading && !error && !requested && <p className="analytics-state">No matched novels are available for catalog analytics.</p>}
      {!loading && details.length > 0 && <>
        <div className="analytics-grid">
          <article className="analytics-card">
            <h3>Language distribution</h3>
            <p>Language metadata among successfully loaded sample titles.</p>
            <div className="analytics-chart analytics-chart-bars" aria-hidden="true">
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={languageData} layout="vertical" margin={{ top: 6, right: 18, bottom: 6, left: 12 }}>
                  <defs><linearGradient id="languageGradient" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stopColor="var(--accent)" /><stop offset="100%" stopColor="var(--green)" /></linearGradient></defs>
                  <CartesianGrid horizontal={false} stroke="var(--border)" />
                  <XAxis type="number" allowDecimals={false} tick={{ fill: 'var(--muted)', fontSize: 10 }} axisLine={{ stroke: 'var(--border-strong)' }} />
                  <YAxis type="category" dataKey="language" width={88} tick={{ fill: 'var(--muted)', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <ChartTooltip content={<AnalyticsTooltip />} cursor={{ fill: 'var(--accent-soft)' }} />
                  <Bar dataKey="count" name="Titles" fill="url(#languageGradient)" radius={[0, 6, 6, 0]} isAnimationActive={!reducedMotion} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <table><caption>Language distribution data</caption><tbody>{languages.map(([language, count]) => <tr key={language}><th>{language}</th><td>{count}</td><td>{Math.round(count / details.length * 100)}%</td></tr>)}</tbody></table>
          </article>
          <article className="analytics-card">
            <h3>Personal rating summary</h3>
            <p>{ratingCounts.reduce((sum, [, count]) => sum + count, 0)} entries have an explicit imported rating; unrated entries are excluded.</p>
            <ChartContainer config={ratingChartConfig} className="analytics-chart rating-line-chart">
              <LineChart accessibilityLayer data={ratingData} margin={{ top: 12, right: 14, bottom: 4, left: 4 }}>
                <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
                <XAxis
                  dataKey="label"
                  tick={{ fill: 'var(--muted)', fontSize: 11 }}
                  tickLine={false}
                  tickMargin={10}
                  axisLine={false}
                  minTickGap={18}
                />
                <YAxis
                  allowDecimals={false}
                  domain={[0, 'auto']}
                  tick={{ fill: 'var(--muted)', fontSize: 11 }}
                  tickLine={false}
                  tickMargin={8}
                  axisLine={false}
                  width={34}
                />
                <ChartTooltip
                  cursor={{ stroke: 'var(--border-strong)', strokeDasharray: '3 3' }}
                  content={<ChartTooltipContent config={ratingChartConfig} />}
                />
                <Line
                  type="natural"
                  dataKey="count"
                  stroke="var(--color-count)"
                  strokeWidth={2.5}
                  dot={{ fill: 'var(--surface)', stroke: 'var(--color-count)', strokeWidth: 2, r: 3 }}
                  activeDot={{ fill: 'var(--color-count)', stroke: 'var(--surface)', strokeWidth: 3, r: 6 }}
                  isAnimationActive={!reducedMotion}
                />
              </LineChart>
            </ChartContainer>
            <table><caption>Personal rating distribution data</caption><thead><tr><th>Rating</th><th>Titles</th></tr></thead><tbody>{ratingCounts.map(([rating, count]) => <tr key={rating}><th>{rating}★</th><td>{count}</td></tr>)}</tbody></table>
          </article>
        </div>
        <article className="analytics-card scatter-card">
          <h3>Rating vs. readers</h3>
          <p>Gold points meet the transparent potential-hidden-gem rule: rating ≥ 4.2 and fewer than 2,000 readers. This is not a calibrated quality score.</p>
          <div className="analytics-chart analytics-chart-scatter" role="group" aria-label="Interactive rating and readership plot. Select a point to show novel details.">
            <ResponsiveContainer width="100%" height={340}>
              <ScatterChart margin={{ top: 18, right: 24, bottom: 26, left: 4 }}>
                <CartesianGrid stroke="var(--border)" />
                <XAxis type="number" dataKey="readerScale" name="Readers (log scale)" tick={{ fill: 'var(--muted)', fontSize: 10 }}
                  tickFormatter={(value) => Math.round(Math.pow(10, Number(value))).toLocaleString()} label={{ value: 'Readers · logarithmic scale', position: 'bottom', fill: 'var(--muted)', fontSize: 11 }} />
                <YAxis type="number" dataKey="rating" name="Rating" domain={[0, 5]} tick={{ fill: 'var(--muted)', fontSize: 10 }} width={34} />
                <ChartTooltip content={<AnalyticsTooltip />} cursor={{ strokeDasharray: '3 3', stroke: 'var(--border-strong)' }} />
                <Legend verticalAlign="top" height={28} formatter={() => 'Sampled profile titles · gold indicates potential hidden gem'} wrapperStyle={{ color: 'var(--muted)', fontSize: 11 }} />
                <Scatter name="Titles" data={scatterData} isAnimationActive={!reducedMotion}
                  shape={(props: any) => {
                    const point = props.payload;
                    const select = () => setSelectedPoint(point);
                    return <circle cx={props.cx} cy={props.cy} r={6} fill={point.hidden ? '#d89113' : 'var(--accent)'}
                      stroke="var(--surface)" strokeWidth={2} className="chart-selectable-point" role="button" tabIndex={0}
                      aria-label={`${point.title}, rating ${point.rating}, ${point.readers.toLocaleString()} readers. Show details.`}
                      onClick={select} onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          select();
                        }
                      }} />;
                  }}>
                  {scatterData.map((point) => <Cell key={point.id} fill={point.hidden ? '#d89113' : 'var(--accent)'} stroke="var(--surface)" strokeWidth={2} />)}
                </Scatter>
              </ScatterChart>
            </ResponsiveContainer>
          </div>
          {selectedPoint && <div className="chart-point-card" role="status">
            <div><strong>{selectedPoint.title}</strong>
              <span>{selectedPoint.rating} rating · {selectedPoint.readers.toLocaleString()} readers</span>
              {selectedPoint.hidden && <span>Potential hidden gem</span>}
            </div>
            <a href={novelPageUrl(selectedPoint.id)}>Open novel</a>
          </div>}
          <div className="analytics-table-wrap"><table><caption>Plotted novel data</caption><thead><tr><th>Novel</th><th>Rating</th><th>Readers</th><th>Classification</th></tr></thead><tbody>
            {scatter.map((detail) => <tr key={detail.id}><th><a href={novelPageUrl(detail.id)}>{detail.title}</a></th><td>{detail.rating}</td><td>{detail.reading_list_count.toLocaleString()}</td><td>{hiddenGem(detail) ? 'Potential hidden gem' : 'Other sample title'}</td></tr>)}
          </tbody></table></div>
        </article>
      </>}
    </section>
  );
}
