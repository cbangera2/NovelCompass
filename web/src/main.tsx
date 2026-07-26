import React, { lazy, Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import AppShell, { AppView } from './AppShell';
import './index.css';
import { loadNavigationPreferences } from './preferences';

const BrowsePage = lazy(() => import('./BrowsePage'));
const NovelPage = lazy(() => import('./NovelPage'));
const ProfilePage = lazy(() => import('./profile/ProfilePage'));
const ScraperDashboard = lazy(() => import('./ScraperDashboard'));
const SettingsPage = lazy(() => import('./SettingsPage'));

const locationParams = new URLSearchParams(window.location.search);
const requestedView = locationParams.get('view');
const isDetailView = requestedView === 'novel' || requestedView === 'manga' || requestedView === 'anime' || requestedView === 'item';
const hasExplicitDiscoverSeed = locationParams.has('seed');
const activeView: AppView = isDetailView
  ? 'novel'
  : requestedView === 'discover' || requestedView === 'scraper' || requestedView === 'browse' || requestedView === 'profile' || requestedView === 'settings'
    ? requestedView
    : hasExplicitDiscoverSeed ? 'discover' : loadNavigationPreferences().homeView;

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <AppShell activeView={activeView}>
      <Suspense fallback={<main className="route-loading" aria-busy="true"><span>Loading workspace…</span></main>}>
        {activeView === 'scraper'
          ? <ScraperDashboard />
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
  </React.StrictMode>
);
