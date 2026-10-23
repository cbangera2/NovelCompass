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
  Heart,
  Library,
  Sparkles,
  User,
  X,
} from 'lucide-react';
import { useMediaFilterState, MediaTypeChoice } from './mediaFilterState';
import { Check, Film, Image as ImageIcon, Book } from 'lucide-react';
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
import { displayNovelTitle, useDisplaySettings } from './settings';
import { SearchResultRow } from './components/SearchResultRow';
import { emitSeedSelected, OPEN_SEARCH_EVENT, type OpenSearchDetail } from './components/searchEvents';
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

export type AppView = 'discover' | 'foryou' | 'browse' | 'profile' | 'settings' | 'scraper' | 'novel';

const NAV_ITEMS = [
  { view: 'foryou' as const, label: 'For You', note: 'Picked from your lists', icon: Heart, tab: true },
  { view: 'discover' as const, label: 'Similar', note: 'More like a title you love', icon: Sparkles, tab: true },
  { view: 'browse' as const, label: 'Browse', note: 'Explore the catalog', icon: BookOpen, tab: true },
  { view: 'settings' as const, label: 'Settings', note: 'Appearance & titles', icon: Settings, tab: false },
  { view: 'scraper' as const, label: 'Scraper', note: 'Update local data', icon: Database, tab: false },
];

// Mobile bottom tab bar. "Library" points at Profile until it gets its own page.
const TAB_ITEMS = [
  { view: 'foryou' as const, label: 'For You', icon: Heart },
  { view: 'discover' as const, label: 'Similar', icon: Sparkles },
  { view: 'browse' as const, label: 'Browse', icon: BookOpen },
  { view: 'profile' as const, label: 'Library', icon: Library },
];

const BRAND = 'Novel Compass';
const VIEW_TITLES: Record<AppView, string> = {
  foryou: 'For You',
  discover: 'Similar titles',
  browse: 'Browse',
  settings: 'Settings',
  profile: 'Profile',
  scraper: 'Scraper',
  novel: '',
};

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
  const staticDeployment =
    dataMode === 'static' ||
    window.location.hostname.endsWith('.github.io') ||
    window.location.hostname.endsWith('.pages.dev');
  const navItems = NAV_ITEMS.filter((item) => item.view !== 'scraper' || !staticDeployment);

  useEffect(() => {
    // The novel page sets its own "<Title> - Novel Compass" once the record loads.
    document.title = VIEW_TITLES[activeView] ? `${VIEW_TITLES[activeView]} - ${BRAND}` : BRAND;
  }, [activeView]);

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
                  <SidebarMenuItem key={item.view} className={item.tab ? 'sidebar-item-in-tabbar' : ''}>
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
          <span>© 2026 Chirag Bangera · Novel Compass</span>
          <nav aria-label="Footer links">
            <a href={viewUrl('profile')}>Local data</a>
            {!staticDeployment && <a href={viewUrl('scraper')}>Catalog tools</a>}
            <a
              href="https://github.com/cbangera2/novelcompass-data"
              target="_blank"
              rel="noopener noreferrer"
            >
              Data Repo
            </a>
            <a
              href="https://github.com/cbangera2/NovelCompass"
              target="_blank"
              rel="noopener noreferrer"
            >
              GitHub
            </a>
            <a
              href="https://github.com/cbangera2/NovelCompass/issues"
              target="_blank"
              rel="noopener noreferrer"
            >
              Report Issue
            </a>
          </nav>
        </footer>
      </SidebarInset>
      <nav className="shell-tabbar" aria-label="Primary">
        {TAB_ITEMS.map(({ view, label, icon: Icon }) => (
          <a
            key={view}
            href={viewUrl(view)}
            className={activeView === view ? 'active' : ''}
            aria-current={activeView === view ? 'page' : undefined}
          >
            <Icon size={20} aria-hidden="true" />
            <span>{label}</span>
          </a>
        ))}
      </nav>
    </SidebarProvider>
  );
}

function SidebarMediaGroup() {
  const { isSelected, toggleType, isAllSelected, scopeLabel } = useMediaFilterState();
  const choices: Array<{ type: MediaTypeChoice; label: string; icon: any }> = [
    { type: 'novel', label: 'Light Novels', icon: Book },
    { type: 'manga', label: 'Manga & Comics', icon: ImageIcon },
    { type: 'anime', label: 'Anime & Series', icon: Film },
  ];

  return (
    <SidebarGroup className="sidebar-group-compact sidebar-group-formats">
      <SidebarGroupLabel>Formats</SidebarGroupLabel>
      <SidebarMenu>
        {choices.map(({ type, label, icon: Icon }) => {
          const on = isSelected(type);
          return (
            <SidebarMenuItem key={type}>
              <button
                type="button"
                className={`sidebar-menu-button sidebar-format ${on ? 'on' : ''}`}
                aria-pressed={on}
                title={`${label} — ${on ? 'included' : 'excluded'} in search, browse and recommendations`}
                onClick={() => toggleType(type)}
              >
                <Icon size={18} />
                <span><strong>{label}</strong></span>
                <span className="sidebar-format-check" aria-hidden="true">{on && <Check size={11} strokeWidth={3} />}</span>
              </button>
            </SidebarMenuItem>
          );
        })}
      </SidebarMenu>
      <p className="sidebar-format-hint">
        {isAllSelected ? 'Everything is included.' : `Only ${scopeLabel}.`} Applies to search, browse and recs.
      </p>
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
  const [seedMode, setSeedMode] = useState(false);
  const [loading, setLoading] = useState(false);
  const { settings } = useDisplaySettings();
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) { setOpen(false); setSeedMode(false); }
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
    const onOpen = (event: Event) => {
      setSeedMode((event as CustomEvent<OpenSearchDetail>).detail?.mode === 'seed');
      setOpen(true);
      window.setTimeout(() => inputRef.current?.focus(), 0);
    };
    window.addEventListener(OPEN_SEARCH_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_SEARCH_EVENT, onOpen);
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
  const hasPanelContent = loading || query.trim().length >= 2 || recent.length > 0 || seedMode;
  const searchPanel = (
    <div className="shell-search-panel" ref={rootRef}>
      <label>
        <Search size={17} aria-hidden="true" />
        <input
          ref={inputRef}
          type="search"
          value={query}
          placeholder={seedMode ? 'Search for a starting title…' : scopedPlaceholder}
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
            if (event.key === 'Escape') { setOpen(false); setSeedMode(false); }
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
                <Clock3 size={13} /> {seedMode ? 'Recent titles — pick a starting title' : 'Recent titles'}
              </p>
            )}
            {seedMode && query.trim().length < 2 && recent.length === 0 && (
              <p className="shell-search-state">Type a title to use as the starting point.</p>
            )}
            {(query.trim().length >= 2 ? results : recent).map((novel) => (
              <SearchResultRow
                key={novel.id}
                novel={novel}
                title={displayNovelTitle(novel.title, undefined, settings.titlePreference)}
                onNavigate={() => choose(novel)}
                onSelect={seedMode ? () => {
                  choose(novel);
                  emitSeedSelected(novel);
                  setOpen(false);
                  setSeedMode(false);
                  setQuery('');
                } : undefined}
              />
            ))}
          </div>
          {query.trim().length >= 2 && !seedMode && (
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
