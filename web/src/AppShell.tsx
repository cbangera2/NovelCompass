import { ReactNode, useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  BookOpen,
  Clock3,
  Database,
  Download,
  LogOut,
  Search,
  Settings,
  Sparkles,
  User,
  X,
} from 'lucide-react';
import { useMediaFilterState, MediaTypeChoice } from './mediaFilterState';
import { Film, Image as ImageIcon, Book } from 'lucide-react';
import type { LocalUserProfile } from './profile/types';
import {
  clearLocalProfile,
  loadLocalProfile,
  subscribeLocalProfile,
} from './profile/store';
import { downloadProfileBackup } from './profile/transfer';
import { ProfileImportDialog } from './profile/ProfileImportDialog';
import { Badge } from './design-system';
import { defaultHomeUrl } from './preferences';
import { createDataSource } from './data';
import type { NovelSearchResult } from './types';
import { getMediaBadgeInfo, novelPageUrl } from './novelLinks';
import { NovelCompassMark } from './NovelCompassMark';
import {
  Sidebar,
  SidebarCollapseButton,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from './components/ui/sidebar';
import './app-shell.css';
import { useDataModePreference } from './dataModePreference';

export type AppView = 'discover' | 'browse' | 'profile' | 'settings' | 'scraper' | 'novel';

const NAV_ITEMS = [
  { view: 'discover' as const, label: 'Discover', note: 'Find related titles', icon: Sparkles },
  { view: 'browse' as const, label: 'Browse', note: 'Explore the catalog', icon: BookOpen },
  { view: 'settings' as const, label: 'Settings', note: 'Appearance & titles', icon: Settings },
  { view: 'scraper' as const, label: 'Scraper', note: 'Update local data', icon: Database },
];

function viewUrl(view: AppView): string {
  const base = import.meta.env.BASE_URL;
  return view === 'discover' ? `${base}?view=discover` : `${base}?view=${view}`;
}

export default function AppShell({
  activeView,
  children,
}: {
  activeView: AppView;
  children: ReactNode;
}): JSX.Element {
  const [profile, setProfile] = useState<LocalUserProfile | null>(null);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [homeUrl, setHomeUrl] = useState(defaultHomeUrl);
  const { mode: dataMode } = useDataModePreference();
  const staticDeployment = dataMode === 'static' || window.location.hostname.endsWith('.github.io');
  const navItems = NAV_ITEMS.filter((item) => item.view !== 'scraper' || !staticDeployment);

  useEffect(() => {
    const refreshProfile = () =>
      loadLocalProfile()
        .then(setProfile)
        .catch(() => setProfile(null))
        .finally(() => setProfileLoaded(true));
    refreshProfile();
    const unsubscribe = subscribeLocalProfile((next) => {
      setProfile(next);
      setProfileLoaded(true);
    });
    window.addEventListener('focus', refreshProfile);
    return () => {
      unsubscribe();
      window.removeEventListener('focus', refreshProfile);
    };
  }, []);

  useEffect(() => {
    const refreshHome = () => setHomeUrl(defaultHomeUrl());
    window.addEventListener('storage', refreshHome);
    window.addEventListener('novel-navigation-preferences', refreshHome);
    return () => {
      window.removeEventListener('storage', refreshHome);
      window.removeEventListener('novel-navigation-preferences', refreshHome);
    };
  }, []);

  const profileLabel = !profileLoaded
    ? 'Loading local library…'
    : profile
      ? `${profile.entries.length.toLocaleString()} saved title${profile.entries.length === 1 ? '' : 's'}`
      : 'Private to this browser';

  return (
    <SidebarProvider>
      <header className="shell-mobile-header">
        <a className="shell-brand compact" href={homeUrl} aria-label="Novel Compass home">
          <NovelCompassMark />
          <strong>Novel Compass</strong>
        </a>
        <div className="shell-mobile-actions">
          <GlobalNovelSearch mobile />
          <AccountMenu profile={profile} profileLabel={profileLabel} mobile />
          <SidebarTrigger />
        </div>
      </header>
      <Sidebar>
        <SidebarHeader>
          <div className="shell-sidebar-heading">
            <a className="shell-brand" href={homeUrl}>
              <NovelCompassMark />
              <div className="sidebar-brand-copy">
                <strong>Novel Compass</strong>
                <small>Relationship-first discovery</small>
              </div>
            </a>
            <SidebarCollapseButton />
          </div>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Explore</SidebarGroupLabel>
            <SidebarMenu>
              {navItems.map((item) => {
                const Icon = item.icon;
                return (
                  <SidebarMenuItem key={item.view}>
                    <SidebarMenuButton
                      asChild
                      active={activeView === item.view}
                      tooltip={item.label}
                    >
                      <a href={viewUrl(item.view)}>
                        <Icon size={18} />
                        <span>
                          <strong>{item.label}</strong>
                          <small>{item.note}</small>
                        </span>
                      </a>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroup>
          <SidebarMediaGroup />
        </SidebarContent>
        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                asChild
                active={activeView === 'profile'}
                tooltip="Local profile"
                className="shell-account"
              >
                <a href={viewUrl('profile')}>
                  <span className="shell-avatar">
                    <User size={16} />
                  </span>
                  <span>
                    <strong>{profile?.username || 'Local profile'}</strong>
                    <small>{profileLabel}</small>
                  </span>
                </a>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>
      <SidebarInset>
        <header className="shell-desktop-header">
          <GlobalNovelSearch compact={activeView === 'discover' || activeView === 'browse'} />
          <AccountMenu profile={profile} profileLabel={profileLabel} />
        </header>
        <div className="shell-content">{children}</div>
        <footer className="shell-footer">
          <span>Novel Compass · personal discovery workspace</span>
          <nav aria-label="Footer links">
            <a href={viewUrl('profile')}>Local data</a>
            {!staticDeployment && <a href={viewUrl('scraper')}>Catalog tools</a>}
            <a
              href="https://github.com/shaido987/novel-dataset"
              target="_blank"
              rel="noopener noreferrer"
            >
              Source dataset
            </a>
          </nav>
        </footer>
      </SidebarInset>
    </SidebarProvider>
  );
}

function SidebarMediaGroup() {
  const { isSelected, toggleType, isAllSelected, scopeLabel } = useMediaFilterState();
  const choices: Array<{ type: MediaTypeChoice; label: string; note: string; icon: any }> = [
    { type: 'novel', label: 'Light Novels', note: 'Web & Light novels', icon: Book },
    { type: 'manga', label: 'Manga & Comics', note: 'Manga, Manhwa, Manhua', icon: ImageIcon },
    { type: 'anime', label: 'Anime & Series', note: 'TV, Movies, OVAs', icon: Film },
  ];

  return (
    <SidebarGroup>
      <SidebarGroupLabel>Formats</SidebarGroupLabel>
      <p className="sidebar-format-hint">
        {isAllSelected
          ? 'All formats · scopes search, browse, and recommendations'
          : `Looking at ${scopeLabel} · search, browse, and recs`}
      </p>
      <SidebarMenu>
        {choices.map(({ type, label, note, icon: Icon }) => {
          const active = isSelected(type);
          return (
            <SidebarMenuItem key={type}>
              <SidebarMenuButton
                active={active}
                tooltip={label}
                onClick={() => toggleType(type)}
              >
                <Icon size={18} />
                <span>
                  <strong>{label}</strong>
                  <small>{note}</small>
                </span>
                {active && !isAllSelected && <Badge tone="violet">On</Badge>}
              </SidebarMenuButton>
            </SidebarMenuItem>
          );
        })}
      </SidebarMenu>
    </SidebarGroup>
  );
}

const RECENT_SEARCH_KEY = 'novel-compass:recent-searches:v1';

function GlobalNovelSearch({
  mobile = false,
  compact = false,
}: {
  mobile?: boolean;
  compact?: boolean;
}) {
  const { selectedTypes, searchPlaceholder: scopedPlaceholder, scopeLabel, isAllSelected } =
    useMediaFilterState();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<NovelSearchResult[]>([]);
  const [recent, setRecent] = useState<NovelSearchResult[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(RECENT_SEARCH_KEY) || '[]').slice(0, 5);
    } catch {
      return [];
    }
  });
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);

  useEffect(() => {
    const onShortcut = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches('input, textarea, select, [contenteditable="true"]')) return;
      if (
        event.key === '/' ||
        ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k')
      ) {
        event.preventDefault();
        setOpen(true);
        window.setTimeout(() => inputRef.current?.focus(), 0);
      }
    };
    window.addEventListener('keydown', onShortcut);
    return () => window.removeEventListener('keydown', onShortcut);
  }, []);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true);
      createDataSource()
        .then((source) => source.searchNovels(trimmed, 7, controller.signal))
        .then(setResults)
        .catch((error) => {
          if (error?.name !== 'AbortError') setResults([]);
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 180);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
    // Re-run when format scope changes so results stay inside the active modalities.
  }, [query, selectedTypes]);

  const choose = (novel: NovelSearchResult) => {
    const next = [novel, ...recent.filter((item) => item.id !== novel.id)].slice(0, 5);
    setRecent(next);
    localStorage.setItem(RECENT_SEARCH_KEY, JSON.stringify(next));
  };

  const typesParam = !isAllSelected && selectedTypes.length > 0 ? `&types=${encodeURIComponent(selectedTypes.join(','))}` : '';
  const browseUrl = `${import.meta.env.BASE_URL}?view=browse&q=${encodeURIComponent(query.trim())}${typesParam}`;
  const hasPanelContent = loading || query.trim().length >= 2 || recent.length > 0;
  const searchPanel = (
    <div className="shell-search-panel" ref={rootRef}>
      <label>
        <Search size={17} aria-hidden="true" />
        <input
          ref={inputRef}
          type="search"
          value={query}
          placeholder={scopedPlaceholder}
          aria-label={
            isAllSelected ? 'Search the catalog' : `Search the catalog (${scopeLabel})`
          }
          aria-expanded={open}
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setOpen(false);
          }}
        />
        {query && (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => {
              setQuery('');
              inputRef.current?.focus();
            }}
          >
            <X size={15} />
          </button>
        )}
        {!mobile && <kbd>/</kbd>}
      </label>
      {open && hasPanelContent && (
        <div className="shell-search-results">
          <div className="shell-search-result-list">
            {loading && (
              <p className="shell-search-state">
                {isAllSelected ? 'Searching catalog…' : `Searching ${scopeLabel}…`}
              </p>
            )}
            {!loading && query.trim().length >= 2 && results.length === 0 && (
              <p className="shell-search-state">
                {isAllSelected
                  ? 'No matching titles'
                  : `No matching titles in ${scopeLabel}`}
              </p>
            )}
            {!loading && query.trim().length < 2 && recent.length > 0 && (
              <p className="shell-search-heading">
                <Clock3 size={13} /> Recent titles
              </p>
            )}
            {(query.trim().length >= 2 ? results : recent).map((novel) => {
              const badge = getMediaBadgeInfo(novel);
              return (
                <a key={novel.id} href={novelPageUrl(novel.id)} onClick={() => choose(novel)}>
                  {novel.cover_url ? (
                    <img src={novel.cover_url} alt="" loading="lazy" />
                  ) : (
                    <span>
                      <BookOpen size={16} />
                    </span>
                  )}
                  <span>
                    <div className="suggestion-title-line">
                      <strong>{novel.title}</strong>
                      <span className="suggestion-badges">
                        <span className={`search-badge format-badge ${badge.formatKey}`}>
                          {badge.formatLabel}
                        </span>
                        <span className={`search-badge source-badge ${badge.sourceKey}`}>
                          {badge.sourceLabel}
                        </span>
                      </span>
                    </div>
                    <small>{novel.author || 'Catalog title'}</small>
                  </span>
                  <ArrowRight size={15} aria-hidden="true" />
                </a>
              );
            })}
          </div>
          {query.trim().length >= 2 && (
            <a className="shell-search-all" href={browseUrl}>
              View all Browse results <ArrowRight size={14} />
            </a>
          )}
        </div>
      )}
    </div>
  );

  if (!mobile && !compact) return searchPanel;
  return (
    <>
      <button
        className={mobile ? 'shell-mobile-search-trigger' : 'shell-compact-search-trigger'}
        type="button"
        aria-label={isAllSelected ? 'Search titles' : `Search ${scopeLabel}`}
        aria-expanded={open}
        onClick={() => {
          setOpen((value) => !value);
          window.setTimeout(() => inputRef.current?.focus(), 0);
        }}
      >
        <Search size={17} />
      </button>
      {open && (
        <div className={mobile ? 'shell-mobile-search' : 'shell-compact-search'}>{searchPanel}</div>
      )}
    </>
  );
}

function AccountMenu({
  profile,
  profileLabel,
  mobile = false,
}: {
  profile: LocalUserProfile | null;
  profileLabel: string;
  mobile?: boolean;
}) {
  const [message, setMessage] = useState('');
  const clearSession = async () => {
    if (
      !window.confirm(
        'Clear this local session? This permanently deletes the profile, library, ratings, and recommendation feedback stored in this browser. It does not affect Novel Updates.',
      )
    )
      return;
    await clearLocalProfile();
    localStorage.removeItem(RECENT_SEARCH_KEY);
    setMessage('Local session cleared.');
  };

  return (
    <details className={`shell-account-menu${mobile ? ' mobile' : ''}`}>
      <summary aria-label={`Open account menu for ${profile?.username || 'local profile'}`}>
        <span className="shell-avatar">
          <User size={16} />
        </span>
        {!mobile && (
          <span>
            <strong>{profile?.username || 'Local profile'}</strong>
            <small>{profileLabel}</small>
          </span>
        )}
        {mobile && profile && <Badge tone="violet">{profile.entries.length}</Badge>}
      </summary>
      <nav aria-label="Account">
        <header>
          <strong>{profile?.username || 'Local profile'}</strong>
          <small>{profileLabel}</small>
        </header>
        <a href={viewUrl('profile')}>
          <User size={16} />
          <span>
            Profile<small>Library and analytics</small>
          </span>
        </a>
        <a href={viewUrl('settings')}>
          <Settings size={16} />
          <span>
            Settings<small>Appearance and defaults</small>
          </span>
        </a>
        <div className="shell-account-divider" />
        <ProfileImportDialog profile={profile} onImported={setMessage} />
        <button
          type="button"
          disabled={!profile}
          onClick={() => profile && downloadProfileBackup(profile)}
        >
          <Download size={16} />
          <span>
            Export profile<small>Download library and ratings</small>
          </span>
        </button>
        <button type="button" className="shell-clear-session" onClick={clearSession}>
          <LogOut size={16} />
          <span>
            Clear local session<small>Delete browser-only data</small>
          </span>
        </button>
        {message && (
          <p className="shell-account-message" role="status">
            {message}
          </p>
        )}
      </nav>
    </details>
  );
}
