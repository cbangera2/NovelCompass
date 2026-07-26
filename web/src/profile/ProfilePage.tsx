import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { BookOpen, ExternalLink, Search, ShieldCheck, Sparkles } from 'lucide-react';
import { createDataSource, RecommendationDataSource } from '../data';
import { useDataModePreference } from '../dataModePreference';
import { DatasetManifest, NovelDetail, NovelSearchResult } from '../types';
import { ProfilePanel } from './ProfilePanel';
import { loadLocalProfile } from './store';
import { LocalUserProfile, ProfileEntry, ReadingStatus } from './types';
import { computeTasteProfile, TasteProfile } from './taste';
import { displayNovelTitle, useDisplaySettings } from '../settings';
import { novelPageUrl } from '../novelLinks';
import { browseFacetUrl } from '../metadataLinks';
import { Card } from '../design-system';
const ProfileAnalytics = lazy(() => import('./ProfileAnalytics'));

const STATUS_LABELS: Record<ReadingStatus, string> = {
  reading: 'Reading',
  completed: 'Completed',
  plan_to_read: 'Plan to read',
  dropped: 'Dropped',
  paused: 'Paused',
};

function appUrl(params = ''): string {
  return `${import.meta.env.BASE_URL}${params}`;
}

export default function ProfilePage(): JSX.Element {
  const { mode: dataMode } = useDataModePreference();
  const { settings } = useDisplaySettings();
  const [profile, setProfile] = useState<LocalUserProfile | null>(null);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [profileLoadError, setProfileLoadError] = useState('');
  const [source, setSource] = useState<RecommendationDataSource | null>(null);
  const [dataset, setDataset] = useState<DatasetManifest | null>(null);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'all' | ReadingStatus>('all');
  const [rating, setRating] = useState(0);
  const [visibleLibraryCount, setVisibleLibraryCount] = useState(60);
  const [libraryCatalog, setLibraryCatalog] = useState<Map<string, NovelSearchResult>>(new Map());
  const [taste, setTaste] = useState<TasteProfile | null>(null);
  const [tasteDetails, setTasteDetails] = useState<NovelDetail[]>([]);
  const [tasteLoading, setTasteLoading] = useState(false);
  const [tasteLoadFailed, setTasteLoadFailed] = useState(0);

  useEffect(() => {
    let cancelled = false;
    loadLocalProfile()
      .then((value) => !cancelled && setProfile(value))
      .catch(() => !cancelled && setProfileLoadError('Local profile storage could not be opened in this browser.'))
      .finally(() => !cancelled && setProfileLoaded(true));
    createDataSource(dataMode).then(async (next) => {
      const manifest = await next.getManifest();
      if (cancelled) return;
      setSource(next);
      setDataset(manifest);
    }).catch(() => { if (!cancelled) { setSource(null); setDataset(null); } });
    return () => { cancelled = true; };
  }, [dataMode]);

  useEffect(() => {
    if (!profile) {
      setTaste(null);
      setTasteDetails([]);
      setTasteLoadFailed(0);
      setTasteLoading(false);
      return;
    }
    // Seeds/excludes work without catalog details; facets need detail fetches.
    const draft = computeTasteProfile(profile, [], {
      datasetVersion: dataset?.dataset_version || profile.dataset_version,
    });
    setTaste(draft);
    if (!source || (draft.positive_seeds.length === 0 && draft.negative_ids.length === 0)) {
      setTasteDetails([]);
      setTasteLoadFailed(0);
      setTasteLoading(false);
      return;
    }
    const ids = [
      ...draft.positive_seeds.map((s) => s.novel_id),
      ...draft.negative_ids,
    ].filter((id, index, all) => all.indexOf(id) === index).slice(0, 80);
    let cancelled = false;
    setTasteLoading(true);
    Promise.allSettled(ids.map((id) => source.getNovel(id))).then((results) => {
      if (cancelled) return;
      const details = results.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []));
      setTasteDetails(details);
      setTasteLoadFailed(results.length - details.length);
      setTaste(
        computeTasteProfile(profile, details, {
          datasetVersion: dataset?.dataset_version || profile.dataset_version,
        })
      );
      setTasteLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [profile, source, dataset?.dataset_version]);

  const counts = useMemo(() => {
    const next: Record<ReadingStatus, number> = {
      reading: 0, completed: 0, plan_to_read: 0, dropped: 0, paused: 0,
    };
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
  const visibleEntries = useMemo(
    () => entries.slice(0, visibleLibraryCount),
    [entries, visibleLibraryCount],
  );

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
  }, [source, visibleEntries]);

  const useSeed = (entry: ProfileEntry) => {
    if (entry.novel_id == null) return;
    window.location.href = appUrl(`?seed=${entry.novel_id}`);
  };

  const openLibraryDetail = async (entry: ProfileEntry) => {
    if (entry.novel_id == null) return;
    openDetailById(entry.novel_id);
  };

  const openDetailById = async (novelId: number) => {
    window.location.href = novelPageUrl(novelId);
  };

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

      {!profileLoaded ? (
        <Card className="profile-empty" aria-live="polite">
          <span className="profile-loading-indicator" aria-hidden="true" />
          <h2>Loading your local library…</h2>
          <p>Opening the profile stored for this site address.</p>
        </Card>
      ) : !profile ? (
        <>
          <Card className="profile-empty">
            <BookOpen size={30} />
            <h2>Bring your reading history into discovery</h2>
            <p>Use “Import my library” above to preview saved Novel Updates profile pages before anything is stored. The page stays entirely local to this browser.</p>
            {profileLoadError && <p className="profile-storage-error">{profileLoadError}</p>}
            {window.location.hostname === 'localhost' && window.location.port && window.location.port !== '3000' &&
              <p className="profile-storage-warning">This preview uses port {window.location.port}. Browser profiles imported at localhost:3000 are stored under that separate site address.</p>}
          </Card>
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
            <div><strong>{(counts.dropped + counts.paused).toLocaleString()}</strong><span>Dropped / paused</span></div>
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
          <Card className="profile-feedback-summary">
              <div><span className="eyebrow">Explicit local signals</span><h2>Recommendation feedback</h2></div>
              <p>Love is a favorite signal, Read is a local read marker, and Not for me hides that title from recommendation results. None of these edits your Novel Updates account.</p>
              <div>{profile.feedback!.map((item) => (
                <span key={item.novel_id} className={`feedback-${item.signal}`}>
                  {item.title}<strong>{item.signal === 'not_for_me' ? 'Not for me' : item.signal === 'love' ? 'Loved' : 'Read'}</strong>
                </span>
              ))}</div>
            </Card>
          )}

          <Card className="profile-control-strip">
            <div><ShieldCheck size={18} /><span><strong>Private local profile</strong><small>Normalized data stays in IndexedDB on this browser.</small></span></div>
            <ProfilePanel source={source} dataset={dataset} profile={profile} onProfileChange={setProfile} onUseSeed={useSeed} showPageLink={false} />
          </Card>

          <Card className="taste-snapshot" aria-labelledby="taste-title">
            <div className="profile-library-heading">
              <div><span className="eyebrow">Weighted from your library</span><h2 id="taste-title">Taste profile</h2></div>
              <span>{dataset?.dataset_version || profile.dataset_version}</span>
            </div>
            {tasteLoading && <p className="profile-list-note">Loading catalog metadata for seeds and negatives…</p>}
            {taste && (
              <>
                <p className="profile-list-note">
                  {taste.positive_seeds.length} positive seeds · {taste.negative_ids.length} negatives ·{' '}
                  {taste.exclude_ids.length} matched IDs excluded from ranking ·{' '}
                  {taste.evidence.matched}/{taste.evidence.total_entries} library titles matched to catalog.
                  {tasteLoadFailed ? ` ${tasteLoadFailed} detail shard${tasteLoadFailed === 1 ? '' : 's'} failed to load.` : ''}
                  {' '}Facet weights use rating/status/feedback — not equal title counts.
                </p>
                {taste.evidence.caveats.length > 0 && (
                  <ul className="taste-caveats">
                    {taste.evidence.caveats.map((caveat) => <li key={caveat}>{caveat}</li>)}
                  </ul>
                )}
                <div className="taste-actions">
                  <a className="taste-for-you" href={appUrl('?view=discover&for_you=1')}>
                    <Sparkles size={15} /> For You recommendations
                  </a>
                  <small>Multi-seed RRF over your positive seeds; works in live API and static Pages mode.</small>
                </div>
                <div className="taste-columns taste-columns-4">
                  <div>
                    <h3>Liked genres</h3>
                    <div className="taste-chips">
                      {taste.liked_genres.map((facet) => (
                        <a key={facet.name} href={browseFacetUrl('genre', facet.name)}>
                          {facet.name}<strong>{facet.weight.toFixed(1)}</strong><small>×{facet.count}</small>
                        </a>
                      ))}
                      {!taste.liked_genres.length && <small>Need matched seed details for genres.</small>}
                    </div>
                  </div>
                  <div>
                    <h3>Liked tags</h3>
                    <div className="taste-chips">
                      {taste.liked_tags.map((facet) => (
                        <a key={facet.name} href={browseFacetUrl('tag', facet.name)}>
                          {facet.name}<strong>{facet.weight.toFixed(1)}</strong><small>×{facet.count}</small>
                        </a>
                      ))}
                      {!taste.liked_tags.length && <small>Need matched seed details for tags.</small>}
                    </div>
                  </div>
                  <div>
                    <h3>Avoid genres</h3>
                    <div className="taste-chips taste-chips-avoid">
                      {taste.avoid_genres.map((facet) => (
                        <a key={facet.name} href={browseFacetUrl('genre', facet.name)}>
                          {facet.name}<strong>{facet.weight.toFixed(1)}</strong><small>×{facet.count}</small>
                        </a>
                      ))}
                      {!taste.avoid_genres.length && <small>No dropped / low-rated / not-for-me signal yet.</small>}
                    </div>
                  </div>
                  <div>
                    <h3>Avoid tags</h3>
                    <div className="taste-chips taste-chips-avoid">
                      {taste.avoid_tags.map((facet) => (
                        <a key={facet.name} href={browseFacetUrl('tag', facet.name)}>
                          {facet.name}<strong>{facet.weight.toFixed(1)}</strong><small>×{facet.count}</small>
                        </a>
                      ))}
                      {!taste.avoid_tags.length && <small>No negative tag signal yet.</small>}
                    </div>
                  </div>
                </div>
                <details className="taste-sample" open={taste.positive_seeds.length > 0 && taste.positive_seeds.length <= 8}>
                  <summary>Positive seeds ({taste.positive_seeds.length}) — used for For You</summary>
                  <ul>
                    {taste.positive_seeds.map((seed) => (
                      <li key={seed.novel_id}>
                        <a href={novelPageUrl(seed.novel_id)}>{seed.title}</a>
                        {' '}· weight {seed.weight.toFixed(2)} · {seed.reason}
                      </li>
                    ))}
                    {!taste.positive_seeds.length && <li>None yet — rate matched titles 4★+ or mark Completed.</li>}
                  </ul>
                </details>
                {tasteDetails.length > 0 && (
                  <details className="taste-sample">
                    <summary>Catalog titles loaded for facets ({tasteDetails.length})</summary>
                    <ul>
                      {tasteDetails.map((detail) => (
                        <li key={detail.id}>
                          {displayNovelTitle(detail.title, detail.associated_names, settings.titlePreference)}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </>
            )}
          </Card>

          <Card className="profile-library-section">
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
          </Card>

          <Card className="profile-lists-section">
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
          </Card>
        </>
      )}
    </div>
  );
}
