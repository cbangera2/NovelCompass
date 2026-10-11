import type { NovelUpdatesAccountState, ParseWarning } from './contracts';
import { OpaqueActionRegistry } from './action-registry';

const NOVEL_UPDATES_ORIGIN = 'https://www.novelupdates.com';
const FORUM_ORIGIN = 'https://www.novelupdatesforum.com';

export interface ParsedAccountState {
  account: NovelUpdatesAccountState;
  generation: number;
}

export function parseNovelUpdatesAccountState(
  document: Document,
  pageUrl: string | URL,
  registry: OpaqueActionRegistry,
): ParsedAccountState {
  const actions = registry.beginGeneration('account');
  const baseUrl = trustedPageUrl(pageUrl);
  if (!baseUrl) {
    return unknown(actions.generation, 'The current page is not a trusted Novel Updates page.');
  }

  const accountRoot = document.querySelector<HTMLElement>(
    '.menu_username_right, [data-nu-account]',
  );
  const username = cleanText(
    accountRoot?.querySelector<HTMLElement>(
      '.username_main .username, [data-nu-username]',
    )?.textContent,
  );

  if (accountRoot && username) {
    const avatarUrl = trustedAssetUrl(
      accountRoot.querySelector<HTMLImageElement>('#logged_avatar img, [data-nu-avatar]')?.src,
    );
    const profileUrl = findNovelUpdatesLink(accountRoot, baseUrl, /^\/user\/\d+\/[^/]+\/?$/u);
    const accountUrl = findNovelUpdatesLink(accountRoot, baseUrl, /^\/account\/?$/u);
    const followingUrl = findNovelUpdatesLink(accountRoot, baseUrl, /^\/following\/?$/u);
    const alertsUrl =
      findNovelUpdatesLink(document, baseUrl, /^\/latest-alerts\/?$/u) ??
      findNovelUpdatesLink(document, baseUrl, /^\/account\/?$/u, 'type', 'alert');
    const messagesUrl = findForumMessagesLink(document);
    const alertCount = parseCount(
      document.querySelector<HTMLElement>(
        '.unread_count_alerts, [data-nu-alert-count]',
      )?.textContent,
    );
    const logout = Array.from(
      accountRoot.querySelectorAll<HTMLAnchorElement>('a[href]'),
    ).find((anchor) => trustedLogoutElement(anchor, baseUrl));
    const logoutActionId = logout ? actions.registerElement(logout) : undefined;

    return {
      generation: actions.generation,
      account: {
        status: 'logged-in',
        username,
        ...(avatarUrl ? { avatarUrl } : {}),
        ...(profileUrl ? { profileUrl } : {}),
        ...(accountUrl ? { accountUrl } : {}),
        ...(followingUrl ? { followingUrl } : {}),
        ...(alertsUrl ? { alertsUrl } : {}),
        ...(alertCount !== undefined ? { alertCount } : {}),
        ...(messagesUrl ? { messagesUrl } : {}),
        ...(logoutActionId ? { logoutActionId } : {}),
      },
    };
  }

  const loginUrl = findNovelUpdatesLink(document, baseUrl, /^\/(?:login|wp-login\.php)\/?$/u);
  const registerUrl = findNovelUpdatesLink(document, baseUrl, /^\/register\/?$/u);
  if (loginUrl || registerUrl || document.querySelector('form#loginform, form[name="loginform"]')) {
    return {
      generation: actions.generation,
      account: {
        status: 'logged-out',
        ...(loginUrl ? { loginUrl } : {}),
        ...(registerUrl ? { registerUrl } : {}),
      },
    };
  }

  return unknown(
    actions.generation,
    accountRoot
      ? 'Account markup was present but did not expose a usable username.'
      : 'No recognized Novel Updates account state was present.',
  );
}

function findNovelUpdatesLink(
  root: ParentNode,
  baseUrl: URL,
  pathPattern: RegExp,
  queryKey?: string,
  queryValue?: string,
): string | undefined {
  for (const anchor of root.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    const url = trustedNovelUpdatesUrl(anchor.getAttribute('href'), baseUrl);
    if (
      url &&
      pathPattern.test(url.pathname) &&
      (!queryKey || url.searchParams.get(queryKey) === queryValue)
    ) {
      return url.href;
    }
  }
  return undefined;
}

function findForumMessagesLink(root: ParentNode): string | undefined {
  for (const anchor of root.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    const url = parseUrl(anchor.getAttribute('href'));
    if (
      url?.origin === FORUM_ORIGIN &&
      /^\/conversations\/?$/u.test(url.pathname) &&
      url.protocol === 'https:'
    ) {
      return url.href;
    }
  }
  return undefined;
}

function trustedLogoutElement(anchor: HTMLAnchorElement, baseUrl: URL): boolean {
  const url = trustedNovelUpdatesUrl(anchor.getAttribute('href'), baseUrl);
  return Boolean(url && /^\/logout\/?$/u.test(url.pathname));
}

function trustedPageUrl(value: string | URL): URL | undefined {
  const url = parseUrl(value);
  return url?.origin === NOVEL_UPDATES_ORIGIN && url.protocol === 'https:' ? url : undefined;
}

function trustedNovelUpdatesUrl(value: string | null, baseUrl: URL): URL | undefined {
  const url = parseUrl(value, baseUrl);
  return url?.origin === NOVEL_UPDATES_ORIGIN && url.protocol === 'https:' ? url : undefined;
}

function trustedAssetUrl(value: string | undefined): string | undefined {
  const url = parseUrl(value);
  return url &&
    url.protocol === 'https:' &&
    (url.origin === NOVEL_UPDATES_ORIGIN || url.origin === FORUM_ORIGIN)
    ? url.href
    : undefined;
}

function parseUrl(value: string | URL | null | undefined, base?: URL): URL | undefined {
  if (!value) return undefined;
  try {
    return value instanceof URL ? new URL(value.href) : new URL(value, base);
  } catch {
    return undefined;
  }
}

function parseCount(value: string | null | undefined): number | undefined {
  const text = cleanText(value);
  if (!text || !/^\d[\d,]*$/u.test(text)) return undefined;
  const count = Number(text.replace(/,/gu, ''));
  return Number.isSafeInteger(count) && count >= 0 ? count : undefined;
}

function cleanText(value: string | null | undefined): string | undefined {
  const text = value?.replace(/\s+/gu, ' ').trim();
  return text || undefined;
}

function unknown(generation: number, message: string): ParsedAccountState {
  const warnings: ParseWarning[] = [
    { code: 'unsupported-markup', field: 'account', message },
  ];
  return { generation, account: { status: 'unknown', warnings } };
}
