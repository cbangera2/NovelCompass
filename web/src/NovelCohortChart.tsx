import { useState } from 'react';
import { Cell, CartesianGrid, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from 'recharts';
import { NovelDetail, NovelInsights } from './types';
import { novelPageUrl } from './novelLinks';

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
    <div><h4 id={`cohort-chart-${novel.id}`}>Rating and readership cohort</h4><p>Current novel highlighted against {Math.max(0, points.length - 1)} closest peers. Readership uses a logarithmic scale; identical points overlap and appear darker.</p></div>
    <div className="cohort-chart" role="group" aria-label="Interactive rating and readership cohort plot. Select a point to show novel details.">
      <ResponsiveContainer width="100%" height={280}>
        <ScatterChart margin={{ top: 16, right: 18, bottom: 26, left: 2 }}>
          <CartesianGrid stroke="var(--chart-grid)" />
          <XAxis type="number" dataKey="readerScale" domain={[xMin, xMax]} ticks={logarithmicTicks}
            allowDataOverflow tick={{ fill: 'var(--muted)', fontSize: 10 }} tickFormatter={formatReaders}
            label={{ value: 'Readers · logarithmic scale', position: 'bottom', fill: 'var(--muted)', fontSize: 10 }} />
          <YAxis type="number" dataKey="rating" domain={ratingDomain} allowDataOverflow tickCount={5}
            width={34} tick={{ fill: 'var(--muted)', fontSize: 10 }} tickFormatter={(value) => Number(value).toFixed(1)} />
          <Tooltip cursor={{ stroke: 'var(--border-strong)', strokeDasharray: '3 3' }}
            content={({ active, payload }) => active && payload?.[0] ? <div className="cohort-tooltip"><strong>{payload[0].payload.title}</strong><span>{payload[0].payload.rating} rating</span><span>{payload[0].payload.readers.toLocaleString()} readers</span><span>Select for novel details</span></div> : null} />
          <Scatter name="Closest peers" data={peerPoints} isAnimationActive={false}
            shape={(props: any) => {
              const point = props.payload;
              const select = () => setSelectedPoint(point);
              return <circle cx={props.cx} cy={props.cy} r={6} fill="var(--accent)" fillOpacity={.72}
                stroke="var(--surface)" strokeWidth={2} className="chart-selectable-point" role="button" tabIndex={0}
                aria-label={`${point.title}, rating ${point.rating}, ${point.readers.toLocaleString()} readers. Show details.`}
                onClick={select} onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    select();
                  }
                }} />;
            }}>
            {peerPoints.map((point) => <Cell key={point.id} fill="var(--accent)" fillOpacity={.72}
              stroke="var(--surface)" strokeWidth={2} />)}
          </Scatter>
          <Scatter name="Current novel" data={currentPoint} isAnimationActive={false}
            shape={(props: any) => {
              const point = props.payload;
              const select = () => setSelectedPoint(point);
              return <circle cx={props.cx} cy={props.cy} r={7} fill="var(--green)"
                stroke="var(--text)" strokeWidth={3} className="chart-selectable-point" role="button" tabIndex={0}
                aria-label={`${point.title}, current novel, rating ${point.rating}, ${point.readers.toLocaleString()} readers. Show details.`}
                onClick={select} onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    select();
                  }
                }} />;
            }}>
            {currentPoint.map((point) => <Cell key={point.id} fill="var(--green)"
              stroke="var(--text)" strokeWidth={3} />)}
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>
    </div>
    {selectedPoint && <div className="chart-point-card" role="status">
      <div><strong>{selectedPoint.title}{selectedPoint.current ? ' (current)' : ''}</strong>
        <span>{selectedPoint.rating} rating · {selectedPoint.readers.toLocaleString()} readers</span>
      </div>
      <a href={novelPageUrl(selectedPoint.id, selectedPoint.current ? undefined : novel.id)}>Open novel</a>
    </div>}
    <table><caption>Rating and readership cohort data</caption><thead><tr><th>Novel</th><th>Rating</th><th>Readers</th></tr></thead><tbody>
      {points.map((point) => <tr key={point.id}><th><a href={novelPageUrl(point.id, point.current ? undefined : novel.id)}>{point.title}{point.current ? ' (current)' : ''}</a></th><td>{point.rating}</td><td>{point.readers.toLocaleString()}</td></tr>)}
    </tbody></table>
  </section>;
}
