import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import ScraperDashboard from './ScraperDashboard';
import { ProfilePage } from './profile';
import BrowsePage from './BrowsePage';
import AppShell, { AppView } from './AppShell';
import SettingsPage from './SettingsPage';
import './index.css';

const requestedView = new URLSearchParams(window.location.search).get('view');
const activeView: AppView = requestedView === 'scraper' || requestedView === 'browse' || requestedView === 'profile' || requestedView === 'settings'
  ? requestedView
  : 'discover';

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
              : <App />}
    </AppShell>
  </React.StrictMode>
);
