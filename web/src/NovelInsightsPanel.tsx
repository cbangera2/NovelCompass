import { lazy, Suspense, useEffect, useState } from 'react';
import { BarChart3, BookOpen } from 'lucide-react';
import { RecommendationDataSource } from './data';
import { NovelDetail, NovelInsights } from './types';
import { browseFacetUrl } from './metadataLinks';
import { novelPageUrl } from './novelLinks';
import { Badge, Card } from './design-system';
import './novel-insights.css';

const LABELS = { rating: 'Rating', rating_votes: 'Rating votes', readers: 'Readers' };
const NovelCohortChart = lazy(() => import('./NovelCohortChart'));

export function NovelInsightsPanel({
  novelId,
  source,
  providedInsights,
  currentNovel,
}: {
  novelId: number;
  source: RecommendationDataSource;
  providedInsights?: NovelInsights | null;
  currentNovel?: NovelDetail;
}) {
  const [insights, setInsights] = useState<NovelInsights | null>(providedInsights || null);
  const [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    if (providedInsights) {
      setInsights(providedInsights);
      setError('');
      return;
    }
    setInsights(null);
    setError('');
    source
      .getNovelInsights(novelId)
      .then((value) => !cancelled && setInsights(value))
      .catch((reason) => !cancelled && setError(reason.message || 'Insights unavailable.'));
    return () => {
      cancelled = true;
    };
  }, [novelId, providedInsights, source]);
  if (error) return <p className="insights-unavailable">{error}</p>;
  if (!insights)
    return (
      <p className="insights-loading" role="status">
        Calculating catalog position…
      </p>
    );
  return (
    <section className="novel-insights" aria-labelledby={`insights-${novelId}`}>
      <div className="insights-heading">
        <BarChart3 />
        <div>
          <h3 id={`insights-${novelId}`}>Catalog insights</h3>
          <p>Compared with all {insights.catalog_size.toLocaleString()} novels in this snapshot.</p>
        </div>
      </div>
      <div className="insight-metrics">
        {insights.metrics.map((metric) => (
          <Card key={metric.key}>
            <Badge>{LABELS[metric.key]}</Badge>
            <strong>Top {Math.max(0.1, 100 - metric.percentile).toFixed(1)}%</strong>
            <span className="percentile-track" aria-hidden="true">
              <i style={{ width: `${metric.percentile}%` }} />
            </span>
            <small>
              Rank {metric.rank.toLocaleString()} of {metric.population.toLocaleString()} ·{' '}
              {metric.percentile.toFixed(1)}th percentile
            </small>
          </Card>
        ))}
      </div>
      {currentNovel && insights.peers.length > 0 && (
        <Suspense fallback={<p className="insights-loading">Loading cohort chart…</p>}>
          <NovelCohortChart novel={currentNovel} insights={insights} />
        </Suspense>
      )}
      {insights.cohorts.length > 0 && (
        <Card className="insight-cohorts">
          <h4>Comparable readership</h4>
          <p className="insight-section-note">
            Rank among novels sharing a meaningful catalog attribute.
          </p>
          <div>
            {insights.cohorts.map((item) => (
              <article key={item.dimension}>
                <Badge tone="violet">{item.dimension.replace('_', ' ')}</Badge>
                <div>
                  {item.dimension === 'primary_genre' ? (
                    <a href={browseFacetUrl('genre', item.value)}>{item.value}</a>
                  ) : item.dimension === 'language' ? (
                    <a href={browseFacetUrl('language', item.value)}>{item.value}</a>
                  ) : (
                    <strong>{item.value}</strong>
                  )}
                  <small>
                    #{item.readership_rank.toLocaleString()} of {item.population.toLocaleString()}
                  </small>
                </div>
              </article>
            ))}
          </div>
        </Card>
      )}
      {insights.peers.length > 0 && (
        <div className="insight-peers">
          <div className="insight-section-heading">
            <div>
              <h4>Top catalog cohort</h4>
              <p>
                {insights.cohort_definition} Showing up to 10 closest peers by shared catalog
                metadata.
              </p>
            </div>
            <Badge tone="green">{Math.min(10, insights.peers.length)} peers</Badge>
          </div>
          <div>
            {insights.peers.slice(0, 10).map((peer) => (
              <Card key={peer.id} className="insight-peer-card">
                <PeerCover src={peer.cover_url} />
                <div>
                  <a href={novelPageUrl(peer.id, novelId)}>{peer.title}</a>
                  <small className="insight-peer-meta">
                    {[peer.author, peer.language, peer.year].filter(Boolean).join(' · ')}
                  </small>
                  <span className="insight-peer-stats">
                    <span>
                      <b>{peer.rating.toFixed(1)}</b> rating
                    </span>
                    <span>
                      <b>{peer.reading_list_count.toLocaleString()}</b> readers
                    </span>
                  </span>
                  <span className="insight-peer-overlap">
                    <Badge>{peer.shared_tag_count} shared tags</Badge>
                    <Badge>{peer.shared_genre_count} shared genres</Badge>
                  </span>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}
      {!insights.capabilities.relationships && (
        <p className="insights-note">
          Detailed relationship-edge analytics are unavailable; no relationship strength is
          inferred.
        </p>
      )}
    </section>
  );
}

function PeerCover({ src }: { src?: string }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <span className="peer-cover-fallback">
        <BookOpen />
      </span>
    );
  }
  return <img src={src} alt="" loading="lazy" onError={() => setFailed(true)} />;
}
