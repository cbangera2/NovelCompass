import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { BookOpen, ExternalLink, Search, ShieldCheck, Sparkles, X } from 'lucide-react';
import { configuredDataMode, createDataSource, RecommendationDataSource } from '../data';
import { DatasetManifest, NovelDetail, NovelSearchResult } from '../types';
import { ProfilePanel } from './ProfilePanel';
import { loadLocalProfile } from './store';
import { LocalUserProfile, ProfileEntry, ReadingStatus } from './types';
import { displayNovelTitle, useDisplaySettings } from '../settings';
import { browseFacetUrl } from '../metadataLinks';
const ProfileAnalytics = lazy(() => import('./ProfileAnalytics'));

const STATUS_LABELS: Record<ReadingStatus, string> = {
  reading: 'Reading',
  completed: 'Completed',
  plan_to_read: 'Plan to read'
};

function appUrl(params = ''): string {
  return `${import.meta.env.BASE_URL}${params}`;
}

export default function ProfilePage(): JSX.Element {
  const { settings } = useDisplaySettings();
  const [profile, setProfile] = useState<LocalUserProfile | null>(null);
  const [source, setSource] = useState<RecommendationDataSource | null>(null);
  const [dataset, setDataset] = useState<DatasetManifest | null>(null);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'all' | ReadingStatus>('all');
  const [rating, setRating] = useState(0);
  const [visibleLibraryCount, setVisibleLibraryCount] = useState(60);
  const [libraryCatalog, setLibraryCatalog] = useState<Map<string, NovelSearchResult>>(new Map());
  const [activeDetail, setActiveDetail] = useState<NovelDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [taste, setTaste] = useState<{
    details: NovelDetail[];
    requested: number;
    failed: number;
    genres: Array<[string, number]>;
    tags: Array<[string, number]>;
  } | null>(null);
  const [tasteLoading, setTasteLoading] = useState(false);

  useEffect(() => {
    loadLocalProfile().then(setProfile);
    createDataSource(configuredDataMode()).then(async (next) => {
      setSource(next);
      setDataset(await next.getManifest());
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!profile || !source) {
      setTaste(null);
      setTasteLoading(false);
      return;
    }
    const rated = profile.entries
      .filter((entry) => entry.novel_id != null && entry.rating != null)
      .sort((a, b) => (b.rating || 0) - (a.rating || 0));
    const completed = profile.entries.filter((entry) => entry.novel_id != null && entry.status === 'completed');
    const selected = [...rated, ...completed]
      .filter((entry, index, entries) => entries.findIndex((item) => item.novel_id === entry.novel_id) === index)
      .slice(0, 12);
    if (!selected.length) {
      setTaste({ details: [], requested: 0, failed: 0, genres: [], tags: [] });
      setTasteLoading(false);
      return;
    }
    let cancelled = false;
    setTasteLoading(true);
    Promise.allSettled(selected.map((entry) => source.getNovel(entry.novel_id!))).then((results) => {
      if (cancelled) return;
      const details = results.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []);
      const count = (values: string[]) => {
        const totals = new Map<string, number>();
        values.forEach((value) => totals.set(value, (totals.get(value) || 0) + 1));
        return [...totals.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
      };
      setTaste({
        details,
        requested: selected.length,
        failed: results.length - details.length,
        genres: count(details.flatMap((detail) => detail.genres)).slice(0, 8),
        tags: count(details.flatMap((detail) => detail.tags)).slice(0, 12)
      });
      setTasteLoading(false);
    });
    return () => { cancelled = true; };
  }, [profile, source]);

  const counts = useMemo(() => {
    const next: Record<ReadingStatus, number> = { reading: 0, completed: 0, plan_to_read: 0 };
    profile?.entries.forEach((entry) => { next[entry.status] += 1; });
    return next;
  }, [profile]);

  const entries = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return (profile?.entries || [])
      .filter((entry) => status === 'all' || entry.status === status)
      .filter((entry) => !rating || (entry.rating || 0) >= rating)
      .filter((entry) => !needle || entry.imported_title.toLocaleLowerCase().includes(needle) || entry.slug.includes(needle))
      .sort((a, b) => (b.rating || 0) - (a.rating || 0) || a.imported_title.localeCompare(b.imported_title));
  }, [profile, query, rating, status]);
  const visibleEntries = entries.slice(0, visibleLibraryCount);

  useEffect(() => {
    setVisibleLibraryCount(60);
  }, [query, rating, status]);

  useEffect(() => {
    if (!source || !visibleEntries.length) {
      setLibraryCatalog(new Map());
      return;
    }
    let cancelled = false;
    source.resolveSlugs(visibleEntries.filter((entry) => entry.novel_id != null).map((entry) => ({
      slug: entry.slug,
      title: entry.imported_title
    }))).then((resolved) => {
      if (!cancelled) setLibraryCatalog(resolved);
    }).catch(() => {
      if (!cancelled) setLibraryCatalog(new Map());
    });
    return () => { cancelled = true; };
  }, [source, visibleLibraryCount, query, rating, status, profile]);

  const useSeed = (entry: ProfileEntry) => {
    if (entry.novel_id == null) return;
    window.location.href = appUrl(`?seed=${entry.novel_id}`);
  };

  const openLibraryDetail = async (entry: ProfileEntry) => {
    if (entry.novel_id == null) return;
    openDetailById(entry.novel_id);
  };

  const openDetailById = async (novelId: number) => {
    if (!source) return;
    setDetailLoading(true);
    setDetailError('');
    setActiveDetail(null);
    try {
      setActiveDetail(await source.getNovel(novelId));
    } catch (error: any) {
      setDetailError(error.message || 'Details are unavailable in this dataset.');
    } finally {
      setDetailLoading(false);
    }
  };

  useEffect(() => {
    if (!activeDetail && !detailLoading && !detailError) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setActiveDetail(null);
        setDetailError('');
      }
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [activeDetail, detailError, detailLoading]);

  return (
    <div className="profile-page">
      <header className="profile-page-hero">
        <div>
          <span className="eyebrow">Your reading world</span>
          <h1>{profile?.username ? `${profile.username}'s library` : 'Your local library'}</h1>
          <p>Stored only in this browser. This is a private recommender profile, not a Novel Updates login or connected account.</p>
        </div>
        <ProfilePanel source={source} dataset={dataset} profile={profile} onProfileChange={setProfile} onUseSeed={useSeed} showPageLink={false} />
      </header>

      <a className="profile-settings-link" href={`${import.meta.env.BASE_URL}?view=settings`}>
        Appearance and title settings <span>Theme · title fallback · local only</span>
      </a>

      {!profile ? (
        <>
          <section className="profile-empty">
            <BookOpen size={30} />
            <h2>Bring your reading history into discovery</h2>
            <p>Use “Import my library” above to preview saved Novel Updates profile pages before anything is stored. The page stays entirely local to this browser.</p>
            <ProfilePanel source={source} dataset={dataset} profile={profile} onProfileChange={setProfile} onUseSeed={useSeed} showPageLink={false} />
          </section>
          <section className="profile-empty-features" aria-label="Local profile features">
            <article><span>01</span><h3>Library</h3><p>Search Reading, Completed, and Plan-to-read titles with ratings and progress.</p></article>
            <article><span>02</span><h3>Taste snapshot</h3><p>See recurring genres and tags with the exact contributing sample disclosed.</p></article>
            <article><span>03</span><h3>Created lists</h3><p>Keep list summaries visible without pretending their membership was imported.</p></article>
            <article><span>04</span><h3>Local controls</h3><p>Merge, replace, export, or completely delete your normalized profile data.</p></article>
          </section>
        </>
      ) : (
        <>
          <section className="profile-page-stats">
            <div><strong>{profile.entries.length.toLocaleString()}</strong><span>Total titles</span></div>
            <div><strong>{counts.reading.toLocaleString()}</strong><span>Reading</span></div>
            <div><strong>{counts.completed.toLocaleString()}</strong><span>Completed</span></div>
            <div><strong>{counts.plan_to_read.toLocaleString()}</strong><span>Plan to read</span></div>
            <div><strong>{profile.entries.filter((entry) => entry.novel_id != null).length.toLocaleString()}</strong><span>Matched</span></div>
          </section>

          <Suspense fallback={<section className="profile-analytics"><p className="analytics-state">Loading analytics module…</p></section>}>
            <ProfileAnalytics
              profile={profile}
              source={source}
              datasetVersion={dataset?.dataset_version || profile.dataset_version}
              onOpenNovel={openDetailById}
            />
          </Suspense>

          {(profile.feedback?.length || 0) > 0 && (
            <section className="profile-feedback-summary">
              <div><span className="eyebrow">Explicit local signals</span><h2>Recommendation feedback</h2></div>
              <p>Love is a favorite signal, Read is a local read marker, and Not for me hides that title from recommendation results. None of these edits your Novel Updates account.</p>
              <div>{profile.feedback!.map((item) => (
                <span key={item.novel_id} className={`feedback-${item.signal}`}>
                  {item.title}<strong>{item.signal === 'not_for_me' ? 'Not for me' : item.signal === 'love' ? 'Loved' : 'Read'}</strong>
                </span>
              ))}</div>
            </section>
          )}

          <section className="profile-control-strip">
            <div><ShieldCheck size={18} /><span><strong>Private local profile</strong><small>Normalized data stays in IndexedDB on this browser.</small></span></div>
            <ProfilePanel source={source} dataset={dataset} profile={profile} onProfileChange={setProfile} onUseSeed={useSeed} showPageLink={false} />
          </section>

          <section className="taste-snapshot" aria-labelledby="taste-title">
            <div className="profile-library-heading">
              <div><span className="eyebrow">Descriptive, not predictive</span><h2 id="taste-title">Taste snapshot</h2></div>
              <span>{dataset?.dataset_version || profile.dataset_version}</span>
            </div>
            {tasteLoading && <p className="profile-list-note">Loading known genres and tags from your strongest profile signals…</p>}
            {!tasteLoading && taste && taste.requested === 0 && (
              <p className="profile-list-note">Add personal ratings or import Completed titles to create a transparent taste sample.</p>
            )}
            {!tasteLoading && taste && taste.requested > 0 && (
              <>
                <p className="profile-list-note">
                  Based on {taste.details.length} of {taste.requested} selected titles: explicitly rated novels first, then Completed titles.
                  {taste.failed ? ` ${taste.failed} detail file${taste.failed === 1 ? '' : 's'} could not be loaded.` : ''}
                  {' '}This describes recurring metadata; it does not infer dislikes or predict compatibility.
                </p>
                <div className="taste-columns">
                  <div>
                    <h3>Recurring genres</h3>
                    <div className="taste-chips">
                      {taste.genres.map(([genre, count]) => <a key={genre} href={browseFacetUrl('genre', genre)}>{genre}<strong>{count}/{taste.details.length}</strong></a>)}
                      {!taste.genres.length && <small>No genre metadata was available.</small>}
                    </div>
                  </div>
                  <div>
                    <h3>Recurring tags</h3>
                    <div className="taste-chips">
                      {taste.tags.map(([tag, count]) => <a key={tag} href={browseFacetUrl('tag', tag)}>{tag}<strong>{count}/{taste.details.length}</strong></a>)}
                      {!taste.tags.length && <small>No tag metadata was available.</small>}
                    </div>
                  </div>
                </div>
                <details className="taste-sample">
                  <summary>Titles used in this snapshot</summary>
                  <ul>{taste.details.map((detail) => <li key={detail.id}>{displayNovelTitle(detail.title, detail.associated_names, settings.titlePreference)}</li>)}</ul>
                </details>
              </>
            )}
          </section>

          <section className="profile-library-section">
            <div className="profile-library-heading">
              <div><span className="eyebrow">Personal shelf</span><h2>Library</h2></div>
              <span>{entries.length.toLocaleString()} shown</span>
            </div>
            <div className="profile-library-controls">
              <label><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search your library…" /></label>
              <select value={status} onChange={(event) => setStatus(event.target.value as typeof status)}>
                <option value="all">All statuses</option>
                {Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
              <select value={rating} onChange={(event) => setRating(Number(event.target.value))}>
                <option value="0">Any rating</option>
                <option value="3">3★ and up</option>
                <option value="4">4★ and up</option>
                <option value="5">5★ only</option>
              </select>
            </div>
            <div className="profile-entry-grid">
              {visibleEntries.map((entry) => {
                const catalog = libraryCatalog.get(entry.slug);
                return (
                <article key={entry.slug} className={`profile-entry ${entry.novel_id == null ? 'unmatched' : ''}`}>
                  {entry.novel_id != null ? <button className="profile-entry-open" onClick={() => openLibraryDetail(entry)} aria-label={`Open details for ${entry.imported_title}`}>
                  <div className="profile-entry-cover">
                    {catalog?.cover_url
                      ? <img src={catalog.cover_url} alt="" loading="lazy" />
                      : <BookOpen size={18} aria-hidden="true" />}
                  </div>
                  <div>
                    <span className={`profile-status status-${entry.status}`}>{STATUS_LABELS[entry.status]}</span>
                    <h3>{entry.imported_title}</h3>
                    <p>
                      {entry.rating ? `${entry.rating}★` : 'No personal rating'}
                      {entry.progress ? ` · ${entry.progress}` : ''}
                    </p>
                  </div>
                  </button> : <div className="profile-entry-open">
                    <div className="profile-entry-cover"><BookOpen size={18} aria-hidden="true" /></div>
                    <div><span className={`profile-status status-${entry.status}`}>{STATUS_LABELS[entry.status]}</span><h3>{entry.imported_title}</h3><p>{entry.rating ? `${entry.rating}★` : 'No personal rating'}{entry.progress ? ` · ${entry.progress}` : ''}</p></div>
                  </div>}
                  {entry.novel_id != null ? (
                    <a href={appUrl(`?seed=${entry.novel_id}`)}><Sparkles size={14} /> Find similar</a>
                  ) : <span className="profile-unmatched">Not in this snapshot</span>}
                </article>
              )})}
            </div>
            {!entries.length && <p className="profile-no-results">No library titles match those filters.</p>}
            {visibleLibraryCount < entries.length && <button className="profile-load-more" onClick={() => setVisibleLibraryCount((count) => count + 60)}>Show 60 more</button>}
          </section>

          <section className="profile-lists-section">
            <div className="profile-library-heading">
              <div><span className="eyebrow">Saved metadata</span><h2>Created lists</h2></div>
              <span>{profile.curated_lists.length} summaries</span>
            </div>
            <p className="profile-list-note">Saved profile pages include list summaries, not the novels inside each list. Membership badges and personalization are omitted until membership data is available.</p>
            <div className="profile-list-grid">
              {profile.curated_lists.map((list) => (
                <article key={list.id}>
                  <div><h3>{list.title}</h3>{list.is_private && <span>Private</span>}</div>
                  {list.description && <p>{list.description}</p>}
                  <footer>
                    <span>{list.series_count != null ? `${list.series_count} series` : 'Series count unavailable'}</span>
                    {!list.is_private && <a href={`https://www.novelupdates.com/viewlist/${list.id}/`} target="_blank" rel="noopener noreferrer">View summary source <ExternalLink size={13} /></a>}
                  </footer>
                </article>
              ))}
            </div>
          </section>
        </>
      )}
      {(detailLoading || activeDetail || detailError) && (
        <div className="profile-detail-backdrop" onMouseDown={(event) => event.target === event.currentTarget && (setActiveDetail(null), setDetailError(''))}>
          <article className="profile-detail-dialog" role="dialog" aria-modal="true" aria-label="Novel details">
            <button className="detail-close" onClick={() => { setActiveDetail(null); setDetailError(''); }} aria-label="Close details"><X size={18} /></button>
            {detailLoading && <p className="detail-state">Loading details…</p>}
            {detailError && <p className="detail-state detail-error">{detailError}</p>}
            {activeDetail && <>
              <div className="profile-detail-hero">
                {activeDetail.cover_url ? <img src={activeDetail.cover_url} alt="" /> : <span className="profile-detail-cover-fallback"><BookOpen /></span>}
                <div>
                  <span className="eyebrow">{activeDetail.language || 'Web novel'}{activeDetail.year ? ` · ${activeDetail.year}` : ''}</span>
                  <h2>{displayNovelTitle(activeDetail.title, activeDetail.associated_names, settings.titlePreference)}</h2>
                  <p>{activeDetail.author || 'Unknown author'}</p>
                  <div className="detail-actions">
                    <a className="detail-recommend-button" href={appUrl(`?seed=${activeDetail.id}`)}><Sparkles size={15} /> Find similar</a>
                    <a href={activeDetail.novelupdates_url} target="_blank" rel="noopener noreferrer">Novel Updates <ExternalLink size={14} /></a>
                  </div>
                </div>
              </div>
              {activeDetail.synopsis && <p className="profile-detail-synopsis">{activeDetail.synopsis}</p>}
              <div className="detail-chips">{activeDetail.genres.map((genre) => <a key={genre} href={browseFacetUrl('genre', genre)}>{genre}</a>)}</div>
            </>}
          </article>
        </div>
      )}
    </div>
  );
}
