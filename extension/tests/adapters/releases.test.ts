// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest';

import paginationFixture from '../fixtures/releases-pagination.html?raw';
import noReleasesFixture from '../fixtures/series-no-releases.html?raw';
import { OpaqueActionRegistry } from '../../src/adapters/action-registry';
import { parseReleasePage } from '../../src/adapters/releases';

function fixtureDocument(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

describe('parseReleasePage', () => {
  it('normalizes releases, pagination, group links, and capabilities', () => {
    const document = fixtureDocument(paginationFixture);
    const registry = new OpaqueActionRegistry();
    const result = parseReleasePage(
      document,
      'https://www.novelupdates.com/series/fixture-paginated-releases/',
      registry,
    );

    expect(result.page).toMatchObject({
      currentPage: 1,
      nextUrl: 'https://www.novelupdates.com/series/fixture-paginated-releases/?pg=2#myTable',
      groupFilterAvailable: true,
      pageLinks: [
        {
          page: 1,
          url: 'https://www.novelupdates.com/series/fixture-paginated-releases/?pg=1#myTable',
        },
        {
          page: 2,
          url: 'https://www.novelupdates.com/series/fixture-paginated-releases/?pg=2#myTable',
        },
      ],
    });
    expect(result.page.rows).toHaveLength(2);
    expect(result.page.rows[0]).toMatchObject({
      dateLabel: '01/03/26',
      dateIso: '2026-01-03',
      group: {
        label: 'Fixture Group A',
        url: 'https://www.novelupdates.com/group/fixture-group-a/',
      },
      chapterLabel: 'v1c2',
      volumeLabel: 'v1',
      isActionAvailable: true,
    });
    expect(registry.invoke(result.page.rows[0]!.actionId)).toEqual({
      kind: 'navigate',
      url: 'https://www.novelupdates.com/extnu/102/',
    });
  });

  it('delegates non-link chapter controls and invalidates them on reparse', () => {
    const document = fixtureDocument(paginationFixture);
    const delegated = document.querySelector<HTMLElement>('[data-release-action]')!;
    Object.defineProperty(delegated, 'isConnected', { value: true });
    const click = vi.spyOn(delegated, 'click');
    const registry = new OpaqueActionRegistry();
    const first = parseReleasePage(
      document,
      'https://www.novelupdates.com/series/fixture-paginated-releases/',
      registry,
    );
    const delegatedActionId = first.page.rows[1]!.actionId;

    expect(registry.invoke(delegatedActionId)).toEqual({ kind: 'delegated' });
    expect(click).toHaveBeenCalledOnce();

    parseReleasePage(
      document,
      'https://www.novelupdates.com/series/fixture-paginated-releases/?pg=2',
      registry,
    );
    expect(registry.invoke(delegatedActionId)).toEqual({ kind: 'unavailable' });
  });

  it('returns an explicit empty release page and fails closed for untrusted origins', () => {
    const document = fixtureDocument(noReleasesFixture);
    const registry = new OpaqueActionRegistry();

    expect(
      parseReleasePage(
        document,
        'https://www.novelupdates.com/series/fixture-without-releases/',
        registry,
      ).page,
    ).toEqual({
      rows: [],
      currentPage: 1,
      pageLinks: [],
      groupFilterAvailable: false,
    });
    expect(
      parseReleasePage(document, 'http://www.novelupdates.com/series/example/', registry).page,
    ).toEqual({
      rows: [],
      currentPage: 1,
      pageLinks: [],
      groupFilterAvailable: false,
    });
  });

  it('does not expose cross-origin chapter navigation', () => {
    const document = fixtureDocument(paginationFixture);
    document
      .querySelector<HTMLAnchorElement>('a.chp-release')!
      .setAttribute('href', 'https://evil.test/chapter/102/');
    const registry = new OpaqueActionRegistry();

    const release = parseReleasePage(
      document,
      'https://www.novelupdates.com/series/fixture-paginated-releases/',
      registry,
    ).page.rows[0]!;

    expect(release.isActionAvailable).toBe(false);
    expect(release.actionId).toBe('');
  });
});
