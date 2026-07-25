export type HomeView = 'discover' | 'browse';

const NAVIGATION_KEY = 'novel-compass:navigation:v1';
const FILTER_CONTROL_KEY = 'novel-compass:filter-control:v1';
const FILTER_PREFIX = 'novel-compass:filters:v1:';

export interface NavigationPreferences { version: 1; homeView: HomeView; }
export interface FilterControlPreferences { version: 1; rememberFilters: boolean; }

function readObject(key: string): Record<string, unknown> {
  try {
    const value = JSON.parse(localStorage.getItem(key) || '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch { return {}; }
}

export function loadNavigationPreferences(): NavigationPreferences {
  const value = readObject(NAVIGATION_KEY);
  return { version: 1, homeView: value.homeView === 'browse' ? 'browse' : 'discover' };
}

export function saveNavigationPreferences(homeView: HomeView): void {
  localStorage.setItem(NAVIGATION_KEY, JSON.stringify({ version: 1, homeView }));
  window.dispatchEvent(new Event('novel-navigation-preferences'));
}

export function loadFilterControlPreferences(): FilterControlPreferences {
  const value = readObject(FILTER_CONTROL_KEY);
  return { version: 1, rememberFilters: value.rememberFilters === true };
}

export function saveFilterControlPreferences(rememberFilters: boolean): void {
  localStorage.setItem(FILTER_CONTROL_KEY, JSON.stringify({ version: 1, rememberFilters }));
  window.dispatchEvent(new Event('novel-filter-preferences'));
}

export function loadFilterSnapshot<T extends Record<string, unknown>>(surface: 'browse' | 'discover', defaults: T): T {
  if (!loadFilterControlPreferences().rememberFilters) return defaults;
  const saved = readObject(`${FILTER_PREFIX}${surface}`);
  if (saved.version !== 1) return defaults;
  const compatible = Object.fromEntries(Object.entries(defaults).flatMap(([key, fallback]) => {
    const value = saved[key];
    if (typeof value !== typeof fallback || Array.isArray(value) !== Array.isArray(fallback)) return [];
    return [[key, value]];
  }));
  return { ...defaults, ...compatible };
}

export function saveFilterSnapshot(surface: 'browse' | 'discover', value: Record<string, unknown>): void {
  if (!loadFilterControlPreferences().rememberFilters) return;
  localStorage.setItem(`${FILTER_PREFIX}${surface}`, JSON.stringify({ ...value, version: 1 }));
}

export function resetSavedFilters(): void {
  localStorage.removeItem(`${FILTER_PREFIX}browse`);
  localStorage.removeItem(`${FILTER_PREFIX}discover`);
  window.dispatchEvent(new Event('novel-filter-preferences'));
}

export function defaultHomeUrl(): string {
  return loadNavigationPreferences().homeView === 'browse'
    ? `${import.meta.env.BASE_URL}?view=browse`
    : import.meta.env.BASE_URL;
}
