// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ExtensionShell } from '../../src/ui/ExtensionShell';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;
const storedPreferences = new Map<string, string>();

beforeEach(() => {
  storedPreferences.clear();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => storedPreferences.get(key) ?? null,
      setItem: (key: string, value: string) => storedPreferences.set(key, value),
    },
  });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('ExtensionShell', () => {
  it('renders route-aware navigation and wraps route content', () => {
    renderShell();

    expect(container.querySelector('[aria-current="page"]')?.textContent).toContain('Series finder');
    expect(container.querySelector('#novel-compass-route-content')?.textContent).toBe(
      'Route content',
    );
    expect(container.textContent).toContain('Series ranking');
    expect(container.textContent).toContain('Reading list');
  });

  it('offers original view from the shared sidebar', () => {
    const onShowOriginal = vi.fn();
    renderShell({ onShowOriginal });

    const button = Array.from(container.querySelectorAll('button')).find((candidate) =>
      candidate.textContent?.includes('Original Novel Updates'),
    );
    act(() => button?.click());
    expect(onShowOriginal).toHaveBeenCalledOnce();
  });

  it('renders the minimal account contract without inventing logged-in state', () => {
    renderShell({
      account: {
        status: 'logged-in',
        username: 'Fixture Reader',
        profileUrl: 'https://www.novelupdates.com/user/fixture-reader/',
      },
    });

    expect(container.textContent).toContain('Fixture Reader');
    expect(
      container.querySelector<HTMLAnchorElement>(
        'a[href="https://www.novelupdates.com/user/fixture-reader/"]',
      ),
    ).not.toBeNull();
  });

  it('opens and closes the mobile navigation without duplicating it by default', () => {
    renderShell();
    expect(container.querySelector('.extension-shell-mobile-drawer')).toBeNull();

    const open = container.querySelector<HTMLButtonElement>('.extension-shell-menu-trigger');
    act(() => open?.click());
    expect(open?.getAttribute('aria-expanded')).toBe('true');
    expect(container.querySelector('.extension-shell-mobile-drawer')).not.toBeNull();

    const close = container.querySelector<HTMLButtonElement>('.extension-shell-mobile-close');
    act(() => close?.click());
    expect(container.querySelector('.extension-shell-mobile-drawer')).toBeNull();
  });

  it('collapses the desktop sidebar and persists the preference', () => {
    renderShell();
    const toggle = container.querySelector<HTMLButtonElement>('.extension-shell-sidebar-toggle');
    expect(toggle?.getAttribute('aria-label')).toBe('Collapse sidebar');

    act(() => toggle?.click());
    expect(container.querySelector('.extension-shell-sidebar')?.classList).toContain('is-collapsed');
    expect(container.querySelector('.extension-shell-inset')?.classList).toContain(
      'is-sidebar-collapsed',
    );
    expect(window.localStorage.getItem('novel-compass:sidebar-collapsed')).toBe('true');
    expect(toggle?.getAttribute('aria-label')).toBe('Expand sidebar');
  });
});

function renderShell(
  overrides: Partial<React.ComponentProps<typeof ExtensionShell>> = {},
): void {
  act(() => {
    root.render(
      <ExtensionShell
        activeRoute="series-finder"
        onShowOriginal={() => undefined}
        {...overrides}
      >
        <div>Route content</div>
      </ExtensionShell>,
    );
  });
}
