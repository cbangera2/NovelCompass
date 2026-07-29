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

  it('isolates legacy profile list descriptions from duplicated card metadata', () => {
    document.body.innerHTML = `
      <div class="p_m_username">cbboss</div>
      <div class="lid_box_sub"><div class="b_lid">
        <div class="lid_link"><a href="/viewlist/83544/">Peak Hidden Gems</a></div>
        <div class="search_stats">100 Series 41 Comments 186058 Views 873 Follows</div>
        <div class="uclp_tags"><a class="gennew search listtags" href="/listtag/male-protagonist/">Male Protagonist</a></div>
        <div>Actual synopsis<span class="dots">... </span><span class="morelink">more&gt;&gt;</span>
          <span class="testhide"> with useful detail. Part 2: https://www.novelupdates.com/viewlist/88138/</span>
        </div>
      </div></div>`;
    const result = parsePublicProfilePage(
      document,
      'https://www.novelupdates.com/user/546333/cbboss/',
    );
    expect(result.page.lists[0]?.description).toBe('Actual synopsis with useful detail.');
  });
});
