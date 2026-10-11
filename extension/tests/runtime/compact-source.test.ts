import { describe, expect, it } from 'vitest';

import { createExtensionStaticDataSource } from '../../../web/src/data';

describe('compact extension finder source', () => {
  it('browses a title prefix shard without requesting the legacy catalog', async () => {
    const fields = [
      'id',
      'slug',
      'title',
      'author',
      'rating',
      'rating_votes',
      'reading_list_count',
      'language',
      'status_trans',
      'chapters_trans',
      'genre_ids',
      'source',
      'external_url',
      'aliases',
    ];
    const requests: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      const path = new URL(String(input)).pathname.split('/data/').pop() || '';
      requests.push(path);
      const values: Record<string, unknown> = {
        'manifest.json': {
          schema_version: 1,
          algorithm_version: 1,
          dataset_version: 'compact-fixture',
          source_novel_count: 1,
          extension_search_index_url: 'search/index.json',
          extension_identity_url: 'identity/{bucket}.json',
          extension_facet_options_url: 'facets/options.json',
          extension_facet_novels_url: 'facets/novels/{bucket}.json',
          recommendation_index_url: 'recommendations/{bucket}.json',
        },
        'options.json': { genres: ['Action'], tags: ['Mercenaries'], languages: ['Korean'] },
        'search/re.json': {
          fields,
          rows: [
            [
              101,
              'regressed-mercenary',
              'Regressed Mercenary',
              'Fixture Author',
              4.5,
              100,
              2000,
              'Korean',
              'Ongoing',
              50,
              [0],
              'novelupdates',
              'https://www.novelupdates.com/series/regressed-mercenary/',
              ['The Regressed Soldier'],
            ],
          ],
        },
        'facets/novels/65.json': { '101': { g: [0], t: [0] } },
      };
      const value = values[path];
      return value
        ? new Response(JSON.stringify(value), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
        : new Response('{}', { status: 404 });
    };
    const source = await createExtensionStaticDataSource({
      baseUrl: 'https://extension.invalid/data/',
      fetch: fetcher,
    });
    await source.getOptions();
    const result = await source.browseNovels({
      query: 'regressed',
      tag: 'Mercenaries',
      media_type: 'novel',
      page: 1,
      page_size: 24,
    });

    expect(result.items).toMatchObject([
      {
        id: 101,
        title: 'Regressed Mercenary',
        genres: ['Action'],
      },
    ]);
    expect(result.capabilities).toMatchObject({ genres: true, tags: true });
    expect(requests).toContain('search/re.json');
    expect(requests).toContain('facets/novels/65.json');
    expect(requests).not.toContain('catalog.json');
    expect(requests).not.toContain('bootstrap-catalog.json');
  });
});
