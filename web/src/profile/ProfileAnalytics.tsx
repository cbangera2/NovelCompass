import { useEffect, useMemo, useState } from 'react';
import { NovelDetail } from '../types';
import { RecommendationDataSource } from '../data';
import { LocalUserProfile } from './types';

const SAMPLE_LIMIT = 40;

export function ProfileAnalytics({
  profile,
  source,
  datasetVersion,
  onOpenNovel
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
  const maxReaders = Math.max(1, ...scatter.map((detail) => detail.reading_list_count));
  const hiddenGem = (detail: NovelDetail) => detail.rating >= 4.2 && detail.reading_list_count < 2000;

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
            <div className="language-bars">
              {languages.map(([language, count]) => <div key={language}>
                <span>{language}</span><i><b style={{ width: `${(count / details.length) * 100}%` }} /></i><strong>{count}</strong>
              </div>)}
            </div>
            <table><caption>Language distribution data</caption><tbody>{languages.map(([language, count]) => <tr key={language}><th>{language}</th><td>{count}</td><td>{Math.round(count / details.length * 100)}%</td></tr>)}</tbody></table>
          </article>
          <article className="analytics-card">
            <h3>Personal rating summary</h3>
            <p>{ratingCounts.reduce((sum, [, count]) => sum + count, 0)} entries have an explicit imported rating; unrated entries are excluded.</p>
            <div className="rating-bars">{ratingCounts.map(([rating, count]) => <div key={rating}><span>{rating}★</span><i style={{ height: `${Math.max(8, count / Math.max(1, ...ratingCounts.map(([, value]) => value)) * 100)}%` }} /><strong>{count}</strong></div>)}</div>
          </article>
        </div>
        <article className="analytics-card scatter-card">
          <h3>Rating vs. readers</h3>
          <p>Gold points meet the transparent potential-hidden-gem rule: rating ≥ 4.2 and fewer than 2,000 readers. This is not a calibrated quality score.</p>
          <svg viewBox="0 0 760 300" role="img" aria-labelledby="scatter-title scatter-desc">
            <title id="scatter-title">Ratings and reading-list counts for sampled novels</title>
            <desc id="scatter-desc">Horizontal position represents reading-list count on a logarithmic scale. Vertical position represents published rating from zero to five.</desc>
            <line x1="52" y1="260" x2="740" y2="260" /><line x1="52" y1="20" x2="52" y2="260" />
            {scatter.map((detail) => {
              const x = 52 + (Math.log10(detail.reading_list_count + 1) / Math.log10(maxReaders + 1)) * 688;
              const y = 260 - (detail.rating / 5) * 230;
              return <circle key={detail.id} cx={x} cy={y} r="6" className={hiddenGem(detail) ? 'hidden-gem' : ''}
                tabIndex={0} role="button" aria-label={`${detail.title}: rating ${detail.rating}, ${detail.reading_list_count} readers${hiddenGem(detail) ? ', potential hidden gem' : ''}`}
                onClick={() => onOpenNovel(detail.id)} onKeyDown={(event) => (event.key === 'Enter' || event.key === ' ') && onOpenNovel(detail.id)} />;
            })}
          </svg>
          <div className="analytics-table-wrap"><table><caption>Plotted novel data</caption><thead><tr><th>Novel</th><th>Rating</th><th>Readers</th><th>Classification</th></tr></thead><tbody>
            {scatter.map((detail) => <tr key={detail.id}><th><button onClick={() => onOpenNovel(detail.id)}>{detail.title}</button></th><td>{detail.rating}</td><td>{detail.reading_list_count.toLocaleString()}</td><td>{hiddenGem(detail) ? 'Potential hidden gem' : 'Other sample title'}</td></tr>)}
          </tbody></table></div>
        </article>
      </>}
    </section>
  );
}
