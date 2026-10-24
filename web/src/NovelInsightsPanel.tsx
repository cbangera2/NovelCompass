import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { BookOpen } from 'lucide-react';
import { RecommendationDataSource } from './data';
import { NovelDetail, NovelInsights } from './types';
import { browseFacetUrl } from './metadataLinks';
import { novelPageUrl } from './novelLinks';
import { buildComparison } from './peerComparison';
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
  const comparison = useMemo(() => (insights ? buildComparison(insights, currentNovel, novelId) : null), [insights, currentNovel, novelId]);
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
      {comparison && (
        <div className="insight-peers">
          <div className="insight-section-heading">
            <div>
              <h4>How it compares</h4>
              {comparison.summary && <p className="peer-summary">{comparison.summary}</p>}
              <p>{comparison.definition}</p>
              <p className="peer-pointer">
                This is a comparison set, not a recommendation list. For what to read next, see <a href="#relationship">Related titles</a>.
              </p>
            </div>
            <Badge tone="green">{comparison.peerCount} similar {comparison.noun}</Badge>
          </div>
          <Card className="peer-table">
            <div className="peer-head" aria-hidden="true">
              <span>#</span>
              <span />
              <span>Title</span>
              <span>Rating</span>
              <span className="peer-head-readers" title="Bars use a log scale">On reading lists</span>
              <span className="peer-head-overlap">In common</span>
            </div>
            {comparison.rows.map((row) => {
              const content = (
                <>
                  <span className="peer-rank">{row.rank}</span>
                  <PeerCover src={row.cover_url} />
                  <span className="peer-name">
                    <strong>{row.title}</strong>
                    <small>{row.self ? 'This title' : [row.author, row.language, row.year].filter(Boolean).join(' · ')}</small>
                  </span>
                  <span className="peer-rating" title="Rating">
                    <b>{row.rating.toFixed(1)}★</b>
                    {!row.self && comparison.selfRating != null && Math.abs(row.rating - comparison.selfRating) >= 0.05 && (
                      <small>{row.rating > comparison.selfRating ? '+' : '−'}{Math.abs(row.rating - comparison.selfRating).toFixed(1)}</small>
                    )}
                  </span>
                  <span className="peer-metric readers" title="On reading lists">
                    <i style={{ width: `${Math.max(3, (Math.log10(row.readers + 1) / Math.log10(comparison.maxReaders + 1)) * 100)}%` }} />
                    <b>{row.readers.toLocaleString()}</b>
                  </span>
                  <span className="peer-overlap">{row.self ? '' : `${row.sharedTags} tags · ${row.sharedGenres} genres`}</span>
                </>
              );
              return row.self
                ? <div key={row.id} className="peer-row self" aria-current="true">{content}</div>
                : <a key={row.id} className="peer-row" data-preview-id={row.id} href={novelPageUrl(row.id, novelId)}>{content}</a>;
            })}
          </Card>
        </div>
      )}
      {currentNovel && insights.peers.length > 0 && (
        <Suspense fallback={<p className="insights-loading">Loading cohort chart…</p>}>
          <NovelCohortChart novel={currentNovel} insights={insights} noun={comparison?.noun ?? 'titles'} />
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
