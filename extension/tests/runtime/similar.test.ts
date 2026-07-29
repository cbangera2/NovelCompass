import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import type { Recommendation } from '../../../web/src/types';
import { loadSeriesSimilarNovels, mapRecommendationToSimilar } from '../../src/runtime/similar';

const fixtureRoot = path.resolve('../tests/fixtures/extension-static-data');

const fixtureFetch: typeof fetch = async (input) => {
  const pathname = new URL(String(input)).pathname.replace(/^\/data\//, '');
  try {
    const body = await readFile(path.join(fixtureRoot, pathname), 'utf8');
    return new Response(body, {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  } catch {
    return new Response('{}', { status: 404 });
  }
};

describe('loadSeriesSimilarNovels', () => {
  it('resolves a live NU slug and maps static recommendations for the series UI', async () => {
    const result = await loadSeriesSimilarNovels(
      'https://extension.invalid/data/',
      {
        pageType: 'series',
        url: 'https://www.novelupdates.com/series/i-became-a-regressed-mercenary/',
        slug: 'i-became-a-regressed-mercenary',
        parserVersion: 1,
        confidence: 'high',
        resolutionSource: 'current-url',
      },
      { title: 'I Became a Regressed Mercenary' },
      fixtureFetch,
    );

    expect(result.status).toBe('ready');
    if (result.status === 'ready') {
      expect(result.data[0]).toMatchObject({
        id: '102',
        title: 'The Clockwork Sword',
        url: 'https://www.novelupdates.com/series/the-clockwork-sword/',
        reason: 'Shared mercenary themes',
      });
      expect(result.data[0]!.score).toBeGreaterThan(0);
      expect(
        result.data.every((item) => item.url.startsWith('https://www.novelupdates.com/')),
      ).toBe(true);
    }
  });

  it('returns an explicit unavailable state for an unresolved live title', async () => {
    const result = await loadSeriesSimilarNovels(
      'https://extension.invalid/data/',
      {
        pageType: 'series',
        url: 'https://www.novelupdates.com/series/missing/',
        slug: 'missing',
        parserVersion: 1,
        confidence: 'high',
        resolutionSource: 'current-url',
      },
      { title: 'Missing Fixture' },
      fixtureFetch,
    );
    expect(result).toMatchObject({
      status: 'unavailable',
      message: expect.stringContaining('not in the packaged'),
    });
  });
});

describe('mapRecommendationToSimilar', () => {
  const recommendation = {
    target_id: 102,
    title: 'Safe Fixture',
    author: 'Fixture Author',
    slug: 'safe-fixture',
    novelupdates_url: 'https://www.novelupdates.com/series/safe-fixture/',
    language: 'Korean',
    rating: 4.5,
    rating_votes: 10,
    reading_list_count: 100,
    status_trans: 'Ongoing',
    chapters_trans: 20,
    rrf_score: 0.01,
    match_score_percent: 120,
    channel_ranks: {},
    shared_tags: ['Action'],
    evidence_bullets: ['<b>Shared</b> evidence'],
  } satisfies Recommendation;

  it('clamps scores and emits only plain UI strings', () => {
    expect(mapRecommendationToSimilar(recommendation)).toEqual([
      {
        id: '102',
        title: 'Safe Fixture',
        url: 'https://www.novelupdates.com/series/safe-fixture/',
        score: 1,
        reason: 'Shared evidence',
        genres: ['Action'],
      },
    ]);
  });

  it('drops cross-origin and AniList destinations', () => {
    expect(
      mapRecommendationToSimilar({
        ...recommendation,
        novelupdates_url: 'https://evil.test/series/safe-fixture/',
      }),
    ).toEqual([]);
    expect(
      mapRecommendationToSimilar({
        ...recommendation,
        target_id: 2_000_102,
        source: 'anilist',
      }),
    ).toEqual([]);
  });
});
