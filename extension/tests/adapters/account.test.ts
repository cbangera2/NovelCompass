// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest';

import loggedInFixture from '../fixtures/shell-logged-in.html?raw';
import loggedOutFixture from '../fixtures/shell-logged-out.html?raw';
import unknownFixture from '../fixtures/shell-unknown.html?raw';
import { OpaqueActionRegistry } from '../../src/adapters/action-registry';
import { parseNovelUpdatesAccountState } from '../../src/adapters/account';

const PAGE_URL = 'https://www.novelupdates.com/series/fixture-title/';

function fixtureDocument(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

describe('parseNovelUpdatesAccountState', () => {
  it('normalizes logged-in identity and safe destinations without exposing logout URLs', () => {
    const document = fixtureDocument(loggedInFixture);
    const registry = new OpaqueActionRegistry();
    const result = parseNovelUpdatesAccountState(document, PAGE_URL, registry);

    expect(result.account).toMatchObject({
      status: 'logged-in',
      username: 'Fixture Reader',
      avatarUrl: 'https://www.novelupdatesforum.com/data/avatars/fixture.png',
      profileUrl: 'https://www.novelupdates.com/user/42/fixture-reader/',
      accountUrl: 'https://www.novelupdates.com/account/',
      followingUrl: 'https://www.novelupdates.com/following/',
      alertsUrl: 'https://www.novelupdates.com/latest-alerts/',
      alertCount: 3,
      messagesUrl: 'https://www.novelupdatesforum.com/conversations/',
    });
    expect(JSON.stringify(result.account)).not.toContain('_wpnonce');
    expect(result.account.status === 'logged-in' && result.account.logoutActionId).toBeTruthy();
  });

  it('delegates logout through the source element and invalidates stale generations', () => {
    const document = fixtureDocument(loggedInFixture);
    const logout = document.querySelector<HTMLAnchorElement>('[data-fixture-logout]')!;
    Object.defineProperty(logout, 'isConnected', { value: true });
    const click = vi.spyOn(logout, 'click');
    const registry = new OpaqueActionRegistry();
    const first = parseNovelUpdatesAccountState(document, PAGE_URL, registry);
    const actionId =
      first.account.status === 'logged-in' ? first.account.logoutActionId! : '';

    expect(registry.invoke(actionId)).toEqual({ kind: 'delegated' });
    expect(click).toHaveBeenCalledOnce();

    parseNovelUpdatesAccountState(document, PAGE_URL, registry);
    expect(registry.invoke(actionId)).toEqual({ kind: 'unavailable' });
  });

  it('normalizes logged-out links and preserves ambiguous markup as unknown', () => {
    const registry = new OpaqueActionRegistry();
    expect(
      parseNovelUpdatesAccountState(fixtureDocument(loggedOutFixture), PAGE_URL, registry).account,
    ).toEqual({
      status: 'logged-out',
      loginUrl: 'https://www.novelupdates.com/login/',
      registerUrl: 'https://www.novelupdates.com/register/',
    });

    expect(
      parseNovelUpdatesAccountState(fixtureDocument(unknownFixture), PAGE_URL, registry).account,
    ).toMatchObject({
      status: 'unknown',
      warnings: [{ code: 'unsupported-markup', field: 'account' }],
    });
  });

  it('rejects untrusted destinations and untrusted page origins', () => {
    const document = fixtureDocument(loggedInFixture);
    document
      .querySelector<HTMLAnchorElement>('a[href="/account/"]')!
      .setAttribute('href', 'https://evil.test/account/');
    document
      .querySelector<HTMLImageElement>('#logged_avatar img')!
      .setAttribute('src', 'https://evil.test/avatar.png');

    const registry = new OpaqueActionRegistry();
    const account = parseNovelUpdatesAccountState(document, PAGE_URL, registry).account;
    expect(account).toMatchObject({
      status: 'logged-in',
      username: 'Fixture Reader',
    });
    expect(account).not.toHaveProperty('accountUrl');
    expect(account).not.toHaveProperty('avatarUrl');
    expect(
      parseNovelUpdatesAccountState(document, 'http://www.novelupdates.com/', registry).account,
    ).toMatchObject({ status: 'unknown' });
  });
});
