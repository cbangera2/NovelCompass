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

  it('keeps Following native so authenticated controls remain live', () => {
    expect(
      classifyNovelUpdatesPage('https://www.novelupdates.com/following/'),
    ).toMatchObject({
      kind: 'blocked',
      reason: 'replacement-not-implemented',
      route: {
        family: 'reading-library',
        policy: 'shared-shell-native',
      },
    });
  });
});
