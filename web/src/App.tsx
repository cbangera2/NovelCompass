import { useState, useEffect, FormEvent, useMemo, useRef } from 'react';
import {
  BookOpen,
  ExternalLink,
  Heart,
  Search,
  SlidersHorizontal,
  Sparkles,
  Star,
  Users,
  X
} from 'lucide-react';
import {
  DatasetManifest,
  RecommendResponse,
  RecommendRequest,
  Recommendation,
  NovelDetail,
  NovelSearchResult
} from './types';
import {
  configuredDataMode,
  createDataSource,
  DataMode,
  RecommendationDataSource
} from './data';
import { LocalUserProfile, ProfileEntry, ProfilePanel } from './profile';
import { browseFacetUrl } from './metadataLinks';

const DEFAULT_NOVEL: NovelSearchResult = {
  id: 5,
  title: 'Coiling Dragon',
  slug: 'coiling-dragon',
  novelupdates_url: 'https://www.novelupdates.com/?p=5',
  author: 'I Eat Tomatoes',
  rating: 4.5,
  rating_votes: 1912
};

export default function App(): JSX.Element {
  const searchSectionRef = useRef<HTMLElement>(null);
  const detailRequestRef = useRef(0);
  const dataSourceRef = useRef<RecommendationDataSource | null>(null);
  const [dataSource, setDataSource] = useState<RecommendationDataSource | null>(null);
  const [dataMode, setDataMode] = useState<DataMode>(configuredDataMode());
  const [dataset, setDataset] = useState<DatasetManifest | null>(null);
  const [query, setQuery] = useState(DEFAULT_NOVEL.title);
  const [selectedNovel, setSelectedNovel] = useState<NovelSearchResult | null>(DEFAULT_NOVEL);
  const [suggestions, setSuggestions] = useState<NovelSearchResult[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);

  const [hiddenGemMode, setHiddenGemMode] = useState(false);
  const [excludeHarem, setExcludeHarem] = useState(false);
  const [excludeBL, setExcludeBL] = useState(false);
  const [excludeYuri, setExcludeYuri] = useState(false);
  const [requireCompleted, setRequireCompleted] = useState(false);
  const [language, setLanguage] = useState('');
  const [minRating, setMinRating] = useState(0);
  const [minRatingVotes, setMinRatingVotes] = useState(0);
  const [maxReaders, setMaxReaders] = useState(0);
  const [minYear, setMinYear] = useState(0);
  const [maxYear, setMaxYear] = useState(0);
  const [genreStates, setGenreStates] = useState<Record<string, 'include' | 'exclude'>>({});
  const [includeTagsText, setIncludeTagsText] = useState('');
  const [excludeTagsText, setExcludeTagsText] = useState('');
  const [tagWeight, setTagWeight] = useState(0.8);
  const [directRecWeight, setDirectRecWeight] = useState(1.2);
  const [listWeight, setListWeight] = useState(1);
  const [structuralWeight, setStructuralWeight] = useState(0.6);
  const [hiddenGemStrength, setHiddenGemStrength] = useState(0.3);
  const [resultLimit, setResultLimit] = useState(30);
  const [genres, setGenres] = useState<string[]>([]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<RecommendResponse | null>(null);
  const [visibleCount, setVisibleCount] = useState(8);
  const [activeDetailId, setActiveDetailId] = useState<number | null>(null);
  const [detail, setDetail] = useState<NovelDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailEvidence, setDetailEvidence] = useState<string[]>([]);
  const [profile, setProfile] = useState<LocalUserProfile | null>(null);
  const [hideLibraryTitles, setHideLibraryTitles] = useState(false);

  useEffect(() => {
    let cancelled = false;
    dataSourceRef.current = null;
    setDataSource(null);
    setDataset(null);
    setData(null);
    setError(null);
    createDataSource(dataMode)
      .then(async (source) => {
        const [manifest, options] = await Promise.all([source.getManifest(), source.getOptions()]);
        if (cancelled) return;
        dataSourceRef.current = source;
        setDataSource(source);
        setDataset(manifest);
        setGenres(options.genres || []);
      })
      .catch((initializationError: any) => {
        if (!cancelled) setError(initializationError.message || 'Could not load a recommendation dataset.');
      });
    return () => { cancelled = true; };
  }, [dataMode]);

  useEffect(() => {
    if (!dataSource) return;
    const trimmed = query.trim();
    if (
      trimmed.length < 2 ||
      (selectedNovel && trimmed === selectedNovel.title)
    ) {
      setSuggestions([]);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const results = await dataSource.searchNovels(trimmed, 8, controller.signal);
        setSuggestions(results);
        setShowSuggestions(true);
      } catch (searchError: any) {
        if (searchError.name !== 'AbortError') setSuggestions([]);
      }
    }, 180);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, selectedNovel, dataSource]);

  const fetchRecommendations = async (novel: NovelSearchResult | null = selectedNovel) => {
    const source = dataSourceRef.current;
    if (!source) return;
    const requestedQuery = novel ? String(novel.id) : selectedNovel ? String(selectedNovel.id) : query.trim();
    if (!requestedQuery) return;

    setLoading(true);
    setError(null);
    setShowSuggestions(false);
    try {
      const payload: RecommendRequest = {
        query: requestedQuery,
        limit: resultLimit,
        hidden_gem_mode: hiddenGemMode,
        exclude_harem: excludeHarem,
        exclude_bl: excludeBL,
        exclude_yuri: excludeYuri,
        require_completed: requireCompleted,
        language,
        min_rating: minRating,
        min_rating_votes: minRatingVotes,
        max_readers: maxReaders,
        min_year: minYear,
        max_year: maxYear,
        include_genres: Object.entries(genreStates).filter(([, state]) => state === 'include').map(([genre]) => genre),
        exclude_genres: Object.entries(genreStates).filter(([, state]) => state === 'exclude').map(([genre]) => genre),
        include_tags: includeTagsText.split(',').map((tag) => tag.trim()).filter(Boolean),
        exclude_tags: excludeTagsText.split(',').map((tag) => tag.trim()).filter(Boolean),
        channel_weights: {
          tag: tagWeight,
          direct_rec: directRecWeight,
          rec_list: listWeight,
          structural: structuralWeight
        },
        hidden_gem_strength: hiddenGemStrength
      };

      const json = await source.getRecommendations(payload);
      setData(json);
      setVisibleCount(8);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch recommendations.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!dataSource) return;
    const seedId = Number(new URLSearchParams(window.location.search).get('seed'));
    if (Number.isInteger(seedId) && seedId > 0) {
      dataSource.getNovel(seedId)
        .then((detail) => {
          const seed: NovelSearchResult = {
            id: detail.id,
            title: detail.title,
            slug: detail.slug,
            novelupdates_url: detail.novelupdates_url,
            author: detail.author || '',
            cover_url: detail.cover_url,
            rating: detail.rating,
            rating_votes: detail.rating_votes
          };
          chooseNovel(seed);
          return fetchRecommendations(seed);
        })
        .catch(() => fetchRecommendations(DEFAULT_NOVEL));
    } else {
      fetchRecommendations(DEFAULT_NOVEL);
    }
    // Load the initial recommendation set once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataSource]);

  const chooseNovel = (novel: NovelSearchResult) => {
    setSelectedNovel(novel);
    setQuery(novel.title);
    setSuggestions([]);
    setShowSuggestions(false);
  };

  const useProfileEntryAsSeed = async (entry: ProfileEntry) => {
    const source = dataSourceRef.current;
    if (!source) return;
    setLoading(true);
    try {
      const resolved = await source.resolveSlugs([{ slug: entry.slug, title: entry.imported_title }]);
      const novel = resolved.get(entry.slug);
      if (!novel) throw new Error('This title is not available in the active dataset.');
      chooseNovel(novel);
      window.requestAnimationFrame(() => searchSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
      await fetchRecommendations(novel);
    } catch (profileError: any) {
      setError(profileError.message || 'Could not use that profile title as a seed.');
      setLoading(false);
    }
  };

  const profileEntries = useMemo(() => new Map(profile?.entries.map((entry) => [entry.novel_id, entry]) || []), [profile]);

  const openNovelDetail = async (novel: Recommendation) => {
    const source = dataSourceRef.current;
    if (!source) return;
    const requestId = ++detailRequestRef.current;
    setActiveDetailId(novel.target_id);
    setDetail(null);
    setDetailEvidence(novel.evidence_bullets);
    setDetailError(null);
    setDetailLoading(true);
    try {
      const body = await source.getNovel(novel.target_id);
      if (detailRequestRef.current === requestId) setDetail(body);
    } catch (detailFetchError: any) {
      if (detailRequestRef.current === requestId) {
        setDetailError(detailFetchError.message || 'Could not load this novel.');
      }
    } finally {
      if (detailRequestRef.current === requestId) setDetailLoading(false);
    }
  };

  const closeNovelDetail = () => {
    detailRequestRef.current += 1;
    setActiveDetailId(null);
    setDetail(null);
    setDetailError(null);
  };

  const recommendFromDetail = () => {
    if (!detail) return;
    const nextSeed: NovelSearchResult = {
      id: detail.id,
      title: detail.title,
      slug: detail.slug,
      novelupdates_url: detail.novelupdates_url,
      author: detail.author || '',
      cover_url: detail.cover_url,
      rating: detail.rating,
      rating_votes: detail.rating_votes
    };
    chooseNovel(nextSeed);
    closeNovelDetail();
    window.requestAnimationFrame(() => {
      searchSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    fetchRecommendations(nextSeed);
  };

  useEffect(() => {
    if (activeDetailId === null) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeNovelDetail();
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [activeDetailId]);

  const handleSearch = (e: FormEvent) => {
    e.preventDefault();
    fetchRecommendations();
  };

  const cycleGenre = (genre: string) => {
    setGenreStates((current) => {
      const next = { ...current };
      if (!next[genre]) next[genre] = 'include';
      else if (next[genre] === 'include') next[genre] = 'exclude';
      else delete next[genre];
      return next;
    });
  };

  const resetAdvanced = () => {
    setMinRatingVotes(0);
    setMaxReaders(0);
    setMinYear(0);
    setMaxYear(0);
    setGenreStates({});
    setIncludeTagsText('');
    setExcludeTagsText('');
    setTagWeight(0.8);
    setDirectRecWeight(1.2);
    setListWeight(1);
    setStructuralWeight(0.6);
    setHiddenGemStrength(0.3);
  };

  return (
    <div className="app-container">
      <header className="header">
        <div className="brand-mark"><Sparkles size={18} aria-hidden="true" /></div>
        <div>
          <div className="eyebrow">Relationship-first discovery</div>
          <h1>Find your next obsession.</h1>
          <p>Start with a novel you loved. We trace shared tropes, reader recommendations, and curated lists to find what belongs beside it.</p>
          <div className="dataset-controls">
            {dataSource && (
              <span className="dataset-badge" title={dataset?.dataset_version}>
                {dataSource.mode === 'api' ? 'Live database' : 'Static snapshot'}
                {dataset?.generated_at ? ` · ${new Date(dataset.generated_at).toLocaleDateString()}` : ''}
              </span>
            )}
            <label className="data-mode-select">
              <span>Data source</span>
              <select
                value={dataMode}
                onChange={(event) => setDataMode(event.target.value as DataMode)}
                aria-label="Recommendation data source"
              >
                <option value="auto">Automatic</option>
                <option value="api">Live API</option>
                <option value="static">Static snapshot</option>
              </select>
            </label>
            <ProfilePanel
              source={dataSource}
              dataset={dataset}
              profile={profile}
              onProfileChange={setProfile}
              onUseSeed={useProfileEntryAsSeed}
            />
          </div>
        </div>
      </header>

      <section className="search-section" ref={searchSectionRef}>
        <form onSubmit={handleSearch} className="search-input-wrapper">
          <Search className="search-icon" size={20} aria-hidden="true" />
          <div className="search-field">
            <label htmlFor="novel-search">Seed novel</label>
            <input
              id="novel-search"
              type="text"
              autoComplete="off"
              placeholder="Search title or alternate name..."
              value={query}
              onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
              onChange={(e) => {
                setQuery(e.target.value);
                setSelectedNovel(null);
              }}
            />
          </div>
          <button type="submit" className="search-button" disabled={loading || !dataSource}>
            {!dataSource ? 'Loading dataset…' : loading ? 'Finding matches…' : <><Sparkles size={16} aria-hidden="true" /> Find related</>}
          </button>
        </form>

        {showSuggestions && suggestions.length > 0 && (
          <div className="suggestions" role="listbox" aria-label="Novel matches">
            {suggestions.map((novel) => (
              <button
                type="button"
                className="suggestion"
                key={novel.id}
                onClick={() => chooseNovel(novel)}
              >
                <CoverImage src={novel.cover_url} alt="" variant="suggestion" />
                <span className="suggestion-copy">
                  <strong>{novel.title}</strong>
                  <small>{novel.author || 'Unknown author'} · ★ {novel.rating || '—'} ({novel.rating_votes} votes)</small>
                </span>
                <span className="select-label">Use this</span>
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="controls" aria-label="Recommendation controls">
        {profile && (
          <div className="control-group">
            <span className="control-heading">My library</span>
            <label className="filter-toggle">
              <input type="checkbox" checked={hideLibraryTitles} onChange={(e) => setHideLibraryTitles(e.target.checked)} />
              Hide imported titles
            </label>
          </div>
        )}
        <div className="control-group">
          <span className="control-heading">Boost</span>
          <label className="filter-toggle">
            <input type="checkbox" checked={hiddenGemMode} onChange={(e) => setHiddenGemMode(e.target.checked)} />
            Hidden-gem boost
          </label>
          <label className="filter-toggle">
            <input type="checkbox" checked={requireCompleted} onChange={(e) => setRequireCompleted(e.target.checked)} />
            Completed only
          </label>
        </div>

        <div className="control-group">
          <span className="control-heading">Exclude</span>
          <label className="filter-toggle">
            <input type="checkbox" checked={excludeHarem} onChange={(e) => setExcludeHarem(e.target.checked)} />
            Harem
          </label>
          <label className="filter-toggle">
            <input type="checkbox" checked={excludeBL} onChange={(e) => setExcludeBL(e.target.checked)} />
            BL
          </label>
          <label className="filter-toggle">
            <input type="checkbox" checked={excludeYuri} onChange={(e) => setExcludeYuri(e.target.checked)} />
            Yuri
          </label>
        </div>

        <div className="control-group select-controls">
          <label>
            <span className="control-heading">Language</span>
            <select value={language} onChange={(e) => setLanguage(e.target.value)}>
              <option value="">Any</option>
              <option value="korean">Korean</option>
              <option value="chinese">Chinese</option>
              <option value="japanese">Japanese</option>
            </select>
          </label>
          <label>
            <span className="control-heading">Minimum rating</span>
            <select value={minRating} onChange={(e) => setMinRating(Number(e.target.value))}>
              <option value="0">Any</option>
              <option value="3.5">3.5+</option>
              <option value="4">4.0+</option>
              <option value="4.3">4.3+</option>
            </select>
          </label>
          <label>
            <span className="control-heading">Results</span>
            <select value={resultLimit} onChange={(e) => setResultLimit(Number(e.target.value))}>
              <option value="12">12</option>
              <option value="20">20</option>
              <option value="30">30</option>
            </select>
          </label>
        </div>
      </section>

      <details className="advanced-panel">
        <summary>
          <span>
            <strong><SlidersHorizontal size={16} aria-hidden="true" /> Advanced filters & ranking</strong>
            <small>Genres, tags, catalog thresholds, and algorithm weights</small>
          </span>
          <span className="summary-action">Customize</span>
        </summary>

        <div className="advanced-content">
          <section className="advanced-section">
            <div className="section-heading">
              <div>
                <h3>Genres</h3>
                <p>Click once to require, twice to exclude, three times to clear.</p>
              </div>
            </div>
            <div className="genre-chips">
              {genres.map((genre) => (
                <button
                  type="button"
                  key={genre}
                  className={`genre-chip ${genreStates[genre] || ''}`}
                  onClick={() => cycleGenre(genre)}
                >
                  {genreStates[genre] === 'include' ? '+ ' : genreStates[genre] === 'exclude' ? '− ' : ''}
                  {genre}
                </button>
              ))}
            </div>
          </section>

          <section className="advanced-section">
            <div className="section-heading">
              <div>
                <h3>Tags and catalog limits</h3>
                <p>Comma-separate exact Novel Updates tags.</p>
              </div>
            </div>
            <div className="advanced-grid">
              <label>
                Required tags
                <input value={includeTagsText} onChange={(e) => setIncludeTagsText(e.target.value)} placeholder="cunning protagonist, time loop" />
              </label>
              <label>
                Excluded tags
                <input value={excludeTagsText} onChange={(e) => setExcludeTagsText(e.target.value)} placeholder="netorare, dense protagonist" />
              </label>
              <label>
                Minimum rating votes
                <input type="number" min="0" value={minRatingVotes || ''} onChange={(e) => setMinRatingVotes(Number(e.target.value))} placeholder="Any" />
              </label>
              <label>
                Maximum readers
                <input type="number" min="0" value={maxReaders || ''} onChange={(e) => setMaxReaders(Number(e.target.value))} placeholder="Any" />
              </label>
              <label>
                Earliest year
                <input type="number" min="1900" max="2100" value={minYear || ''} onChange={(e) => setMinYear(Number(e.target.value))} placeholder="Any" />
              </label>
              <label>
                Latest year
                <input type="number" min="1900" max="2100" value={maxYear || ''} onChange={(e) => setMaxYear(Number(e.target.value))} placeholder="Any" />
              </label>
            </div>
          </section>

          <section className="advanced-section">
            <div className="section-heading">
              <div>
                <h3>Relationship recipe</h3>
                <p>Change which evidence sources matter most. Defaults are balanced for human signals.</p>
              </div>
              <button type="button" className="reset-button" onClick={resetAdvanced}>Reset defaults</button>
            </div>
            <div className="weight-grid">
              <WeightControl label="Shared tropes" hint="Tag overlap weighted by specificity" value={tagWeight} onChange={setTagWeight} />
              <WeightControl label="Direct recommendations" hint="Novel-to-novel human votes" value={directRecWeight} onChange={setDirectRecWeight} />
              <WeightControl label="Curated lists" hint="Co-occurrence on recommendation lists" value={listWeight} onChange={setListWeight} />
              <WeightControl label="Author & related series" hint="Same author, sequels, shared universe" value={structuralWeight} onChange={setStructuralWeight} />
              <WeightControl label="Hidden-gem strength" hint="How strongly to favor lower readership" value={hiddenGemStrength} onChange={setHiddenGemStrength} max={1} />
            </div>
          </section>
        </div>
      </details>

      {error && <div className="error-message">{error}</div>}

      {data && (
        <main>
          <div className="results-heading">
            <CoverImage src={data.seed_novel.cover_url} alt="" variant="seed" />
            <div className="results-heading-copy">
              <span className="eyebrow">Based on your seed novel</span>
              <h2>
                <a href={data.seed_novel.novelupdates_url} target="_blank" rel="noopener noreferrer">
                  {data.seed_novel.title}<ExternalLink size={15} aria-hidden="true" />
                </a>
              </h2>
              <p><span>{data.count}</span> evidence-backed matches, ranked for fit</p>
            </div>
          </div>

          <div className="results-grid">
            {data.recommendations
              .filter((rec) => !hideLibraryTitles || !profileEntries.has(rec.target_id))
              .slice(0, visibleCount).map((rec, index) => (
              <article
                key={rec.target_id || index}
                className="novel-card"
                onClick={(event) => {
                  if (!(event.target as HTMLElement).closest('button, a')) openNovelDetail(rec);
                }}
              >
                <div className="card-content">
                  <div className="card-top">
                    <div className="card-cover">
                      <CoverImage src={rec.cover_url} alt={`Cover of ${rec.title}`} variant="card" />
                      <span className="card-rank">#{index + 1}</span>
                    </div>

                    <div className="card-summary">
                      <div className="card-score"><Sparkles size={12} aria-hidden="true" /> {rec.match_score_percent}% match</div>
                      <h3 className="novel-title">
                        <button type="button" onClick={() => openNovelDetail(rec)}>
                          {rec.title}
                        </button>
                        <a
                          className="card-external-link"
                          href={rec.novelupdates_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={`Open ${rec.title} on Novel Updates`}
                          title="Open on Novel Updates"
                        >
                          <ExternalLink size={14} aria-hidden="true" />
                        </a>
                      </h3>
                      <div className="novel-author">{rec.author || 'Unknown author'}</div>

                      <div className="novel-meta">
                        <span title={`${rec.rating_votes} rating votes`}><Star size={13} fill="currentColor" aria-hidden="true" /> {rec.rating || '—'} <small>({rec.rating_votes})</small></span>
                        <span><Users size={13} aria-hidden="true" /> {rec.reading_list_count.toLocaleString()}</span>
                      </div>
                      <div className="card-badges">
                        {profileEntries.get(rec.target_id) && (
                          <span className={`library-badge status-${profileEntries.get(rec.target_id)?.status}`}>
                            {profileEntries.get(rec.target_id)?.status.replace(/_/g, ' ')}
                            {profileEntries.get(rec.target_id)?.rating ? ` · ${profileEntries.get(rec.target_id)?.rating}★` : ''}
                          </span>
                        )}
                        {rec.language && <span>{rec.language}</span>}
                        {rec.status_trans && <span>{rec.status_trans}</span>}
                      </div>
                      {rec.shared_tags.length > 0 && (
                        <div className="detail-chips card-tag-links">
                          {rec.shared_tags.slice(0, 4).map((tag) => (
                            <a key={tag} href={browseFacetUrl('tag', tag)}>{tag}</a>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="evidence-label">Why it matches</div>
                  <ul className="evidence-list">
                    {rec.evidence_bullets.map((bullet, i) => (
                      <li key={i} className="evidence-item">
                        <span className="evidence-bullet" aria-hidden="true">✓</span>
                        <span>{bullet}</span>
                      </li>
                    ))}
                  </ul>

                  <div className="feedback-actions">
                    <button className="btn-feedback" onClick={() => useProfileEntryAsSeed({
                      novel_id: rec.target_id,
                      slug: rec.slug,
                      imported_title: rec.title,
                      status: profileEntries.get(rec.target_id)?.status || 'reading',
                      source_file: 'recommendation'
                    })}><Sparkles size={14} aria-hidden="true" /> Use as seed</button>
                    <button className="btn-feedback" onClick={() => alert(`Marked ${rec.title} as loved`)}><Heart size={14} aria-hidden="true" /> Love</button>
                    <button className="btn-feedback" onClick={() => alert(`Marked ${rec.title} as read`)}><BookOpen size={14} aria-hidden="true" /> Read</button>
                    <button className="btn-feedback" onClick={() => alert(`Excluded ${rec.title}`)}><X size={14} aria-hidden="true" /> Not for me</button>
                  </div>
                </div>
              </article>
            ))}
          </div>

          {visibleCount < data.recommendations.length && (
            <div className="load-more-row">
              <button
                type="button"
                className="load-more-button"
                onClick={() => setVisibleCount((count) => count + 8)}
              >
                Load 8 more
              </button>
              <span>Showing {visibleCount} of {data.recommendations.length}</span>
            </div>
          )}
        </main>
      )}

      {activeDetailId !== null && (
        <NovelDetailDialog
          detail={detail}
          loading={detailLoading}
          error={detailError}
          evidence={detailEvidence}
          onClose={closeNovelDetail}
          onRecommend={recommendFromDetail}
          profileEntry={detail ? profileEntries.get(detail.id) : undefined}
        />
      )}
    </div>
  );
}

function NovelDetailDialog({
  detail,
  loading,
  error,
  evidence,
  onClose,
  onRecommend,
  profileEntry
}: {
  detail: NovelDetail | null;
  loading: boolean;
  error: string | null;
  evidence: string[];
  onClose: () => void;
  onRecommend: () => void;
  profileEntry?: ProfileEntry;
}) {
  return (
    <div className="detail-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section
        className="detail-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={detail ? 'novel-detail-title' : undefined}
        aria-label={detail ? undefined : 'Novel details'}
        aria-busy={loading}
      >
        <button type="button" className="detail-close" onClick={onClose} aria-label="Close novel details" autoFocus>
          <X size={20} aria-hidden="true" />
        </button>

        {loading && <div className="detail-state"><Sparkles size={22} aria-hidden="true" /> Loading novel details…</div>}
        {error && <div className="detail-state detail-error">{error}</div>}

        {detail && (
          <>
            <div className="detail-hero">
              <CoverImage src={detail.cover_url} alt={`Cover of ${detail.title}`} variant="detail" />
              <div className="detail-heading">
                <span className="eyebrow">{detail.language || 'Web novel'}{detail.year ? ` · ${detail.year}` : ''}</span>
                <h2 id="novel-detail-title">{detail.title}</h2>
                <p className="detail-author">{detail.author || 'Unknown author'}</p>
                {profileEntry && <span className={`detail-library-badge status-${profileEntry.status}`}>
                  In your library · {profileEntry.status.replace(/_/g, ' ')}
                  {profileEntry.rating ? ` · ${profileEntry.rating}★` : ''}
                  {profileEntry.progress ? ` · ${profileEntry.progress}` : ''}
                </span>}
                <div className="detail-stats">
                  <span><Star size={15} fill="currentColor" aria-hidden="true" /> {detail.rating || '—'} <small>{detail.rating_votes.toLocaleString()} votes</small></span>
                  <span><Users size={15} aria-hidden="true" /> {detail.reading_list_count.toLocaleString()} readers</span>
                  {(detail.status_trans || detail.chapters_trans > 0 || detail.chapters_orig > 0) && (
                    <span><BookOpen size={15} aria-hidden="true" /> {[
                      detail.status_trans,
                      detail.chapters_trans > 0 ? `${detail.chapters_trans} translated` : '',
                      detail.chapters_orig > 0 ? `${detail.chapters_orig} original` : ''
                    ].filter(Boolean).join(' · ')}</span>
                  )}
                </div>
                <div className="detail-actions">
                  <button type="button" className="detail-recommend-button" onClick={onRecommend}>
                    <Sparkles size={16} aria-hidden="true" /> Find recommendations like this
                  </button>
                  <a href={detail.novelupdates_url} target="_blank" rel="noopener noreferrer">
                    View on Novel Updates <ExternalLink size={15} aria-hidden="true" />
                  </a>
                </div>
              </div>
            </div>

            <div className="detail-body">
              {detail.genres.length > 0 && (
                <section className="detail-section">
                  <h3>Genres</h3>
                  <div className="detail-chips">{detail.genres.map((genre) => <a key={genre} href={browseFacetUrl('genre', genre)}>{genre}</a>)}</div>
                </section>
              )}
              {detail.synopsis && (
                <section className="detail-section">
                  <h3>Synopsis</h3>
                  <p className="detail-synopsis">{detail.synopsis}</p>
                </section>
              )}
              {evidence.length > 0 && (
                <section className="detail-section">
                  <h3>Why it matched your seed</h3>
                  <ul className="evidence-list detail-evidence">
                    {evidence.map((item, index) => (
                      <li key={index} className="evidence-item">
                        <span className="evidence-bullet" aria-hidden="true">✓</span><span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {detail.tags.length > 0 && (
                <section className="detail-section">
                  <h3>Tags</h3>
                  <div className="detail-chips detail-tags">{detail.tags.map((tag) => <a key={tag} href={browseFacetUrl('tag', tag)}>{tag}</a>)}</div>
                </section>
              )}
              {detail.associated_names.length > 0 && (
                <section className="detail-section">
                  <h3>Also known as</h3>
                  <p>{detail.associated_names.join(' · ')}</p>
                </section>
              )}
              <section className="detail-section detail-signals">
                <h3>Discovery signals</h3>
                <div>
                  <span><strong>{detail.direct_recommendation_count}</strong> direct recommendations</span>
                  <span><strong>{detail.recommendation_list_count}</strong> curated lists</span>
                  <span><strong>{detail.related_series_count}</strong> related series</span>
                </div>
              </section>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function CoverImage({
  src,
  alt,
  variant
}: {
  src?: string;
  alt: string;
  variant: 'suggestion' | 'seed' | 'card' | 'detail';
}) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <span className={`cover-fallback cover-${variant}`}>
        <span>NU</span>
      </span>
    );
  }
  return (
    <img
      className={`cover-${variant}`}
      src={src}
      alt={alt}
      loading={variant === 'card' ? 'lazy' : 'eager'}
      onError={() => setFailed(true)}
    />
  );
}

function WeightControl({
  label,
  hint,
  value,
  onChange,
  max = 2
}: {
  label: string;
  hint: string;
  value: number;
  onChange: (value: number) => void;
  max?: number;
}) {
  return (
    <label className="weight-control">
      <span><strong>{label}</strong><small>{hint}</small></span>
      <span className="range-row">
        <input
          type="range"
          min="0"
          max={max}
          step="0.1"
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        <output>{value.toFixed(1)}×</output>
      </span>
    </label>
  );
}
