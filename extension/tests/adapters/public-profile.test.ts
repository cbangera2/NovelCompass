// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';

import { parsePublicProfilePage } from '../../src/adapters/public-profile';
import fixture from '../fixtures/public-profile.html?raw';
import { parseFixtureHtml } from '../helpers/fixture';

describe('parsePublicProfilePage', () => {
  it('extracts inert profile identity, stats, navigation, and created lists', () => {
    const result = parsePublicProfilePage(
      parseFixtureHtml(fixture),
      'https://www.novelupdates.com/user/42/fixture-curator/',
    );
    expect(result.ok).toBe(true);
    expect(result.page).toMatchObject({
      name: 'Fixture Curator',
      rank: 'Reader',
      joinedAt: 'January 2, 2020',
      bio: 'Enjoys thoughtful fantasy and complicated protagonists.',
      stats: [{ label: 'Lists', value: '2' }, { label: 'Comments', value: '17' }],
    });
    expect(result.page.lists).toHaveLength(2);
    expect(result.page.lists[0]).toMatchObject({
      title: 'Fantasy with sharp edges',
      seriesCount: 12,
      commentCount: 4,
      viewCount: 800,
      followCount: 21,
      tags: [{ label: 'Antihero', url: 'https://www.novelupdates.com/listtag/antihero/' }],
    });
    expect(result.page.navigation).toEqual([
      { label: 'Profile', url: 'https://www.novelupdates.com/user/42/fixture-curator/' },
    ]);
    expect(result.page.toolLinks).toHaveLength(2);
  });

  it('rejects an off-origin profile URL', () => {
    const result = parsePublicProfilePage(
      parseFixtureHtml(fixture),
      'https://evil.test/user/42/fixture-curator/',
    );
    expect(result.ok).toBe(false);
    expect(result.message).toContain('trusted');
  });
});
