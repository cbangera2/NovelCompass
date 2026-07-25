import { useEffect, useMemo, useState } from 'react';
import { BookOpen, ExternalLink, Search, ShieldCheck, Sparkles } from 'lucide-react';
import { configuredDataMode, createDataSource, RecommendationDataSource } from '../data';
import { DatasetManifest, NovelDetail } from '../types';
import { ProfilePanel } from './ProfilePanel';
import { loadLocalProfile } from './store';
import { LocalUserProfile, ProfileEntry, ReadingStatus } from './types';

const STATUS_LABELS: Record<ReadingStatus, string> = {
  reading: 'Reading',
  completed: 'Completed',
  plan_to_read: 'Plan to read'
};

function appUrl(params = ''): string {
  return `${import.meta.env.BASE_URL}${params}`;
}

export default function ProfilePage(): JSX.Element {
  const [profile, setProfile] = useState<LocalUserProfile | null>(null);
  const [source, setSource] = useState<RecommendationDataSource | null>(null);
  const [dataset, setDataset] = useState<DatasetManifest | null>(null);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'all' | ReadingStatus>('all');
  const [rating, setRating] = useState(0);
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

  const useSeed = (entry: ProfileEntry) => {
    if (entry.novel_id == null) return;
    window.location.href = appUrl(`?seed=${entry.novel_id}`);
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
                      {taste.genres.map(([genre, count]) => <span key={genre}>{genre}<strong>{count}/{taste.details.length}</strong></span>)}
                      {!taste.genres.length && <small>No genre metadata was available.</small>}
                    </div>
                  </div>
                  <div>
                    <h3>Recurring tags</h3>
                    <div className="taste-chips">
                      {taste.tags.map(([tag, count]) => <span key={tag}>{tag}<strong>{count}/{taste.details.length}</strong></span>)}
                      {!taste.tags.length && <small>No tag metadata was available.</small>}
                    </div>
                  </div>
                </div>
                <details className="taste-sample">
                  <summary>Titles used in this snapshot</summary>
                  <ul>{taste.details.map((detail) => <li key={detail.id}>{detail.title}</li>)}</ul>
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
              {entries.map((entry) => (
                <article key={entry.slug} className="profile-entry">
                  <div>
                    <span className={`profile-status status-${entry.status}`}>{STATUS_LABELS[entry.status]}</span>
                    <h3>{entry.imported_title}</h3>
                    <p>
                      {entry.rating ? `${entry.rating}★` : 'No personal rating'}
                      {entry.progress ? ` · ${entry.progress}` : ''}
                    </p>
                  </div>
                  {entry.novel_id != null ? (
                    <a href={appUrl(`?seed=${entry.novel_id}`)}><Sparkles size={14} /> Use as seed</a>
                  ) : <span className="profile-unmatched">Not in this snapshot</span>}
                </article>
              ))}
            </div>
            {!entries.length && <p className="profile-no-results">No library titles match those filters.</p>}
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
    </div>
  );
}
