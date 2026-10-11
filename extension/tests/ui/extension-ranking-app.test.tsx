// @vitest-environment happy-dom

import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

import { parseRankingPage } from '../../src/adapters/ranking';
import { ExtensionRankingApp } from '../../src/ui/ExtensionRankingApp';
import rankingFixture from '../fixtures/series-ranking.html?raw';

describe('ExtensionRankingApp', () => {
  it('renders live ranking semantics and delegates ranking navigation', () => {
    document.open();
    document.write(rankingFixture);
    document.close();
    const page = parseRankingPage(
      document,
      'https://www.novelupdates.com/series-ranking/?rank=popmonth&pg=2',
    ).page;
    const container = document.createElement('div');
    document.body.replaceChildren(container);
    const onNavigate = vi.fn();

    act(() => {
      createRoot(container).render(
        createElement(ExtensionRankingApp, {
          page,
          onNavigate,
          onShowOriginal: vi.fn(),
        }),
      );
    });

    expect(container.textContent).toContain('Synthetic Moon');
    expect(container.textContent).toContain('Popular (Month)');
    expect(container.textContent).toContain('1,499');
    expect(container.querySelector('a[href$="/series/synthetic-moon/"]')).not.toBeNull();

    const popularAll = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Popular (All)',
    );
    act(() => popularAll?.click());
    expect(onNavigate).toHaveBeenCalledWith(
      'https://www.novelupdates.com/series-ranking/?rank=popular',
    );
  });
});
