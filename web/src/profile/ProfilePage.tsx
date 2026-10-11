import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { BookOpen, ExternalLink, Search, ShieldCheck, Sparkles } from 'lucide-react';
import { createDataSource, RecommendationDataSource } from '../data';
import { useDataModePreference } from '../dataModePreference';
import { DatasetManifest, FilterOptions, NovelDetail, NovelSearchResult } from '../types';
import { ProfilePanel } from './ProfilePanel';
import { loadLocalProfile, saveLocalProfile } from './store';
import { LocalUserProfile, ProfileEntry, ReadingStatus, TastePin } from './types';
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
  const [facetOptions, setFacetOptions] = useState<FilterOptions | null>(null);
  const [tuneName, setTuneName] = useState('');
  const [tuneMessage, setTuneMessage] = useState('');

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

  useEffect(() => {
    if (!source) {
      setFacetOptions(null);
      return;
    }
    let cancelled = false;
    source.getOptions()
      .then((options) => { if (!cancelled) setFacetOptions(options); })
      .catch(() => { if (!cancelled) setFacetOptions(null); });
    return () => { cancelled = true; };
  }, [source]);

  const mutedNames = useMemo(() => new Set(
    (profile?.taste_overrides?.muted || []).map((m) => m.name.trim().toLowerCase()).filter(Boolean)
  ), [profile]);
  const listMemberships = useMemo(
    () => profile?.list_membership || [], [profile]);
  const listMembershipById = useMemo(
    () => new Map(listMemberships.map((m) => [m.list_id, m])), [listMemberships]);

  const resolveTuneKind = (name: string): TastePin['kind'] => {
    const genres = facetOptions?.genres || [];
    return genres.some((g) => g.toLowerCase() === name.toLowerCase()) ? 'genre' : 'tag';
  };

  const saveOverrides = async (
    mutator: (current: NonNullable<LocalUserProfile['taste_overrides']>) => void,
    doneMessage: string
  ) => {
    if (!profile) return;
    const overrides = {
      likes: [...(profile.taste_overrides?.likes || [])],
      avoids: [...(profile.taste_overrides?.avoids || [])],
      muted: [...(profile.taste_overrides?.muted || [])],
    };
    mutator(overrides);
    const next = { ...profile, taste_overrides: overrides };
    await saveLocalProfile(next);
    setProfile(next);
    setTuneMessage(doneMessage);
  };

  const addTuneOverride = (list: 'likes' | 'avoids' | 'muted') => {
    const name = tuneName.trim();
    if (!name) {
      setTuneMessage('Type a tag or genre first.');
      return;
    }
    if (name.length > 60) {
      setTuneMessage('That name is too long to be a tag or genre.');
      return;
    }
    const key = name.toLowerCase();
    const others: Array<'likes' | 'avoids' | 'muted'> = ['likes', 'avoids', 'muted'];
    void saveOverrides((overrides) => {
      for (const other of others) {
        const at = overrides[other].findIndex((p) => p.name.toLowerCase() === key);
        if (at >= 0 && other !== list) overrides[other].splice(at, 1);
      }
      if (!overrides[list].some((p) => p.name.toLowerCase() === key)) {
        overrides[list].push({ name, kind: resolveTuneKind(name) });
      }
    }, list === 'muted'
      ? `'${name}' muted — ignored in ranking.`
      : `'${name}' pinned as ${list === 'likes' ? 'liked' : 'avoided'}.`);
    setTuneName('');
  };

  const removeTuneOverride = (list: 'likes' | 'avoids' | 'muted', name: string) => {
    const key = name.toLowerCase();
    void saveOverrides((overrides) => {
      overrides[list] = overrides[list].filter((p) => p.name.toLowerCase() !== key);
    }, `Removed '${name}'.`);
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
                  {taste.evidence.lists_with_membership > 0 &&
                    ` · ${taste.evidence.list_seeds} seeds from ${taste.evidence.lists_with_membership} imported list${taste.evidence.lists_with_membership === 1 ? '' : 's'}.`}
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
                          {facet.name}<strong>{facet.weight.toFixed(1)}</strong>
                          {facet.manual ? <small>pinned</small> : <small>×{facet.count}</small>}
                          {mutedNames.has(facet.name.toLowerCase()) && <small>muted</small>}
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
                          {facet.name}<strong>{facet.weight.toFixed(1)}</strong>
                          {facet.manual ? <small>pinned</small> : <small>×{facet.count}</small>}
                          {mutedNames.has(facet.name.toLowerCase()) && <small>muted</small>}
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
                          {facet.name}<strong>{facet.weight.toFixed(1)}</strong>
                          {facet.manual ? <small>pinned</small> : <small>×{facet.count}</small>}
                          {mutedNames.has(facet.name.toLowerCase()) && <small>muted</small>}
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
                          {facet.name}<strong>{facet.weight.toFixed(1)}</strong>
                          {facet.manual ? <small>pinned</small> : <small>×{facet.count}</small>}
                          {mutedNames.has(facet.name.toLowerCase()) && <small>muted</small>}
                        </a>
                      ))}
                      {!taste.avoid_tags.length && <small>No negative tag signal yet.</small>}
                    </div>
                  </div>
                </div>
                {taste.contested_facets.length > 0 && (
                  <div className="taste-contested">
                    <h3>Mixed signals — in your liked and dropped titles, counted lightly</h3>
                    <div className="taste-chips taste-chips-contested">
                      {taste.contested_facets.map((facet) => (
                        <span key={`${facet.kind}:${facet.name}`} title={`${facet.kind}`}>
                          {facet.name}
                          <strong>liked {facet.like_weight.toFixed(1)}×{facet.like_count}</strong>
                          <small>avoided {facet.avoid_weight.toFixed(1)}×{facet.avoid_count}</small>
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                <div className="taste-tune">
                  <h3>Teach your taste</h3>
                  <p className="profile-list-note">
                    Pin tags or genres you love or want to avoid, or mute ones the engine
                    got wrong. Pins shape For You ranking softly — they don't add new seed pools.
                  </p>
                  <div className="taste-tune-row">
                    <input
                      value={tuneName}
                      onChange={(event) => setTuneName(event.target.value)}
                      placeholder="e.g. yandere"
                      list="taste-tune-suggestions"
                      aria-label="Tag or genre name"
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') addTuneOverride('likes');
                      }}
                    />
                    <datalist id="taste-tune-suggestions">
                      {(facetOptions?.genres || []).map((name) => <option key={`g:${name}`} value={name} />)}
                      {(facetOptions?.tags || []).map((name) => <option key={`t:${name}`} value={name} />)}
                    </datalist>
                    <button type="button" onClick={() => addTuneOverride('likes')}>Pin like</button>
                    <button type="button" onClick={() => addTuneOverride('avoids')}>Pin avoid</button>
                    <button type="button" onClick={() => addTuneOverride('muted')}>Mute</button>
                  </div>
                  {tuneMessage && <p className="profile-list-note" role="status">{tuneMessage}</p>}
                  {(profile?.taste_overrides?.likes.length ||
                    profile?.taste_overrides?.avoids.length ||
                    profile?.taste_overrides?.muted.length) ? (
                    <ul className="taste-tune-list">
                      {(profile?.taste_overrides?.likes || []).map((pin) => (
                        <li key={`likes:${pin.name}`}>
                          <span>{pin.name}<small>pinned like · {pin.kind}</small></span>
                          <button type="button" aria-label={`Remove pinned like ${pin.name}`}
                            onClick={() => removeTuneOverride('likes', pin.name)}>✕</button>
                        </li>
                      ))}
                      {(profile?.taste_overrides?.avoids || []).map((pin) => (
                        <li key={`avoids:${pin.name}`}>
                          <span>{pin.name}<small>pinned avoid · {pin.kind}</small></span>
                          <button type="button" aria-label={`Remove pinned avoid ${pin.name}`}
                            onClick={() => removeTuneOverride('avoids', pin.name)}>✕</button>
                        </li>
                      ))}
                      {(profile?.taste_overrides?.muted || []).map((pin) => (
                        <li key={`muted:${pin.name}`}>
                          <span>{pin.name}<small>muted · {pin.kind}</small></span>
                          <button type="button" aria-label={`Unmute ${pin.name}`}
                            onClick={() => removeTuneOverride('muted', pin.name)}>✕</button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="profile-list-note">No manual adjustments yet — everything above is inferred from your library.</p>
                  )}
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
              <span>{profile.curated_lists.length} summaries{listMemberships.length ? ` · ${listMemberships.length} with membership` : ''}</span>
            </div>
            {listMemberships.length ? (
              <p className="profile-list-note">
                Favorites lists seed personalization, to-read lists are excluded from recommendations, mixed lists seed weakly.
                Re-save a list page from Novel Updates anytime to refresh its members.
              </p>
            ) : (
              <p className="profile-list-note">
                List summaries show titles and sizes, not membership. Save individual list pages
                (…/viewlist/ID/) and import them to make those lists drive personalization.
              </p>
            )}
            <div className="profile-list-grid">
              {profile.curated_lists.map((list) => {
                const membership = listMembershipById.get(list.id);
                return (
                  <article key={list.id} className={membership ? 'list-with-membership' : ''}>
                    <div>
                      <h3>{list.title}</h3>
                      {list.is_private && <span>Private</span>}
                      {membership && (
                        <span className={`list-signal list-signal-${membership.signal}`}>
                          {membership.signal === 'favorites' ? 'Favorites' :
                            membership.signal === 'to_read' ? 'To read' : 'Mixed'}
                        </span>
                      )}
                    </div>
                    {list.description && <p>{list.description}</p>}
                    <footer>
                      <span>
                        {membership
                          ? `${membership.members.length} imported titles`
                          : list.series_count != null ? `${list.series_count} series` : 'Series count unavailable'}
                      </span>
                      {list.membership_available && (
                        <a href={`https://www.novelupdates.com/viewlist/${list.id}/`} target="_blank" rel="noopener noreferrer">
                          Open list <ExternalLink size={13} />
                        </a>
                      )}
                    </footer>
                  </article>
                );
              })}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
