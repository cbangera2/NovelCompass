// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';

import { parseRankingPage } from '../../src/adapters/ranking';
import rankingFixture from '../fixtures/series-ranking.html?raw';

const rankingUrl = 'https://www.novelupdates.com/series-ranking/?rank=popmonth&rl=1&pg=2';

describe('parseRankingPage', () => {
  it('normalizes ranking controls, live rows, and pagination', () => {
    document.open();
    document.write(rankingFixture);
    document.close();

    const result = parseRankingPage(document, rankingUrl);

    expect(result.ok).toBe(true);
    expect(result.page).toMatchObject({
      title: 'Series Ranking',
      activeRankingLabel: 'Popular (Month)',
      currentPage: 2,
      previousUrl: 'https://www.novelupdates.com/series-ranking/?rank=popmonth&pg=1',
      nextUrl: 'https://www.novelupdates.com/series-ranking/?rank=popmonth&pg=3',
      filters: {
        minimumChapters: 25,
        rankingTypes: [
          { label: 'Popular (All)', value: 'popular', selected: false },
          { label: 'Popular (Month)', value: 'popmonth', selected: true },
          { label: 'Activity (Week)', value: 'week', selected: false },
        ],
      },
    });
    expect(result.page.filters.languages).toEqual([
      { label: 'Chinese', value: '1', selected: true },
      { label: 'Korean', value: '3', selected: false },
    ]);
    expect(result.page.filters.genres).toEqual([
      { label: 'Fantasy', value: '8', selected: true, excluded: false },
      { label: 'Harem', value: '15', selected: true, excluded: true },
    ]);
    expect(result.page.rows[0]).toMatchObject({
      rank: 21,
      title: 'Synthetic Moon',
      seriesUrl: 'https://www.novelupdates.com/series/synthetic-moon/',
      coverUrl: 'https://cdn.novelupdates.com/images/synthetic-one.jpg',
      language: 'Korean',
      rating: 4.2,
      chapterCount: 174,
      releaseFrequency: 'Every 0.9 Day(s)',
      readerCount: 1499,
      reviewCount: 9,
      lastUpdated: '07-27-2026',
      description: 'A sanitized fixture description.',
      genres: [
        {
          label: 'Fantasy',
          url: 'https://www.novelupdates.com/genre/fantasy/',
        },
      ],
    });
  });

  it('fails closed when the document has no ranking rows', () => {
    document.body.innerHTML = '<h1>Series Ranking</h1>';
    const result = parseRankingPage(document, rankingUrl);
    expect(result.ok).toBe(false);
    expect(result.message).toContain('markup');
    expect(result.page.warnings).toContainEqual(
      expect.objectContaining({ code: 'unsupported-markup', field: 'rows' }),
    );
  });

  it('rejects cross-origin series and pagination links', () => {
    document.body.innerHTML = `
      <article data-ranking-row>
        <a data-ranking-title href="https://evil.test/series/not-trusted/">Untrusted</a>
      </article>
      <nav data-ranking-pagination><a href="https://evil.test/?pg=2">2</a></nav>
    `;
    const result = parseRankingPage(document, rankingUrl);
    expect(result.ok).toBe(false);
    expect(result.page.rows).toEqual([]);
    expect(result.page.pageLinks).toEqual([]);
  });
});
