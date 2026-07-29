import { describe, expect, it } from 'vitest';

import { classifyNovelUpdatesPage } from '../../src/adapters/page-classifier';

describe('reading-list route family', () => {
  it('activates the bespoke replacement', () => {
    expect(
      classifyNovelUpdatesPage('https://www.novelupdates.com/reading-list/'),
    ).toMatchObject({
      kind: 'supported',
      identity: {
        pageType: 'reading-library',
        resolutionSource: 'exact-route',
      },
    });
  });
});
