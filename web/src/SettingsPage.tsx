import { Compass, FilterX, Monitor, Moon, Sun, Type } from 'lucide-react';
import { useDisplaySettings } from './settings';
import { Badge, Card, CardHeader } from './design-system';
import { loadFilterControlPreferences, loadNavigationPreferences, resetSavedFilters, saveFilterControlPreferences, saveNavigationPreferences } from './preferences';
import { useState } from 'react';
import { DataMode } from './data';
import { useDataModePreference } from './dataModePreference';

import { Select } from './ui';

export default function SettingsPage(): JSX.Element {
  const { settings, updateSettings } = useDisplaySettings();
  const [homeView, setHomeView] = useState(() => loadNavigationPreferences().homeView);
  const [rememberFilters, setRememberFilters] = useState(() => loadFilterControlPreferences().rememberFilters);
  const [resetMessage, setResetMessage] = useState('');
  const { mode: dataMode, forcedMode, setMode: setDataMode } = useDataModePreference();
  return (
    <main className="settings-page">
      <header>
        <span className="eyebrow">Local preferences</span>
        <h1>Settings</h1>
        <p>Appearance and display choices stay in this browser and apply to Browse, recommendations, profiles, and title details.</p>
      </header>
      <Card className="settings-card">
        <CardHeader title="Appearance" description="Follow your device or choose a fixed theme." action={<Sun size={19} />} />
        <div className="settings-choice-grid">
          {([
            ['system', Monitor, 'System', 'Follow this device'],
            ['dark', Moon, 'Dark', 'Low-light interface'],
            ['light', Sun, 'Light', 'Bright, high-contrast interface']
          ] as const).map(([value, Icon, label, note]) => (
            <button key={value} className={settings.theme === value ? 'selected' : ''} onClick={() => updateSettings({ theme: value })} aria-pressed={settings.theme === value}>
              <Icon size={18} /><span><strong>{label}</strong><small>{note}</small></span>
            </button>
          ))}
        </div>
      </Card>
      <Card className="settings-card">
        <CardHeader title="Home & filters" description="Choose where the logo opens and whether filter controls return as you left them." action={<Compass size={19} />} />
        <div className="settings-choice-grid title-choices">
          {(['discover', 'browse'] as const).map((value) => <button key={value} className={homeView === value ? 'selected' : ''}
            aria-pressed={homeView === value} onClick={() => { setHomeView(value); saveNavigationPreferences(value); }}>
            <span><strong>{value === 'discover' ? 'Discover home' : 'Browse home'}</strong><small>{value === 'discover' ? 'Start from a title relationship search' : 'Start from the full catalog'}</small></span>
          </button>)}
        </div>
        <label className="settings-toggle"><input type="checkbox" checked={rememberFilters}
          onChange={(event) => { setRememberFilters(event.target.checked); saveFilterControlPreferences(event.target.checked); }} />
          <span><strong>Remember Browse and Discover filters</strong><small>Restore the most recently used filters when returning. Explicit URL filters always win.</small></span>
        </label>
        <button className="settings-reset-button" onClick={() => { resetSavedFilters(); setResetMessage('Saved filter snapshots cleared.'); }}><FilterX size={15} />Reset saved filters</button>
        {resetMessage && <p className="settings-disclosure" role="status">{resetMessage}</p>}
      </Card>
      <Card className="settings-card">
        <CardHeader title="Title display" description="Choose how titles are displayed when the active dataset provides associated names." action={<Type size={19} />} />
        <div className="settings-choice-grid title-choices">
          <button className={settings.titlePreference === 'catalog' ? 'selected' : ''} onClick={() => updateSettings({ titlePreference: 'catalog' })} aria-pressed={settings.titlePreference === 'catalog'}>
            <span><strong>Catalog title</strong><small>Use the primary title from the active snapshot</small></span>
          </button>
          <button className={settings.titlePreference === 'alternate' ? 'selected' : ''} onClick={() => updateSettings({ titlePreference: 'alternate' })} aria-pressed={settings.titlePreference === 'alternate'}>
            <span><strong>First alternate when available</strong><small>Falls back to the catalog title when details have no alternate</small></span>
          </button>
        </div>
        <p className="settings-disclosure">Associated names are unordered. The dataset does not prove which title is English, original-language, official, or fan-translated, so this setting deliberately makes none of those claims. Catalog search and compact recommendation records may not include alternates and will fall back consistently.</p>
      </Card>
      <Card className="settings-card">
        <CardHeader title="Data source" description="Choose how this browser loads catalog and recommendation data." />
        <Select label="Catalog source" value={dataMode}
          disabled={Boolean(forcedMode)} onChange={(event) => setDataMode(event.target.value as DataMode)}>
          <option value="auto">Automatic (live API, then static fallback)</option>
          <option value="api">Live database</option>
          <option value="static">Static snapshot</option>
        </Select>
        <p className="settings-disclosure">{forcedMode
          ? `This deployment forces the ${forcedMode === 'static' ? 'static snapshot' : 'live API'} source, so a browser preference cannot override it.`
          : 'Saved locally and synchronized across tabs. If Live database is unavailable, the app shows an error and keeps your choice so you can retry; only Automatic falls back.'}</p>
      </Card>
      <Card className="settings-storage-note">
        <Badge tone="green">Private local setting</Badge>
        <p>These choices use browser local storage. They are not sent to Novel Updates and do not represent a Novel Updates account preference.</p>
      </Card>
      <Card className="settings-storage-note">
        <Badge>Keyboard shortcut</Badge>
        <p><kbd>Alt</kbd> + <kbd>\</kbd> collapses or expands the sidebar. It is disabled while focus is inside a text field, select, or editable area.</p>
      </Card>
    </main>
  );
}
