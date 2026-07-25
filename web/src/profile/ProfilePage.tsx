import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, BookOpen, ExternalLink, Search, ShieldCheck, Sparkles } from 'lucide-react';
import { configuredDataMode, createDataSource, RecommendationDataSource } from '../data';
import { DatasetManifest } from '../types';
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

  useEffect(() => {
    loadLocalProfile().then(setProfile);
    createDataSource(configuredDataMode()).then(async (next) => {
      setSource(next);
      setDataset(await next.getManifest());
    }).catch(() => undefined);
  }, []);

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
      <nav className="profile-page-nav">
        <a href={appUrl()}><ArrowLeft size={16} /> Back to discovery</a>
        <span><ShieldCheck size={15} /> Private local profile</span>
      </nav>

      <header className="profile-page-hero">
        <div>
          <span className="eyebrow">Your reading world</span>
          <h1>{profile?.username ? `${profile.username}'s library` : 'Your local library'}</h1>
          <p>Stored only in this browser. This is a private recommender profile, not a Novel Updates login or connected account.</p>
        </div>
        <ProfilePanel source={source} dataset={dataset} profile={profile} onProfileChange={setProfile} onUseSeed={useSeed} showPageLink={false} />
      </header>

      {!profile ? (
        <section className="profile-empty">
          <BookOpen size={30} />
          <h2>Bring your reading history into discovery</h2>
          <p>Use “Import my library” above to preview saved Novel Updates profile pages before anything is stored.</p>
        </section>
      ) : (
        <>
          <section className="profile-page-stats">
            <div><strong>{profile.entries.length.toLocaleString()}</strong><span>Total titles</span></div>
            <div><strong>{counts.reading.toLocaleString()}</strong><span>Reading</span></div>
            <div><strong>{counts.completed.toLocaleString()}</strong><span>Completed</span></div>
            <div><strong>{counts.plan_to_read.toLocaleString()}</strong><span>Plan to read</span></div>
            <div><strong>{profile.entries.filter((entry) => entry.novel_id != null).length.toLocaleString()}</strong><span>Matched</span></div>
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
