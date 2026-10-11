// @vitest-environment happy-dom

import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { describe, expect, it, vi } from 'vitest';

import { parseCatalogPage } from '../../src/adapters/catalog';
import { ExtensionCatalogApp } from '../../src/ui/ExtensionCatalogApp';
import catalogFixture from '../fixtures/catalog-comedy.html?raw';

describe('ExtensionCatalogApp', () => {
  it('renders linked novels, taxonomy chips, pagination, and Original View', () => {
    document.documentElement.innerHTML = catalogFixture;
    const parsed = parseCatalogPage(
      document,
      'https://www.novelupdates.com/genre/comedy/?pg=2',
    );
    const container = document.createElement('div');
    const onShowOriginal = vi.fn();

    act(() => {
      createRoot(container).render(
        <ExtensionCatalogApp page={parsed.page} onShowOriginal={onShowOriginal} />,
      );
    });

    expect(container.textContent).toContain('Comedy Novels');
    expect(container.textContent).toContain('Synthetic Comedy');
    expect(
      container.querySelector<HTMLAnchorElement>('a[href*="/genre/fantasy/"]')?.href,
    ).toBe('https://www.novelupdates.com/genre/fantasy/');
    expect(container.querySelector('[aria-current="page"]')?.textContent).toBe('2');
    container.querySelector<HTMLButtonElement>('button')?.click();
    expect(onShowOriginal).toHaveBeenCalledOnce();
  });
});
