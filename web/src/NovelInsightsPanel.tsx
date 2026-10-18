import { lazy, Suspense, useEffect, useState } from 'react';
import { BookOpen } from 'lucide-react';
import { RecommendationDataSource } from './data';
import { NovelDetail, NovelInsights } from './types';
import { browseFacetUrl } from './metadataLinks';
import { novelPageUrl } from './novelLinks';
import { Badge, Card } from './design-system';
import './novel-insights.css';

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
      {insights.cohorts.length > 0 && (
        <Card className="insight-cohorts">
          <h4>Comparable popularity</h4>
          <p className="insight-section-note">
            Rank among titles sharing a meaningful catalog attribute.
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
              <h4>Closest peers</h4>
              <p>{insights.cohort_definition}</p>
            </div>
            <Badge tone="green">{Math.min(10, insights.peers.length)} peers</Badge>
          </div>
          <Card className="peer-table">
            {insights.peers.slice(0, 10).map((peer, index) => {
              const maxReaders = Math.max(1, ...insights.peers.slice(0, 10).map((item) => item.reading_list_count));
              return (
                <a key={peer.id} className="peer-row" href={novelPageUrl(peer.id, novelId)}>
                  <span className="peer-rank">{index + 1}</span>
                  <PeerCover src={peer.cover_url} />
                  <span className="peer-name">
                    <strong>{peer.title}</strong>
                    <small>{[peer.author, peer.language, peer.year].filter(Boolean).join(' · ')}</small>
                  </span>
                  <span className="peer-metric" title="Rating">
                    <i style={{ width: `${(peer.rating / 5) * 100}%` }} /><b>{peer.rating.toFixed(1)}★</b>
                  </span>
                  <span className="peer-metric readers" title="On reading lists">
                    <i style={{ width: `${Math.max(3, (Math.log10(peer.reading_list_count + 1) / Math.log10(maxReaders + 1)) * 100)}%` }} />
                    <b>{peer.reading_list_count.toLocaleString()}</b>
                  </span>
                  <span className="peer-overlap">{peer.shared_tag_count} tags · {peer.shared_genre_count} genres</span>
                </a>
              );
            })}
          </Card>
        </div>
      )}
      {currentNovel && insights.peers.length > 0 && (
        <Suspense fallback={<p className="insights-loading">Loading cohort chart…</p>}>
          <NovelCohortChart novel={currentNovel} insights={insights} />
        </Suspense>
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
