import { useCallback, useEffect, useMemo, useState } from 'react';
import { BookOpen, FileUp, Info, Settings, ShieldCheck } from 'lucide-react';
import { createDataSource, RecommendationDataSource } from '../data';
import { useDataModePreference } from '../dataModePreference';
import { DatasetManifest } from '../types';
import { Card, DSButton } from '../design-system';
import { Tooltip } from '../ui';
import { applyResolvedNovelIds } from './resolve';
import { loadLocalProfile, saveLocalProfile, subscribeLocalProfile } from './store';
import { LocalUserProfile, ReadingStatus } from './types';
import { ProfileData } from './ProfileData';
import { ProfileImportDialog } from './ProfileImportDialog';
import { ProfileLibrary } from './ProfileLibrary';
import { ProfileTaste } from './ProfileTaste';
import './profile.css';

type ProfileTab = 'library' | 'taste' | 'data';
const TABS: Array<{ id: ProfileTab; label: string; note: string }> = [
  { id: 'library', label: 'Library', note: 'Your shelf' },
  { id: 'taste', label: 'Taste', note: 'What we learned' },
  { id: 'data', label: 'Import & data', note: 'Import, export, delete' },
];

const IMPORT_SOURCES = ['MyAnimeList', 'AniList', 'Novel Updates', 'Novel Compass backup'];

function tabFromUrl(): ProfileTab {
  const value = new URLSearchParams(window.location.search).get('tab');
  return TABS.some((tab) => tab.id === value) ? (value as ProfileTab) : 'library';
}

function tabUrl(tab: ProfileTab): string {
  const params = new URLSearchParams(window.location.search);
  params.set('view', 'profile');
  if (tab === 'library') params.delete('tab');
  else params.set('tab', tab);
  return `${window.location.pathname}?${params.toString()}${window.location.hash}`;
}

export default function ProfilePage(): JSX.Element {
  const { mode: dataMode } = useDataModePreference();
  const [profile, setProfile] = useState<LocalUserProfile | null>(null);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [profileLoadError, setProfileLoadError] = useState('');
  const [source, setSource] = useState<RecommendationDataSource | null>(null);
  const [dataset, setDataset] = useState<DatasetManifest | null>(null);
  const [tab, setTab] = useState<ProfileTab>(tabFromUrl);

  useEffect(() => {
    const onPop = () => setTab(tabFromUrl());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  useEffect(() => subscribeLocalProfile(setProfile), []);

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

  // Re-match saved titles when the catalog snapshot changes.
  useEffect(() => {
    if (!profile || !source || !dataset || profile.dataset_version === dataset.dataset_version) return;
    source.resolveSlugs(profile.entries.map((entry) => ({ slug: entry.slug, title: entry.imported_title })))
      .then(async (resolved) => {
        await saveLocalProfile({
          ...profile,
          dataset_version: dataset.dataset_version,
          entries: applyResolvedNovelIds(profile.entries, resolved),
        });
      })
      .catch(() => undefined);
  }, [dataset, profile, source]);

  const selectTab = useCallback((next: ProfileTab) => {
    setTab(next);
    window.history.pushState(null, '', tabUrl(next));
  }, []);

  const counts = useMemo(() => {
    const next: Record<ReadingStatus, number> = {
      reading: 0, completed: 0, plan_to_read: 0, dropped: 0, paused: 0,
    };
    profile?.entries.forEach((entry) => { next[entry.status] += 1; });
    return next;
  }, [profile]);

  const settingsHref = `${import.meta.env.BASE_URL}?view=settings`;

  return (
    <div className="profile-page">
      {!profileLoaded ? (
        <Card className="profile-empty" aria-live="polite">
          <span className="profile-loading-indicator" aria-hidden="true" />
          <h1>Loading your library…</h1>
          <p>Opening the profile stored for this site address.</p>
        </Card>
      ) : !profile ? (
        <Card className="profile-empty">
          <BookOpen size={30} aria-hidden="true" />
          <h1>Bring your reading history into discovery</h1>
          <p>Import your list and Novel Compass learns what you like, hides what you have already read, and tunes For You to your taste.</p>
          <ul className="profile-source-chips" aria-label="Supported imports">
            {IMPORT_SOURCES.map((name) => <li key={name}>{name}</li>)}
          </ul>
          <ProfileImportDialog
            profile={null}
            triggerClassName="profile-cta"
            trigger={<><FileUp size={18} aria-hidden="true" /> Import my library</>}
          />
          <p className="profile-trust"><ShieldCheck size={14} aria-hidden="true" /> Files are read in this browser and stay in this browser. Nothing is stored until you confirm.</p>
          {profileLoadError && <p className="profile-storage-error">{profileLoadError}</p>}
          {window.location.hostname === 'localhost' && window.location.port && window.location.port !== '3000' &&
            <p className="profile-storage-warning">This preview uses port {window.location.port}. Browser profiles imported at localhost:3000 are stored under that separate site address.</p>}
        </Card>
      ) : (
        <>
          <header className="profile-header">
            <div>
              <h1>{profile.username ? `${profile.username}'s library` : 'Your library'}</h1>
              <p className="profile-header-sub">
                {profile.entries.length.toLocaleString()} titles · stored only in this browser
                <Tooltip content="This is a private recommender profile on this device, not a Novel Updates login or connected account. Details are under Import & data.">
                  <button type="button" className="profile-info" aria-label="About this profile's privacy"><Info size={14} aria-hidden="true" /></button>
                </Tooltip>
              </p>
            </div>
            <div className="profile-header-actions">
              <ProfileImportDialog
                profile={profile}
                triggerClassName="profile-data-button profile-data-primary"
                trigger={<><FileUp size={15} aria-hidden="true" /> Import</>}
              />
              <DSButton as="a" variant="outline" href={settingsHref}><Settings size={15} aria-hidden="true" /> Settings</DSButton>
            </div>
          </header>

          <section className="profile-page-stats" aria-label="Library totals">
            <div><strong>{profile.entries.length.toLocaleString()}</strong><span>Total titles</span></div>
            <div><strong>{counts.reading.toLocaleString()}</strong><span>Reading</span></div>
            <div><strong>{counts.completed.toLocaleString()}</strong><span>Completed</span></div>
            <div><strong>{counts.plan_to_read.toLocaleString()}</strong><span>Plan to read</span></div>
            <div><strong>{(counts.dropped + counts.paused).toLocaleString()}</strong><span>Dropped / paused</span></div>
            <div><strong>{profile.entries.filter((entry) => entry.novel_id != null).length.toLocaleString()}</strong><span>Matched</span></div>
          </section>

          <nav className="profile-tabs" aria-label="Profile sections">
            {TABS.map((item) => (
              <a
                key={item.id}
                href={tabUrl(item.id)}
                aria-current={tab === item.id ? 'page' : undefined}
                onClick={(event) => {
                  if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
                  event.preventDefault();
                  selectTab(item.id);
                }}
              >
                {item.label}<small>{item.note}</small>
              </a>
            ))}
          </nav>

          {tab === 'library' && <ProfileLibrary profile={profile} source={source} counts={counts} />}
          {tab === 'taste' && <ProfileTaste profile={profile} source={source} dataset={dataset} />}
          {tab === 'data' && <ProfileData profile={profile} onProfileChange={setProfile} />}
        </>
      )}
    </div>
  );
}
