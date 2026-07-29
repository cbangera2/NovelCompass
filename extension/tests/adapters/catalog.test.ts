// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';

import { parseCatalogPage } from '../../src/adapters/catalog';
import catalogFixture from '../fixtures/catalog-comedy.html?raw';

describe('parseCatalogPage', () => {
  it('normalizes taxonomy results and trusted navigation', () => {
    document.documentElement.innerHTML = catalogFixture;
    const result = parseCatalogPage(
      document,
      'https://www.novelupdates.com/genre/comedy/?pg=2',
    );

    expect(result.ok).toBe(true);
    expect(result.page).toMatchObject({
      title: 'Comedy Novels',
      currentPage: 2,
      previousUrl: 'https://www.novelupdates.com/genre/comedy/?pg=1',
      nextUrl: 'https://www.novelupdates.com/genre/comedy/?pg=3',
    });
    expect(result.page.rows).toEqual([
      expect.objectContaining({
        title: 'Synthetic Comedy',
        seriesUrl: 'https://www.novelupdates.com/series/synthetic-comedy/',
        language: 'Japanese',
        rating: 4.3,
        description: 'A deliberately synthetic catalog synopsis.',
        latestChapter: {
          label: 'Chapter 12',
          url: 'https://www.novelupdates.com/extnu/101/',
        },
        genres: [
          { label: 'Comedy', url: 'https://www.novelupdates.com/genre/comedy/' },
          { label: 'Fantasy', url: 'https://www.novelupdates.com/genre/fantasy/' },
        ],
      }),
    ]);
  });

  it('rejects empty unsupported catalog markup', () => {
    document.body.innerHTML = '<h1>Latest Series</h1>';
    expect(
      parseCatalogPage(document, 'https://www.novelupdates.com/latest-series/'),
    ).toMatchObject({
      ok: false,
      message: 'Novel Updates catalog markup is not supported.',
    });
  });
});
