import { Cell, CartesianGrid, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from 'recharts';
import { NovelDetail, NovelInsights } from './types';

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
  return <section className="cohort-chart-card" aria-labelledby={`cohort-chart-${novel.id}`}>
    <div><h4 id={`cohort-chart-${novel.id}`}>Rating and readership cohort</h4><p>Current novel highlighted against {Math.max(0, points.length - 1)} closest peers. Readership uses a logarithmic scale.</p></div>
    <div className="cohort-chart" aria-hidden="true">
      <ResponsiveContainer width="100%" height={280}>
        <ScatterChart margin={{ top: 16, right: 18, bottom: 26, left: 2 }}>
          <CartesianGrid stroke="var(--chart-grid)" />
          <XAxis type="number" dataKey="readerScale" tick={{ fill: 'var(--muted)', fontSize: 10 }}
            tickFormatter={(value) => Math.round(Math.pow(10, Number(value))).toLocaleString()}
            label={{ value: 'Readers · logarithmic scale', position: 'bottom', fill: 'var(--muted)', fontSize: 10 }} />
          <YAxis type="number" dataKey="rating" domain={[0, 5]} width={32} tick={{ fill: 'var(--muted)', fontSize: 10 }} />
          <Tooltip cursor={{ stroke: 'var(--border-strong)', strokeDasharray: '3 3' }}
            content={({ active, payload }) => active && payload?.[0] ? <div className="cohort-tooltip"><strong>{payload[0].payload.title}</strong><span>{payload[0].payload.rating} rating</span><span>{payload[0].payload.readers.toLocaleString()} readers</span></div> : null} />
          <Scatter data={points} isAnimationActive={false}>
            {points.map((point) => <Cell key={point.id} fill={point.current ? 'var(--green)' : 'var(--accent)'}
              stroke={point.current ? 'var(--text)' : 'var(--surface)'} strokeWidth={point.current ? 3 : 2} />)}
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>
    </div>
    <table><caption>Rating and readership cohort data</caption><thead><tr><th>Novel</th><th>Rating</th><th>Readers</th></tr></thead><tbody>
      {points.map((point) => <tr key={point.id}><th>{point.title}{point.current ? ' (current)' : ''}</th><td>{point.rating}</td><td>{point.readers.toLocaleString()}</td></tr>)}
    </tbody></table>
  </section>;
}
