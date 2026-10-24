import { describe, expect, it } from 'vitest';
import { buildComparison } from './peerComparison';
import type { NovelDetail, NovelInsights } from './types';

const peer = (id: number, rating: number, readers: number, shared = 10) =>
  ({ id, title: `Peer ${id}`, rating, reading_list_count: readers, shared_tag_count: shared, shared_genre_count: 2, language: 'Korean', author: 'A', year: 2020 }) as NovelInsights['peers'][number];
const insights = (peers: NovelInsights['peers'], cohorts: NovelInsights['cohorts'] = [
  { dimension: 'primary_genre', value: 'Action', population: 100, readership_rank: 5 },
  { dimension: 'language', value: 'Korean', population: 80, readership_rank: 4 },
]): NovelInsights => ({
  novel_id: 1, catalog_size: 1000, metrics: [], cohorts, peers, cohort_definition: 'raw definition', capabilities: { relationships: false, tags: true },
});
const me = { id: 1, title: 'Me', rating: 4.1, reading_list_count: 5000, language: 'Korean', author: 'Me', year: 2021 } as NovelDetail;

describe('buildComparison', () => {
  const peers = [peer(10, 4.7, 18000), peer(11, 3.6, 360), peer(12, 4.3, 2100), peer(13, 4.1, 8700)];

  it('puts this title into the ranked set and says where it stands', () => {
    const c = buildComparison(insights(peers), me, 1)!;
    expect(c.rows.map((r) => r.id)).toEqual([10, 12, 13, 1, 11]); // 4.1 tie: more readers first
    expect(c.rows.find((r) => r.self)!.rank).toBe(4);
    expect(c.peerCount).toBe(4);
    expect(c.summary).toBe('Among these 5, it is #4 for rating and #3 for reading-list count.');
    expect(c.selfRating).toBe(4.1);
    expect(c.maxReaders).toBe(18000);
  });

  it('describes the set in plain words, naming the genre, language and format', () => {
    const c = buildComparison(insights(peers), me, 1)!;
    expect(c.noun).toBe('novels');
    expect(c.definition).toContain('genre Action');
    expect(c.definition).toContain('language Korean');
    expect(c.definition).not.toMatch(/alphabetical/i);
    const anime = buildComparison(insights(peers), { ...me, id: 3_000_005, media_type: 'anime' } as NovelDetail, 3_000_005)!;
    expect(anime.noun).toBe('anime');
  });

  it('falls back to the raw definition when the cohorts are missing, and omits the summary without the title', () => {
    const c = buildComparison(insights(peers, []), undefined, 1)!;
    expect(c.definition).toBe('raw definition');
    expect(c.summary).toBe('');
    expect(c.rows.some((r) => r.self)).toBe(false);
    expect(c.selfRating).toBeNull();
  });

  it('is null with no peers, and caps the set at ten peers', () => {
    expect(buildComparison(insights([]), me, 1)).toBeNull();
    const many = Array.from({ length: 14 }, (_, i) => peer(100 + i, 3 + i / 10, 100 + i));
    const c = buildComparison(insights(many), me, 1)!;
    expect(c.peerCount).toBe(10);
    expect(c.rows).toHaveLength(11);
  });
});
