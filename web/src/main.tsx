import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import ScraperDashboard from './ScraperDashboard';
import { ProfilePage } from './profile';
import './index.css';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    {new URLSearchParams(window.location.search).get('view') === 'scraper'
      ? <ScraperDashboard />
      : new URLSearchParams(window.location.search).get('view') === 'profile'
        ? <ProfilePage />
        : <App />}
  </React.StrictMode>
);
