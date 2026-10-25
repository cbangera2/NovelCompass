import React, { lazy, Suspense } from 'react';
import { flushSync } from 'react-dom';
import ReactDOM from 'react-dom/client';
import App from './App';
import AppShell, { AppView } from './AppShell';
import { CoverPreviewHost } from './CoverPreview';
import './index.css';
import './view-transitions.css';
import { NovelCoverGhost } from './components/NovelCoverGhost';
import { installViewTransitions } from './viewTransitions';
import { loadNavigationPreferences } from './preferences';

const BrowsePage = lazy(() => import('./BrowsePage'));
const NovelPage = lazy(() => import('./NovelPage'));
const ForYouPage = lazy(() => import('./ForYouPage'));
const ListPage = lazy(() => import('./ListPage'));
const ProfilePage = lazy(() => import('./profile/ProfilePage'));
const ScraperDashboard = lazy(() => import('./ScraperDashboard'));
const SettingsPage = lazy(() => import('./SettingsPage'));

function routeElement() {
  const locationParams = new URLSearchParams(window.location.search);
  const requestedView = locationParams.get('view');
  const isDetailView = requestedView === 'novel' || requestedView === 'manga' || requestedView === 'anime' || requestedView === 'item';
  const hasExplicitDiscoverSeed = locationParams.has('seed');
  const isListView = requestedView === 'list';
  const activeView: AppView = isListView
    ? 'foryou' // list pages live under For You in the sidebar
    : isDetailView
    ? 'novel'
    : requestedView === 'discover' || requestedView === 'foryou' || requestedView === 'scraper' || requestedView === 'browse' || requestedView === 'profile' || requestedView === 'settings'
      ? requestedView
      : hasExplicitDiscoverSeed ? 'discover' : loadNavigationPreferences().homeView;

  return (
    <React.StrictMode>
      <AppShell activeView={activeView}>
        {/* Keyed by the URL so moving between two titles (same page component) starts the new page fresh. */}
        <Suspense
          key={window.location.search}
          fallback={isDetailView
            ? <main className="vt-ghost-page" aria-busy="true"><NovelCoverGhost id={Number(locationParams.get('id')) || 0} /></main>
            : <main className="route-loading" aria-busy="true"><span>Loading workspace…</span></main>}
        >
          {isListView
            ? <ListPage />
            : activeView === 'scraper'
            ? <ScraperDashboard />
            : activeView === 'foryou'
              ? <ForYouPage />
            : activeView === 'browse'
              ? <BrowsePage />
              : activeView === 'profile'
                ? <ProfilePage />
                : activeView === 'settings'
                ? <SettingsPage />
                : activeView === 'novel'
                  ? <NovelPage />
                : <App />}
        </Suspense>
      </AppShell>
      <CoverPreviewHost />
    </React.StrictMode>
  );
}

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);
// Committed synchronously so a page transition can capture the new page as soon as it is drawn.
const renderRoute = () => flushSync(() => root.render(routeElement()));
installViewTransitions(renderRoute);
root.render(routeElement());
