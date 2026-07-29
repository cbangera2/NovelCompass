import type { SeriesSectionState } from '../ExtensionSeriesApp';

export interface SimilarNovel {
  id: string;
  title: string;
  url: string;
  score?: number;
  reason?: string;
  genres?: string[];
}

export interface SimilarNovelsProps {
  state: SeriesSectionState<SimilarNovel[]>;
  onNavigate: (url: string) => void;
}

export function SimilarNovels({ state, onNavigate }: SimilarNovelsProps): JSX.Element {
  if (state.status === 'loading') {
    return (
      <div className="series-section-status" role="status" aria-live="polite">
        <p>Finding similar novels with Novel Compass…</p>
      </div>
    );
  }
  if (state.status === 'unavailable') {
    return (
      <div className="series-section-status" role="alert">
        <p>{state.message ?? 'Novel Compass recommendations are unavailable.'}</p>
        <small>Live Novel Updates chapters and metadata still work.</small>
      </div>
    );
  }

  return (
    <section className="series-section-card" aria-labelledby="similar-heading">
      <header className="series-section-heading">
        <div>
          <p className="series-eyebrow">Novel Compass matches</p>
          <h2 id="similar-heading">You may also like</h2>
        </div>
      </header>
      {state.data.length ? (
        <div className="similar-grid">
          {state.data.map((novel) => (
            <article className="similar-card" key={novel.id}>
              <div>
                <h3>{novel.title}</h3>
                {novel.score !== undefined ? (
                  <span>{Math.round(novel.score * 100)}% match</span>
                ) : null}
              </div>
              {novel.reason ? <p>{novel.reason}</p> : null}
              {novel.genres?.length ? (
                <p className="similar-genres">{novel.genres.join(' · ')}</p>
              ) : null}
              <button onClick={() => onNavigate(novel.url)} type="button">
                View on Novel Updates
              </button>
            </article>
          ))}
        </div>
      ) : (
        <div className="series-empty-state">
          <h3>No confident matches yet</h3>
          <p>Try the full Novel Compass finder for broader discovery.</p>
        </div>
      )}
    </section>
  );
}
