import { Monitor, Moon, Sun, Type } from 'lucide-react';
import { useDisplaySettings } from './settings';
import { Badge, Card, CardHeader } from './design-system';

export default function SettingsPage(): JSX.Element {
  const { settings, updateSettings } = useDisplaySettings();
  return (
    <main className="settings-page">
      <header>
        <span className="eyebrow">Local preferences</span>
        <h1>Settings</h1>
        <p>Appearance and display choices stay in this browser and apply to Browse, recommendations, profiles, and novel details.</p>
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
        <CardHeader title="Novel titles" description="Choose how titles are displayed when the active dataset provides associated names." action={<Type size={19} />} />
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
