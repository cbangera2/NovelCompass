// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { useDisplaySettings } from '../../../web/src/settings';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

beforeEach(() => {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: memoryStorage(),
  });
});

afterEach(() => {
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.style.removeProperty('color-scheme');
  window.localStorage.clear();
});

describe('embedded display settings', () => {
  it('does not read, write, or apply website settings to the Novel Updates host', () => {
    window.localStorage.setItem(
      'novel-recommender-display-settings-v1',
      JSON.stringify({ theme: 'light', titlePreference: 'alternate' }),
    );
    document.documentElement.dataset.theme = 'novel-updates-theme';
    document.documentElement.style.colorScheme = 'dark';
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);

    act(() => root.render(<EmbeddedSettingsProbe />));

    expect(container.textContent).toBe('system:catalog');
    expect(document.documentElement.dataset.theme).toBe('novel-updates-theme');
    expect(document.documentElement.style.colorScheme).toBe('dark');
    expect(window.localStorage.getItem('novel-recommender-display-settings-v1')).toContain(
      '"theme":"light"',
    );

    act(() => root.unmount());
    container.remove();
  });
});

function EmbeddedSettingsProbe(): JSX.Element {
  const { settings } = useDisplaySettings({ persist: false });
  return <span>{`${settings.theme}:${settings.titlePreference}`}</span>;
}

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => {
      values.delete(key);
    },
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}
