import { describe, expect, it } from 'vitest';

import {
  classifyNovelUpdatesPage,
  type NovelUpdatesPageSignals,
} from '../../src/adapters/page-classifier';

const seriesUrl = 'https://www.novelupdates.com/series/i-became-a-regressed-mercenary/';

describe('classifyNovelUpdatesPage', () => {
  it('classifies a supported series route and resolves canonical identity', () => {
    const result = classifyNovelUpdatesPage(seriesUrl, {
      canonicalUrl: seriesUrl,
      shortlinkUrl: 'https://www.novelupdates.com/?p=12345',
    });

    expect(result).toEqual({
      kind: 'supported',
      identity: {
        pageType: 'series',
        url: seriesUrl,
        canonicalUrl: seriesUrl,
        slug: 'i-became-a-regressed-mercenary',
        novelUpdatesId: 12345,
        parserVersion: 1,
        confidence: 'high',
        resolutionSource: 'canonical-url',
      },
    });
  });

  it('classifies only the exact Series Finder route', () => {
    const finder = classifyNovelUpdatesPage('https://www.novelupdates.com/series-finder/');
    expect(finder.kind).toBe('supported');
    if (finder.kind === 'supported') {
      expect(finder.identity).toMatchObject({
        pageType: 'series-finder',
        confidence: 'high',
        resolutionSource: 'exact-route',
      });
    }

    expect(
      classifyNovelUpdatesPage('https://www.novelupdates.com/series-finder/results/'),
    ).toMatchObject({ kind: 'blocked', reason: 'unsupported-route' });
  });

  it.each([
    ['http://www.novelupdates.com/series/example/', 'insecure-origin'],
    ['https://novelupdates.com/series/example/', 'wrong-origin'],
    ['https://www.novelupdates.com.evil.test/series/example/', 'wrong-origin'],
    ['https://www.novelupdates.com/', 'unsupported-route'],
    ['not a URL', 'invalid-url'],
  ])('blocks %s as %s', (url, reason) => {
    expect(classifyNovelUpdatesPage(url)).toMatchObject({
      kind: 'blocked',
      reason,
    });
  });

  it.each([
    [{ title: 'Just a moment...' }, 'challenge-page'],
    [{ hasCloudflareChallenge: true }, 'challenge-page'],
    [{ hasLoginForm: true }, 'login-page'],
    [{ bodyText: 'Briefly unavailable for scheduled maintenance.' }, 'maintenance-page'],
  ] satisfies Array<[NovelUpdatesPageSignals, string]>)(
    'keeps blocked document state in the original view',
    (signals, reason) => {
      expect(classifyNovelUpdatesPage(seriesUrl, signals)).toMatchObject({
        kind: 'blocked',
        reason,
      });
    },
  );

  it('does not trust a cross-origin canonical or shortlink', () => {
    const result = classifyNovelUpdatesPage(seriesUrl, {
      canonicalUrl: 'https://evil.test/series/wrong-work/',
      shortlinkUrl: 'https://evil.test/?p=999',
    });

    expect(result.kind).toBe('supported');
    if (result.kind === 'supported') {
      expect(result.identity).toMatchObject({
        slug: 'i-became-a-regressed-mercenary',
        confidence: 'high',
        resolutionSource: 'current-url',
      });
      expect(result.identity).not.toHaveProperty('novelUpdatesId');
    }
  });

  it('fails closed when a loaded series document lacks required markup', () => {
    expect(classifyNovelUpdatesPage(seriesUrl, { hasSeriesTitle: false })).toMatchObject({
      kind: 'blocked',
      reason: 'unsupported-markup',
    });
  });

  it('marks a canonical/current slug mismatch as medium confidence', () => {
    const result = classifyNovelUpdatesPage(seriesUrl, {
      canonicalUrl: 'https://www.novelupdates.com/series/renamed-regressed-mercenary/',
    });

    expect(result.kind).toBe('supported');
    if (result.kind === 'supported') {
      expect(result.identity).toMatchObject({
        slug: 'renamed-regressed-mercenary',
        confidence: 'medium',
        resolutionSource: 'canonical-url',
      });
    }
  });
});
