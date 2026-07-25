import { useEffect, useState } from 'react';
import { BarChart3, BookOpen } from 'lucide-react';
import { RecommendationDataSource } from './data';
import { NovelInsights } from './types';
import { browseFacetUrl } from './metadataLinks';
import { novelPageUrl } from './novelLinks';
import { Badge, Card } from './design-system';
import './novel-insights.css';

const LABELS = { rating: 'Rating', rating_votes: 'Rating votes', readers: 'Readers' };

export function NovelInsightsPanel({ novelId, source, onPeer }: {
  novelId: number; source: RecommendationDataSource; onPeer?: (id: number) => void;
}) {
  const [insights, setInsights] = useState<NovelInsights | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    setInsights(null); setError('');
    source.getNovelInsights(novelId).then((value) => !cancelled && setInsights(value))
      .catch((reason) => !cancelled && setError(reason.message || 'Insights unavailable.'));
    return () => { cancelled = true; };
  }, [novelId, source]);
  if (error) return <p className="insights-unavailable">{error}</p>;
  if (!insights) return <p className="insights-loading" role="status">Calculating catalog position…</p>;
  return <section className="novel-insights" aria-labelledby={`insights-${novelId}`}>
    <div className="insights-heading"><BarChart3 /><div><h3 id={`insights-${novelId}`}>Catalog insights</h3><p>Compared with all {insights.catalog_size.toLocaleString()} novels in this snapshot.</p></div></div>
    <div className="insight-metrics">{insights.metrics.map((metric) =>
      <Card key={metric.key}><Badge>{LABELS[metric.key]}</Badge><strong>Top {Math.max(0.1, 100 - metric.percentile).toFixed(1)}%</strong><small>Rank {metric.rank.toLocaleString()} of {metric.population.toLocaleString()} · {metric.percentile.toFixed(1)}th percentile</small></Card>
    )}</div>
    {insights.cohorts.length > 0 && <Card className="insight-cohorts"><h4>Comparable readership</h4><p className="insight-section-note">Rank among novels sharing a meaningful catalog attribute.</p><div>{insights.cohorts.map((item) =>
      <article key={item.dimension}><Badge tone="violet">{item.dimension.replace('_', ' ')}</Badge>
        <div>{item.dimension === 'primary_genre' ? <a href={browseFacetUrl('genre', item.value)}>{item.value}</a>
          : item.dimension === 'language' ? <a href={browseFacetUrl('language', item.value)}>{item.value}</a> : <strong>{item.value}</strong>}
          <small>#{item.readership_rank.toLocaleString()} of {item.population.toLocaleString()}</small></div></article>
    )}</div></Card>}
    {insights.peers.length > 0 && <div className="insight-peers"><div className="insight-section-heading"><div><h4>Closest catalog peers</h4><p>{insights.cohort_definition}</p></div><Badge tone="green">{insights.peers.length} peers</Badge></div><div>{insights.peers.map((peer) =>
      <Card key={peer.id} className="insight-peer-card">{peer.cover_url ? <img src={peer.cover_url} alt="" loading="lazy" /> : <span className="peer-cover-fallback"><BookOpen /></span>}
        <div>{onPeer ? <button onClick={() => onPeer(peer.id)}>{peer.title}</button>
          : <a href={novelPageUrl(peer.id, novelId)}>{peer.title}</a>}
          <span><Badge>{peer.shared_tag_count} tags</Badge><Badge>{peer.shared_genre_count} genres</Badge></span></div></Card>
    )}</div></div>}
    {!insights.capabilities.relationships && <p className="insights-note">Detailed relationship-edge analytics are unavailable; no relationship strength is inferred.</p>}
  </section>;
}
