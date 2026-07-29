import {
  Award,
  BookMarked,
  BookOpen,
  Home,
  List,
  LogIn,
  Menu,
  Search,
  User,
  X,
} from 'lucide-react';
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from 'react';

import { NovelCompassMark } from '../../../web/src/NovelCompassMark';
import type { NovelUpdatesAccountState } from '../adapters/contracts';
import './extension-shell.css';

export type ExtensionRoute =
  | 'series'
  | 'series-finder'
  | 'series-ranking'
  | 'recommendation-lists'
  | 'reading-library'
  | 'other';

export interface ExtensionShellProps {
  activeRoute: ExtensionRoute;
  account?: NovelUpdatesAccountState;
  children?: ReactNode;
  onInvokeAccountAction?: (actionId: string) => void;
  onShowOriginal: () => void;
}

const NAV_GROUPS = [
  {
    label: 'Discover',
    items: [
      {
        route: 'other' as const,
        label: 'Latest releases',
        note: 'What is new',
        href: 'https://www.novelupdates.com/',
        icon: Home,
      },
      {
        route: 'series-finder' as const,
        label: 'Series finder',
        note: 'Search the catalog',
        href: 'https://www.novelupdates.com/series-finder/',
        icon: Search,
      },
      {
        route: 'series-ranking' as const,
        label: 'Series ranking',
        note: 'Popular titles',
        href: 'https://www.novelupdates.com/series-ranking/',
        icon: Award,
      },
    ],
  },
  {
    label: 'Library & community',
    items: [
      {
        route: 'reading-library' as const,
        label: 'Reading list',
        note: 'Your saved novels',
        href: 'https://www.novelupdates.com/reading-list/',
        icon: BookMarked,
      },
      {
        route: 'recommendation-lists' as const,
        label: 'Recommendation lists',
        note: 'Reader-curated lists',
        href: 'https://www.novelupdates.com/recommendation-lists/',
        icon: List,
      },
    ],
  },
];

export function ExtensionShell({
  activeRoute,
  account = { status: 'unknown', warnings: [] },
  children,
  onInvokeAccountAction,
  onShowOriginal,
}: ExtensionShellProps): JSX.Element {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!mobileOpen) return;
    closeButtonRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [mobileOpen]);

  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    const query = searchQuery.trim();
    const url = new URL('https://www.novelupdates.com/series-finder/');
    if (query) url.searchParams.set('q', query);
    window.location.assign(url.href);
  };

  const navigation = (
    <>
      <header className="extension-shell-sidebar-header">
        <a className="extension-shell-brand" href="https://www.novelupdates.com/">
          <NovelCompassMark />
          <span>
            <strong>Novel Compass</strong>
            <small>Novel Updates, reimagined</small>
          </span>
        </a>
      </header>
      <div className="extension-shell-sidebar-content">
        {NAV_GROUPS.map((group) => (
          <section className="extension-shell-nav-group" key={group.label}>
            <h2>{group.label}</h2>
            <nav aria-label={group.label}>
              {group.items.map((item) => {
                const Icon = item.icon;
                const active = activeRoute === item.route && item.route !== 'other';
                return (
                  <a
                    aria-current={active ? 'page' : undefined}
                    className={active ? 'is-active' : undefined}
                    href={item.href}
                    key={item.href}
                    onClick={() => setMobileOpen(false)}
                  >
                    <Icon aria-hidden="true" size={18} />
                    <span>
                      <strong>{item.label}</strong>
                      <small>{item.note}</small>
                    </span>
                  </a>
                );
              })}
            </nav>
          </section>
        ))}
      </div>
      <footer className="extension-shell-sidebar-footer">
        <AccountSummary account={account} onInvokeAction={onInvokeAccountAction} />
        <button type="button" onClick={onShowOriginal}>
          <BookOpen aria-hidden="true" size={17} />
          <span>
            <strong>Original Novel Updates</strong>
            <small>Temporarily restore this page</small>
          </span>
        </button>
      </footer>
    </>
  );

  return (
    <div className="extension-shell">
      <a className="extension-shell-skip-link" href="#novel-compass-route-content">
        Skip to content
      </a>
      <aside className="extension-shell-sidebar" aria-label="Primary navigation">
        {navigation}
      </aside>
      {mobileOpen ? (
        <div className="extension-shell-mobile-layer">
          <button
            aria-label="Close navigation"
            className="extension-shell-mobile-backdrop"
            onClick={() => setMobileOpen(false)}
            type="button"
          />
          <aside className="extension-shell-mobile-drawer" aria-label="Primary navigation">
            <button
              aria-label="Close navigation"
              className="extension-shell-mobile-close"
              onClick={() => setMobileOpen(false)}
              ref={closeButtonRef}
              type="button"
            >
              <X size={18} />
            </button>
            {navigation}
          </aside>
        </div>
      ) : null}
      <div className="extension-shell-inset">
        <header className="extension-shell-topbar">
          <button
            aria-expanded={mobileOpen}
            aria-label="Open navigation"
            className="extension-shell-menu-trigger"
            onClick={() => setMobileOpen(true)}
            type="button"
          >
            <Menu size={19} />
          </button>
          <form aria-label="Search Novel Updates" onSubmit={submitSearch}>
            <Search aria-hidden="true" size={17} />
            <input
              aria-label="Search novels"
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search novels…"
              type="search"
              value={searchQuery}
            />
          </form>
          <AccountCompact account={account} />
        </header>
        <div id="novel-compass-route-content">{children}</div>
      </div>
    </div>
  );
}

function AccountSummary({
  account,
  onInvokeAction,
}: {
  account: NovelUpdatesAccountState;
  onInvokeAction?: (actionId: string) => void;
}): JSX.Element {
  if (account.status === 'logged-in') {
    return (
      <div className="extension-shell-account-links">
        {account.profileUrl ? (
          <a href={account.profileUrl}>
            <User aria-hidden="true" size={17} />
            <span>
              <strong>{account.username}</strong>
              <small>Novel Updates profile</small>
            </span>
          </a>
        ) : (
          <div>
            <User aria-hidden="true" size={17} />
            <span>
              <strong>{account.username}</strong>
              <small>Novel Updates account</small>
            </span>
          </div>
        )}
        {account.accountUrl ? <a href={account.accountUrl}>Account settings</a> : null}
        {account.followingUrl ? <a href={account.followingUrl}>Following</a> : null}
        {account.alertsUrl ? (
          <a href={account.alertsUrl}>
            Alerts{account.alertCount === undefined ? '' : ` (${account.alertCount})`}
          </a>
        ) : null}
        {account.messagesUrl ? (
          <a href={account.messagesUrl} rel="noopener noreferrer">
            Forum messages
          </a>
        ) : null}
        {account.logoutActionId && onInvokeAction ? (
          <button type="button" onClick={() => onInvokeAction(account.logoutActionId!)}>
            Log out
          </button>
        ) : null}
      </div>
    );
  }
  const loginUrl =
    account.status === 'logged-out' ? account.loginUrl : 'https://www.novelupdates.com/login/';
  return (
    <div className="extension-shell-account-links">
      <a href={loginUrl || 'https://www.novelupdates.com/login/'}>
        <LogIn aria-hidden="true" size={17} />
        <span>
          <strong>{account.status === 'unknown' ? 'Novel Updates account' : 'Log in'}</strong>
          <small>
            {account.status === 'unknown' ? 'Open account access' : 'Sync your reading list'}
          </small>
        </span>
      </a>
      {account.status === 'logged-out' && account.registerUrl ? (
        <a href={account.registerUrl}>Register</a>
      ) : null}
    </div>
  );
}

function AccountCompact({ account }: { account: NovelUpdatesAccountState }): JSX.Element {
  const label = account.status === 'logged-in' ? account.username : 'Account';
  const href =
    account.status === 'logged-in'
      ? account.profileUrl || 'https://www.novelupdates.com/'
      : account.status === 'logged-out'
        ? account.loginUrl || 'https://www.novelupdates.com/login/'
        : 'https://www.novelupdates.com/login/';
  return (
    <a className="extension-shell-account-compact" href={href}>
      <User aria-hidden="true" size={16} />
      <span>{label}</span>
    </a>
  );
}
