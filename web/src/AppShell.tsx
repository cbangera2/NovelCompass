import { ReactNode, useEffect, useState } from 'react';
import { BookMarked, BookOpen, Database, ExternalLink, Menu, Sparkles, User, X } from 'lucide-react';
import { configuredDataMode } from './data';
import './app-shell.css';

export type AppView = 'discover' | 'browse' | 'profile' | 'scraper';

const NAV_ITEMS = [
  { view: 'discover' as const, label: 'Discover', note: 'Find related novels', icon: Sparkles },
  { view: 'browse' as const, label: 'Browse', note: 'Explore the catalog', icon: BookOpen },
  { view: 'profile' as const, label: 'Profile', note: 'Your local library', icon: User },
  { view: 'scraper' as const, label: 'Scraper', note: 'Update local data', icon: Database }
];

function viewUrl(view: AppView): string {
  const base = import.meta.env.BASE_URL;
  return view === 'discover' ? base : `${base}?view=${view}`;
}

export default function AppShell({ activeView, children }: { activeView: AppView; children: ReactNode }): JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false);
  const dataMode = configuredDataMode();

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: KeyboardEvent) => event.key === 'Escape' && setMenuOpen(false);
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [menuOpen]);

  return (
    <div className="application-shell">
      <header className="shell-mobile-header">
        <a className="shell-brand compact" href={viewUrl('discover')} aria-label="Novel Compass home">
          <span><BookMarked size={18} /></span><strong>Novel Compass</strong>
        </a>
        <button className="shell-menu-button" aria-label={menuOpen ? 'Close navigation' : 'Open navigation'}
          aria-expanded={menuOpen} onClick={() => setMenuOpen((value) => !value)}>
          {menuOpen ? <X /> : <Menu />}
        </button>
      </header>
      {menuOpen && <button className="shell-scrim" aria-label="Close navigation" onClick={() => setMenuOpen(false)} />}
      <aside className={`shell-sidebar ${menuOpen ? 'open' : ''}`}>
        <a className="shell-brand" href={viewUrl('discover')}>
          <span><BookMarked size={21} /></span>
          <div><strong>Novel Compass</strong><small>Relationship-first discovery</small></div>
        </a>
        <nav className="shell-nav" aria-label="Application navigation">
          <p>Explore</p>
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            return <a key={item.view} href={viewUrl(item.view)} className={activeView === item.view ? 'active' : ''}
              aria-current={activeView === item.view ? 'page' : undefined} onClick={() => setMenuOpen(false)}>
              <Icon size={18} /><span><strong>{item.label}</strong><small>{item.note}</small></span>
            </a>;
          })}
        </nav>
        <div className="shell-sidebar-footer">
          <div className="shell-status"><i /><span>
            <strong>{dataMode === 'auto' ? 'Automatic data source' : `${dataMode} data mode`}</strong>
            <small>Private, local-first tools</small>
          </span></div>
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
            <a href={viewUrl('scraper')}>Catalog tools</a>
            <a href="https://github.com/shaido987/novel-dataset" target="_blank" rel="noopener noreferrer">Source dataset</a>
          </nav>
        </footer>
      </div>
    </div>
  );
}
