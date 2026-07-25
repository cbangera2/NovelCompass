import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import ScraperDashboard from './ScraperDashboard';
import { ProfilePage } from './profile';
import BrowsePage from './BrowsePage';
import AppShell, { AppView } from './AppShell';
import SettingsPage from './SettingsPage';
import NovelPage from './NovelPage';
import './index.css';
import { loadNavigationPreferences } from './preferences';

const locationParams = new URLSearchParams(window.location.search);
const requestedView = locationParams.get('view');
const hasExplicitDiscoverSeed = locationParams.has('seed');
const activeView: AppView = requestedView === 'discover' || requestedView === 'scraper' || requestedView === 'browse' || requestedView === 'profile' || requestedView === 'settings' || requestedView === 'novel'
  ? requestedView
  : hasExplicitDiscoverSeed ? 'discover' : loadNavigationPreferences().homeView;

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <AppShell activeView={activeView}>
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
    </AppShell>
  </React.StrictMode>
);
