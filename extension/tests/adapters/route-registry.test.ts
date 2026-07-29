import { describe, expect, it } from 'vitest';

import { matchNovelUpdatesRoute } from '../../src/adapters/route-registry';

describe('matchNovelUpdatesRoute', () => {
  it.each([
    ['/series/example/', 'series', 'bespoke-replacement', true],
    ['/series-finder/', 'series-finder', 'bespoke-replacement', true],
    ['/series-ranking/', 'series-ranking', 'bespoke-replacement', false],
    ['/', 'home', 'bespoke-replacement', false],
    ['/page/3/', 'catalog-feed', 'bespoke-replacement', false],
    ['/genre/action/', 'catalog-taxonomy', 'bespoke-replacement', false],
    ['/viewlist/123/', 'recommendation-lists', 'bespoke-replacement', false],
    ['/user/42/reader/', 'public-profile', 'bespoke-replacement', false],
    ['/reading-list/', 'reading-library', 'bespoke-replacement', false],
    ['/account/', 'account-form', 'shared-shell-native', false],
    ['/userlist/123/', 'account-form', 'shared-shell-native', false],
    ['/add-release/', 'contributor-form', 'shared-shell-native', false],
    ['/privacy-policy/', 'content-page', 'shared-shell-native', false],
    ['/random-novel/', 'redirect', 'pass-through', false],
    ['/extnu/123/', 'redirect', 'pass-through', false],
    ['/logout/', 'security-action', 'pass-through', false],
    ['/report/review/42/', 'security-action', 'pass-through', false],
    ['/wp-admin/profile.php', 'wordpress-internal', 'pass-through', false],
    ['/wp-json/wp/v2/posts', 'machine-readable', 'pass-through', false],
    ['/comments/feed/', 'machine-readable', 'pass-through', false],
  ] as const)(
    'maps %s to %s',
    (pathname, family, policy, uiImplemented) => {
      expect(matchNovelUpdatesRoute(pathname)).toMatchObject({
        family,
        policy,
        uiImplemented,
      });
    },
  );

  it.each([
    '/series/',
    '/series/example/extra/',
    '/series-finder/results/',
    '/genre/',
    '/viewlist/not-a-number/',
    '/userlist/not-a-number/',
    '/unknown-plugin-action/',
  ])('does not overmatch %s', (pathname) => {
    expect(matchNovelUpdatesRoute(pathname)).toBeUndefined();
  });

  it('passes numeric WordPress post redirects through without treating normal searches as redirects', () => {
    expect(matchNovelUpdatesRoute('/', '?p=123')).toMatchObject({
      family: 'redirect',
      policy: 'pass-through',
    });
    expect(matchNovelUpdatesRoute('/', '?s=mercenary')).toMatchObject({
      family: 'home',
      policy: 'bespoke-replacement',
    });
  });
});
