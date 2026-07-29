// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';

import { OpaqueActionRegistry } from '../../src/adapters/action-registry';
import { parseHomePage } from '../../src/adapters/home';

describe('parseHomePage', () => {
  it('normalizes releases, latest series, and pagination from the live table shape', () => {
    document.body.innerHTML = `
      <main class="l-content release">
        <strong>Wednesday, July 29, 2026</strong>
        <table id="myTable">
          <tbody>
            <tr>
              <td><a href="/series/fixture-series/">Fixture Series</a></td>
              <td><button class="chp-release">c12</button></td>
              <td><a href="/group/fixture-group/">Fixture Group</a></td>
            </tr>
          </tbody>
        </table>
        <a href="/?pg=2">2</a><a href="/?pg=2">→</a>
      </main>
      <aside class="l-sidebar">
        <h3>Latest Series</h3>
        <ul><li><a href="/series/new-fixture/">New Fixture</a></li></ul>
      </aside>
    `;
    const registry = new OpaqueActionRegistry();
    const result = parseHomePage(document, 'https://www.novelupdates.com/', registry);

    expect(result.ok).toBe(true);
    expect(result.page).toMatchObject({
      dateLabel: 'Wednesday, July 29, 2026',
      currentPage: 1,
      rows: [
        {
          title: 'Fixture Series',
          seriesUrl: 'https://www.novelupdates.com/series/fixture-series/',
          chapterLabel: 'c12',
          group: {
            label: 'Fixture Group',
            url: 'https://www.novelupdates.com/group/fixture-group/',
          },
        },
      ],
      latestSeries: [
        {
          label: 'New Fixture',
          url: 'https://www.novelupdates.com/series/new-fixture/',
        },
      ],
      nextUrl: 'https://www.novelupdates.com/?pg=2',
    });
    expect(result.page.rows[0]?.chapterActionId).toMatch(/^home-releases:/);
  });

  it('fails closed when the release table is missing', () => {
    document.body.replaceChildren();
    const result = parseHomePage(
      document,
      'https://www.novelupdates.com/',
      new OpaqueActionRegistry(),
    );
    expect(result.ok).toBe(false);
    expect(result.page.warnings[0]?.code).toBe('unsupported-markup');
  });
});
