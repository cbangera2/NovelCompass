import { useState } from 'react';
import { Cell, CartesianGrid, Scatter, ScatterChart, XAxis, YAxis } from 'recharts';
import { NovelDetail, NovelInsights } from './types';
import { novelPageUrl } from './novelLinks';
import { ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from './chart';

const cohortChartConfig = {
  readerScale: { label: 'List count', color: 'var(--chart-1)' },
  rating: { label: 'Rating', color: 'var(--chart-2)' }
} satisfies ChartConfig;

export default function NovelCohortChart({ novel, insights }: { novel: NovelDetail; insights: NovelInsights }) {
  const points = [
    ...insights.peers.slice(0, 10).map((peer) => ({
      id: peer.id, title: peer.title, rating: peer.rating, readers: peer.reading_list_count,
      readerScale: Math.log10(peer.reading_list_count + 1), current: false
    })),
    {
      id: novel.id, title: novel.title, rating: novel.rating, readers: novel.reading_list_count,
      readerScale: Math.log10(novel.reading_list_count + 1), current: true
    }
  ].filter((point) => Number.isFinite(point.rating) && Number.isFinite(point.readerScale));
  const peerPoints = points.filter((point) => !point.current);
  const currentPoint = points.filter((point) => point.current);
  const [selectedPoint, setSelectedPoint] = useState<(typeof points)[number] | null>(null);
  const readershipValues = points.map((point) => point.readerScale);
  const ratingValues = points.map((point) => point.rating);
  const xMin = Math.max(0, Math.min(...readershipValues) - .14);
  const xMax = Math.max(xMin + .5, Math.max(...readershipValues) + .14);
  const logarithmicTicks = Array.from(
    { length: Math.max(0, Math.floor(xMax) - Math.ceil(xMin) + 1) },
    (_, index) => Math.ceil(xMin) + index
  );
  const rawRatingMin = Math.min(...ratingValues);
  const rawRatingMax = Math.max(...ratingValues);
  const ratingPadding = Math.max(.15, (rawRatingMax - rawRatingMin) * .12);
  const ratingDomain: [number, number] = [
    Math.max(0, Math.floor((rawRatingMin - ratingPadding) * 10) / 10),
    Math.min(5, Math.ceil((rawRatingMax + ratingPadding) * 10) / 10)
  ];
  const formatReaders = (value: number) => {
    const readers = Math.round(Math.pow(10, value));
    if (readers >= 1_000_000) return `${Number((readers / 1_000_000).toPrecision(2))}m`;
    if (readers >= 1_000) return `${Number((readers / 1_000).toPrecision(2))}k`;
    return readers.toLocaleString();
  };
  return <section className="cohort-chart-card" aria-labelledby={`cohort-chart-${novel.id}`}>
    <div><h4 id={`cohort-chart-${novel.id}`}>Rating and popularity cohort</h4><p>Current title highlighted against {Math.max(0, points.length - 1)} closest peers. List counts use a logarithmic scale; identical points overlap and appear darker.</p></div>
    <ChartContainer config={cohortChartConfig} className="cohort-chart">
        <ScatterChart accessibilityLayer margin={{ top: 16, right: 18, bottom: 30, left: 4 }}>
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
          <XAxis type="number" dataKey="readerScale" domain={[xMin, xMax]} ticks={logarithmicTicks}
            allowDataOverflow tick={{ fill: 'var(--muted)', fontSize: 11 }} tickFormatter={formatReaders}
            tickLine={false} tickMargin={9} axisLine={false}
            label={{ value: 'List count · logarithmic scale', position: 'bottom', fill: 'var(--muted)', fontSize: 11 }} />
          <YAxis type="number" dataKey="rating" domain={ratingDomain} allowDataOverflow tickCount={5}
            width={38} tick={{ fill: 'var(--muted)', fontSize: 11 }} tickFormatter={(value) => Number(value).toFixed(1)}
            tickLine={false} tickMargin={8} axisLine={false} />
          <ChartTooltip cursor={{ stroke: 'var(--border-strong)', strokeDasharray: '3 3' }}
            content={<ChartTooltipContent config={cohortChartConfig}
              headingFormatter={(_, payload) => String(payload[0]?.payload?.title || 'Title')}
              valueFormatter={(value, key, payload) => key === 'readerScale'
                ? Number(payload?.readers || 0).toLocaleString()
                : Number(value).toFixed(1)} />} />
          <Scatter name="Closest peers" data={peerPoints} isAnimationActive={false}
            shape={(props: any) => {
              const point = props.payload;
              const select = () => setSelectedPoint(point);
              return <circle cx={props.cx} cy={props.cy} r={5} fill="var(--color-readerScale)" fillOpacity={.7}
                stroke="var(--surface)" strokeWidth={2} className="chart-selectable-point cohort-peer-point" role="button" tabIndex={0}
                aria-label={`${point.title}, rating ${point.rating}, ${point.readers.toLocaleString()} on lists. Show details.`}
                onClick={select} onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    select();
                  }
                }} />;
            }}>
            {peerPoints.map((point) => <Cell key={point.id} fill="var(--color-readerScale)" fillOpacity={.7}
              stroke="var(--surface)" strokeWidth={2} />)}
          </Scatter>
          <Scatter name="Current title" data={currentPoint} isAnimationActive={false}
            shape={(props: any) => {
              const point = props.payload;
              const select = () => setSelectedPoint(point);
              return <circle cx={props.cx} cy={props.cy} r={8} fill="var(--color-rating)"
                stroke="var(--surface)" strokeWidth={3} className="chart-selectable-point cohort-current-point" role="button" tabIndex={0}
                aria-label={`${point.title}, current title, rating ${point.rating}, ${point.readers.toLocaleString()} on lists. Show details.`}
                onClick={select} onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    select();
                  }
                }} />;
            }}>
            {currentPoint.map((point) => <Cell key={point.id} fill="var(--color-rating)"
              stroke="var(--surface)" strokeWidth={3} />)}
          </Scatter>
        </ScatterChart>
    </ChartContainer>
    {selectedPoint && <div className="chart-point-card" role="status">
      <div><strong>{selectedPoint.title}{selectedPoint.current ? ' (current)' : ''}</strong>
        <span>{selectedPoint.rating} rating · {selectedPoint.readers.toLocaleString()} on lists</span>
      </div>
      <a href={novelPageUrl(selectedPoint.id, selectedPoint.current ? undefined : novel.id)}>Open title</a>
    </div>}
    <table><caption>Rating and popularity cohort data</caption><thead><tr><th>Title</th><th>Rating</th><th>List count</th></tr></thead><tbody>
      {points.map((point) => <tr key={point.id}><th><a href={novelPageUrl(point.id, point.current ? undefined : novel.id)}>{point.title}{point.current ? ' (current)' : ''}</a></th><td>{point.rating}</td><td>{point.readers.toLocaleString()}</td></tr>)}
    </tbody></table>
  </section>;
}
