import { describe, expect, it } from 'vitest';

import { classifyNovelUpdatesPage } from '../../src/adapters/page-classifier';

describe('recommendation-list route family', () => {
  it.each([
    '/recommendation-lists/',
    '/list-tags/',
    '/viewlist/61373/',
    '/listtag/character-growth/',
  ])('activates the bespoke replacement for %s', (path) => {
    expect(classifyNovelUpdatesPage(`https://www.novelupdates.com${path}`)).toMatchObject({
      kind: 'supported',
      identity: {
        pageType: 'recommendation-lists',
        resolutionSource: 'exact-route',
      },
    });
  });
});
