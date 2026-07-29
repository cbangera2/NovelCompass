// @vitest-environment happy-dom

import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { describe, expect, it, vi } from 'vitest';

import type { LiveReadingLibraryPage } from '../../src/adapters/contracts';
import { ExtensionReadingLibraryApp } from '../../src/ui/ExtensionReadingLibraryApp';

const page: LiveReadingLibraryPage = {
  title: 'Reading List',
  tabs: [{ label: 'Reading', url: 'https://www.novelupdates.com/reading-list/', count: 2, selected: true }],
  rows: [
    {
      title: 'Alpha Story',
      seriesUrl: 'https://www.novelupdates.com/series/alpha-story/',
      listLabel: 'Reading',
      statusLabel: 'Ongoing',
      progressLabel: 'Chapter 2',
      latestRelease: { label: 'Chapter 5', url: 'https://www.novelupdates.com/extnu/5/' },
    },
    {
      title: 'Beta Story',
      seriesUrl: 'https://www.novelupdates.com/series/beta-story/',
      statusLabel: 'Completed',
    },
  ],
  currentPage: 1,
  pageLinks: [{ page: 1, url: 'https://www.novelupdates.com/reading-list/' }],
  warnings: [],
};

describe('ExtensionReadingLibraryApp', () => {
  it('renders live rows and filters this page without exposing mutations', () => {
    const onShowOriginal = vi.fn();
    const container = document.createElement('div');
    act(() => {
      createRoot(container).render(
        <ExtensionReadingLibraryApp page={page} onShowOriginal={onShowOriginal} />,
      );
    });
    expect(container.textContent).toContain('Alpha Story');
    expect(container.textContent).toContain('Continue with Chapter 5');
    expect(container.textContent).not.toContain('Move selected');

    expect(
      container.querySelector<HTMLInputElement>('[placeholder="Search saved titles"]'),
    ).toBeTruthy();
    expect(container.querySelectorAll('select option')).toHaveLength(3);

    container.querySelector<HTMLButtonElement>('.extension-library-hero button')?.click();
    expect(onShowOriginal).toHaveBeenCalledOnce();
  });
});
