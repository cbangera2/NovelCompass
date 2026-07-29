// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';

import fixtureHtml from '../fixtures/series-logged-out.html?raw';
import type { NovelUpdatesPageIdentity } from '../../src/adapters/contracts';
import {
  parseLiveSeriesMetadata,
  parseLiveSeriesPageMetadata,
} from '../../src/adapters/series-page';

const seriesUrl = 'https://www.novelupdates.com/series/fixture-mercenary/';

function fixtureDocument(html = fixtureHtml): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

function identity(): NovelUpdatesPageIdentity {
  return {
    pageType: 'series',
    url: seriesUrl,
    canonicalUrl: seriesUrl,
    slug: 'fixture-mercenary',
    novelUpdatesId: 4242,
    parserVersion: 1,
    confidence: 'high',
    resolutionSource: 'canonical-url',
  };
}

describe('parseLiveSeriesPageMetadata', () => {
  it('normalizes the complete logged-out metadata fixture', () => {
    const result = parseLiveSeriesPageMetadata(fixtureDocument(), seriesUrl);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({
      identity: {
        slug: 'fixture-mercenary',
        novelUpdatesId: 4242,
      },
      title: 'Fixture Mercenary',
      coverUrl: 'https://cdn.novelupdates.com/images/fixture-cover.jpg',
      description: 'A veteran mercenary wakes up in his younger body. He chooses a different path.',
      associatedNames: ['Fixture Regressor', '회귀한 용병'],
      authors: [
        {
          label: 'Fixture Author',
          url: 'https://www.novelupdates.com/nauthor/fixture-author/',
        },
      ],
      artists: [{ label: 'Fixture Artist' }],
      genres: [{ label: 'Action' }, { label: 'Fantasy' }],
      tags: [{ label: 'Mercenaries' }, { label: 'Regression' }],
      language: { label: 'Korean' },
      novelType: { label: 'Web Novel' },
      year: 2024,
      originalStatus: '312 Chapters (Complete)',
      translationStatus: 'No',
      licensed: true,
      completelyTranslated: false,
      publishers: {
        original: [{ label: 'Fixture Original' }],
        english: [{ label: 'Fixture English' }],
      },
      releaseFrequency: 'Every 3 Day(s)',
      rating: {
        average: 4.3,
        voteCount: 120,
        distribution: [
          { stars: 5, count: 84, percentage: 70 },
          { stars: 4, count: 24, percentage: 20 },
        ],
      },
      rankings: {
        activity: { weekly: 12, monthly: 34, allTime: 56 },
        readingList: { monthly: 78, allTime: 90 },
        readingListCount: 1234,
      },
      recommendationLists: [{ label: 'Fixture Favorites' }],
      warnings: [],
    });
  });

  it('keeps optional omissions non-fatal and reports field warnings', () => {
    const document = fixtureDocument(
      '<!doctype html><h1 class="seriestitlenu">Sparse Fixture</h1>',
    );
    const result = parseLiveSeriesMetadata(document, identity());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({
      title: 'Sparse Fixture',
      associatedNames: [],
      authors: [],
      artists: [],
      genres: [],
      tags: [],
      publishers: { original: [], english: [] },
      recommendationLists: [],
    });
    expect(result.value.warnings.map((warning) => warning.field)).toEqual(
      expect.arrayContaining([
        'coverUrl',
        'description',
        'authors',
        'genres',
        'language',
        'novelType',
        'year',
        'originalStatus',
        'rating',
      ]),
    );
  });

  it('fails when identity or title is absent', () => {
    expect(parseLiveSeriesMetadata(fixtureDocument(), undefined)).toMatchObject({
      ok: false,
      reason: 'missing-identity',
    });
    expect(
      parseLiveSeriesMetadata(fixtureDocument('<!doctype html><main />'), identity()),
    ).toMatchObject({
      ok: false,
      reason: 'missing-title',
    });
  });

  it('rejects executable and cross-origin linked metadata URLs', () => {
    const document = fixtureDocument(`
      <!doctype html>
      <h1 class="seriestitlenu">Unsafe Links</h1>
      <div id="showauthors">
        <a href="javascript:alert(1)">Script Author</a>
        <a href="https://evil.test/author">Foreign Author</a>
      </div>
      <div class="seriesimg"><img src="data:image/png;base64,AAAA"></div>
    `);
    const result = parseLiveSeriesMetadata(document, identity());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.authors).toEqual([{ label: 'Script Author' }, { label: 'Foreign Author' }]);
    expect(result.value.coverUrl).toBeUndefined();
    expect(result.value.warnings.filter((warning) => warning.code === 'invalid-url')).toHaveLength(
      3,
    );
  });
});
