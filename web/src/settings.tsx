import { useEffect, useState } from 'react';

export type ThemePreference = 'system' | 'dark' | 'light';
export type TitlePreference = 'catalog' | 'alternate';
export interface DisplaySettings { theme: ThemePreference; titlePreference: TitlePreference; }

const STORAGE_KEY = 'novel-recommender-display-settings-v1';
const DEFAULTS: DisplaySettings = { theme: 'system', titlePreference: 'catalog' };

function loadSettings(): DisplaySettings {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') }; }
  catch { return DEFAULTS; }
}

function resolveTheme(theme: ThemePreference): 'dark' | 'light' {
  return theme === 'system'
    ? (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
    : theme;
}

export function useDisplaySettings() {
  const [settings, setSettings] = useState<DisplaySettings>(loadSettings);
  useEffect(() => {
    const apply = () => {
      const theme = resolveTheme(settings.theme);
      document.documentElement.dataset.theme = theme;
      document.documentElement.style.colorScheme = theme;
    };
    apply();
    const media = window.matchMedia('(prefers-color-scheme: light)');
    media.addEventListener('change', apply);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    return () => media.removeEventListener('change', apply);
  }, [settings]);
  useEffect(() => {
    const sync = () => setSettings(loadSettings());
    window.addEventListener('storage', sync);
    window.addEventListener('novel-display-settings', sync);
    return () => {
      window.removeEventListener('storage', sync);
      window.removeEventListener('novel-display-settings', sync);
    };
  }, []);
  return {
    settings,
    updateSettings: (next: Partial<DisplaySettings>) => setSettings((current) => {
      const updated = { ...current, ...next };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      window.dispatchEvent(new Event('novel-display-settings'));
      return updated;
    })
  };
}

export function displayNovelTitle(catalogTitle: string, associatedNames: string[] | undefined, preference: TitlePreference): string {
  if (preference !== 'alternate') return catalogTitle;
  return associatedNames?.find((name) => name.trim() && name.trim() !== catalogTitle.trim())?.trim() || catalogTitle;
}
