import { describe, expect, it } from 'vitest';

import { classifyNovelUpdatesPage } from '../../src/adapters/page-classifier';

describe('public profile route', () => {
  it('classifies public user routes as purpose-built replacements', () => {
    expect(
      classifyNovelUpdatesPage('https://www.novelupdates.com/user/546333/cbboss/'),
    ).toMatchObject({
      kind: 'supported',
      identity: { pageType: 'public-profile', resolutionSource: 'exact-route' },
    });
  });
});
