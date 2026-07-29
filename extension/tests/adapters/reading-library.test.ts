// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';

import { parseReadingLibraryPage } from '../../src/adapters/reading-library';
import fixture from '../fixtures/reading-list.html?raw';

describe('parseReadingLibraryPage', () => {
  it('normalizes saved titles, list metadata, releases, tabs, and pagination', () => {
    document.documentElement.innerHTML = fixture;
    const result = parseReadingLibraryPage(
      document,
      'https://www.novelupdates.com/reading-list/?list=0&pg=2',
    );

    expect(result.ok).toBe(true);
    expect(result.page.title).toBe('Reading List');
    expect(result.page.rows).toHaveLength(2);
    expect(result.page.rows[0]).toMatchObject({
      title: 'Example Novel',
      seriesUrl: 'https://www.novelupdates.com/series/example-novel/',
      coverUrl: 'https://cdn.novelupdates.com/images/example.jpg',
      listLabel: 'Reading',
      statusLabel: 'Ongoing',
      progressLabel: 'Chapter 18',
      latestRelease: {
        label: 'Chapter 24',
        url: 'https://www.novelupdates.com/extnu/9001/',
      },
      updatedAt: '2 hours ago',
    });
    expect(result.page.tabs).toEqual([
      {
        label: 'Reading',
        url: 'https://www.novelupdates.com/reading-list/?list=0',
        count: 12,
        selected: true,
      },
      {
        label: 'Completed',
        url: 'https://www.novelupdates.com/reading-list/?list=1',
        count: 4,
        selected: false,
      },
    ]);
    expect(result.page).toMatchObject({
      currentPage: 2,
      nextUrl: 'https://www.novelupdates.com/reading-list/?list=0&pg=3',
    });
    expect(result.page.previousUrl).toBeUndefined();
  });

  it('fails closed when no series rows are available', () => {
    document.body.innerHTML = '<main><p>Your list is empty.</p></main>';
    expect(
      parseReadingLibraryPage(document, 'https://www.novelupdates.com/reading-list/'),
    ).toMatchObject({ ok: false, message: expect.stringContaining('not supported') });
  });
});
