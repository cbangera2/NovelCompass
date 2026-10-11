// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';

import { parseRecommendationListsPage } from '../../src/adapters/recommendation-lists';
import detailFixture from '../fixtures/recommendation-list-detail.html?raw';
import tagsFixture from '../fixtures/recommendation-list-tags.html?raw';
import directoryFixture from '../fixtures/recommendation-lists.html?raw';

describe('recommendation lists adapter', () => {
  it('normalizes directory cards, tags, metrics, and trusted pagination', () => {
    const fixtureDocument = new DOMParser().parseFromString(directoryFixture, 'text/html');
    const result = parseRecommendationListsPage(
      fixtureDocument,
      'https://www.novelupdates.com/recommendation-lists/?pg=2',
    );
    expect(result.ok).toBe(true);
    expect(result.page).toMatchObject({
      kind: 'directory',
      title: 'Recommendation Lists',
      currentPage: 2,
      previousUrl: 'https://www.novelupdates.com/recommendation-lists/?pg=1',
      nextUrl: 'https://www.novelupdates.com/recommendation-lists/?pg=3',
    });
    expect(result.page.lists[0]).toMatchObject({
      title: 'Completed Mind Reading Novels',
      seriesCount: 12,
      commentCount: 3,
      viewCount: 1250,
      followCount: 8,
      creator: {
        label: 'Fixture Curator',
        url: 'https://www.novelupdates.com/user/42/fixture-curator/',
      },
      description: 'Thoughtful novels with excellent character arcs',
    });
    expect(result.page.lists[0]?.tags[0]).toEqual({
      label: 'Character Growth',
      url: 'https://www.novelupdates.com/listtag/character-growth/',
    });
    expect(result.page.pageLinks.map(({ page }) => page)).toEqual([1, 2, 3]);
  });

  it('normalizes a list detail without retaining untrusted series links', () => {
    const fixtureDocument = new DOMParser().parseFromString(detailFixture, 'text/html');
    const result = parseRecommendationListsPage(
      fixtureDocument,
      'https://www.novelupdates.com/viewlist/61373/',
    );
    expect(result.ok).toBe(true);
    expect(result.page.kind).toBe('detail');
    expect(result.page.creator?.label).toBe('Fixture Curator');
    expect(result.page.series).toHaveLength(1);
    expect(result.page.series[0]).toMatchObject({
      title: 'Synthetic Moon',
      url: 'https://www.novelupdates.com/series/synthetic-moon/',
      rating: 4.6,
      note: 'The strongest opening on the list.',
    });
    expect(result.page.series[0]?.tags.map(({ label }) => label)).toEqual([
      'Comedy',
      'Character Growth',
    ]);
  });

  it('normalizes the public list-tag directory and fails closed on empty markup', () => {
    const fixtureDocument = new DOMParser().parseFromString(tagsFixture, 'text/html');
    const result = parseRecommendationListsPage(
      fixtureDocument,
      'https://www.novelupdates.com/list-tags/',
    );
    expect(result.ok).toBe(true);
    expect(result.page.tags).toEqual([
      { label: 'Action', url: 'https://www.novelupdates.com/listtag/action/' },
      { label: 'Hidden Gems', url: 'https://www.novelupdates.com/listtag/hidden-gems/' },
    ]);

    const emptyDocument = new DOMParser().parseFromString('<!doctype html><body></body>', 'text/html');
    expect(
      parseRecommendationListsPage(
        emptyDocument,
        'https://www.novelupdates.com/recommendation-lists/',
      ),
    ).toMatchObject({ ok: false, message: 'Novel Updates recommendation-list markup is not supported.' });
  });
});
