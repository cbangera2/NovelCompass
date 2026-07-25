import { ReactNode, useEffect, useState } from 'react';
import { BookMarked, BookOpen, ChevronLeft, ChevronRight, Database, ExternalLink, Menu, Settings, Sparkles, User, X } from 'lucide-react';
import { configuredDataMode } from './data';
import { LocalUserProfile } from './profile';
import { loadLocalProfile } from './profile/store';
import { Tooltip } from './ui';
import { Badge } from './design-system';
import './app-shell.css';

export type AppView = 'discover' | 'browse' | 'profile' | 'settings' | 'scraper' | 'novel';

const NAV_ITEMS = [
  { view: 'discover' as const, label: 'Discover', note: 'Find related novels', icon: Sparkles },
  { view: 'browse' as const, label: 'Browse', note: 'Explore the catalog', icon: BookOpen },
  { view: 'profile' as const, label: 'Profile', note: 'Your local library', icon: User },
  { view: 'settings' as const, label: 'Settings', note: 'Appearance & titles', icon: Settings },
  { view: 'scraper' as const, label: 'Scraper', note: 'Update local data', icon: Database }
];

function viewUrl(view: AppView): string {
  const base = import.meta.env.BASE_URL;
  return view === 'discover' ? base : `${base}?view=${view}`;
}

export default function AppShell({ activeView, children }: { activeView: AppView; children: ReactNode }): JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => window.localStorage.getItem('novel-compass:sidebar-collapsed') === 'true');
  const [profile, setProfile] = useState<LocalUserProfile | null>(null);
  const dataMode = configuredDataMode();
  const staticDeployment = dataMode === 'static' || window.location.hostname.endsWith('.github.io');
  const navItems = NAV_ITEMS.filter((item) => item.view !== 'scraper' || !staticDeployment);
  const toggleSidebar = () => setCollapsed((value) => {
    window.localStorage.setItem('novel-compass:sidebar-collapsed', String(!value));
    return !value;
  });

  useEffect(() => {
    const refreshProfile = () => loadLocalProfile().then(setProfile).catch(() => setProfile(null));
    refreshProfile();
    window.addEventListener('focus', refreshProfile);
    return () => window.removeEventListener('focus', refreshProfile);
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: KeyboardEvent) => event.key === 'Escape' && setMenuOpen(false);
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [menuOpen]);

  useEffect(() => {
    const toggleFromKeyboard = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (!event.altKey || event.code !== 'Backslash' || target?.matches('input, textarea, select, [contenteditable="true"]')) return;
      event.preventDefault();
      toggleSidebar();
    };
    window.addEventListener('keydown', toggleFromKeyboard);
    return () => window.removeEventListener('keydown', toggleFromKeyboard);
  }, []);

  return (
    <div className={`application-shell ${collapsed ? 'sidebar-collapsed' : ''}`}>
      <header className="shell-mobile-header">
        <a className="shell-brand compact" href={viewUrl('discover')} aria-label="Novel Compass home">
          <span><BookMarked size={18} /></span><strong>Novel Compass</strong>
        </a>
        <div className="shell-mobile-actions">
          <a className="shell-mobile-account" href={viewUrl('profile')}
            aria-label={profile ? `Open local profile for ${profile.username || 'reader'}` : 'Open local profile'}>
            <User size={17} />{profile && <Badge tone="violet">{profile.entries.length}</Badge>}
          </a>
          <button className="shell-menu-button" aria-label={menuOpen ? 'Close navigation' : 'Open navigation'}
            aria-expanded={menuOpen} onClick={() => setMenuOpen((value) => !value)}>
            {menuOpen ? <X /> : <Menu />}
          </button>
        </div>
      </header>
      {menuOpen && <button className="shell-scrim" aria-label="Close navigation" onClick={() => setMenuOpen(false)} />}
      <aside className={`shell-sidebar ${menuOpen ? 'open' : ''}`}>
        <a className="shell-brand" href={viewUrl('discover')}>
          <span><BookMarked size={21} /></span>
          <div><strong>Novel Compass</strong><small>Relationship-first discovery</small></div>
        </a>
        <Tooltip content={`${collapsed ? 'Expand' : 'Collapse'} sidebar · Alt+\\`}>
          <button className="shell-collapse" aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-expanded={!collapsed} onClick={toggleSidebar}>
            {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
            <span>Collapse sidebar</span>
          </button>
        </Tooltip>
        <nav className="shell-nav" aria-label="Application navigation">
          <p>Explore</p>
          {navItems.map((item) => {
            const Icon = item.icon;
            return <a key={item.view} href={viewUrl(item.view)} className={activeView === item.view ? 'active' : ''}
              aria-current={activeView === item.view ? 'page' : undefined} onClick={() => setMenuOpen(false)}>
              <Icon size={18} /><span><strong>{item.label}</strong><small>{item.note}</small></span>
            </a>;
          })}
        </nav>
        <div className="shell-sidebar-footer">
          <a className={`shell-account ${activeView === 'profile' ? 'active' : ''}`} href={viewUrl('profile')}>
            <span className="shell-avatar"><User size={16} /></span>
            <span><strong>{profile?.username || 'Local profile'}</strong>
              <small>{profile ? `${profile.entries.length.toLocaleString()} saved title${profile.entries.length === 1 ? '' : 's'}` : 'Private to this browser'}</small>
            </span>
          </a>
          <a href="https://www.novelupdates.com/" target="_blank" rel="noopener noreferrer">
            Novel Updates <ExternalLink size={13} />
          </a>
        </div>
      </aside>
      <div className="shell-main">
        <div className="shell-content">{children}</div>
        <footer className="shell-footer">
          <span>Novel Compass · personal discovery workspace</span>
          <nav aria-label="Footer links">
            <a href={viewUrl('profile')}>Local data</a>
            {!staticDeployment && <a href={viewUrl('scraper')}>Catalog tools</a>}
            <a href="https://github.com/shaido987/novel-dataset" target="_blank" rel="noopener noreferrer">Source dataset</a>
          </nav>
        </footer>
      </div>
    </div>
  );
}
