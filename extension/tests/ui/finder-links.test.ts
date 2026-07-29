import { describe, expect, it } from 'vitest';

import { extensionFinderNovelUrl } from '../../src/ui/finder-links';
import type { BrowseNovel } from '../../../web/src/types';

const fixtureNovel = {
  id: 101,
  title: 'Fixture',
  slug: 'fixture',
  author: 'Author',
  rating: 4,
  rating_votes: 10,
  reading_list_count: 20,
  novelupdates_url: 'https://www.novelupdates.com/?p=101',
} satisfies BrowseNovel;

describe('extensionFinderNovelUrl', () => {
  it('prefers a canonical HTTPS Novel Updates series route', () => {
    expect(
      extensionFinderNovelUrl({
        ...fixtureNovel,
        external_url: 'https://www.novelupdates.com/series/fixture/',
      }),
    ).toBe('https://www.novelupdates.com/series/fixture/');
  });

  it.each([
    'https://evil.test/series/fixture/',
    'http://www.novelupdates.com/series/fixture/',
    'javascript:alert(1)',
  ])('rejects an unsafe external URL and uses the known NU URL for %s', (externalUrl) => {
    expect(extensionFinderNovelUrl({ ...fixtureNovel, external_url: externalUrl })).toBe(
      'https://www.novelupdates.com/?p=101',
    );
  });

  it('falls back to the numeric NU route when snapshot links are invalid', () => {
    expect(
      extensionFinderNovelUrl({
        ...fixtureNovel,
        external_url: 'https://evil.test/',
        novelupdates_url: 'invalid',
      }),
    ).toBe('https://www.novelupdates.com/?p=101');
  });

  it.each([
    'https://www.novelupdates.com/series/',
    'https://www.novelupdates.com/series/fixture/extra/',
    'https://www.novelupdates.com/account/?p=101',
    'https://www.novelupdates.com/?p=not-a-number',
  ])('rejects Novel Updates URLs outside supported result routes: %s', (url) => {
    expect(
      extensionFinderNovelUrl({
        ...fixtureNovel,
        external_url: url,
        novelupdates_url: 'invalid',
      }),
    ).toBe('https://www.novelupdates.com/?p=101');
  });
});
