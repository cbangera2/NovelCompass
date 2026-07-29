// @vitest-environment happy-dom

import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import finderFixture from '../fixtures/series-finder.html?raw';
import seriesFixture from '../fixtures/series-logged-out.html?raw';
import unsupportedFixture from '../fixtures/unsupported-markup.html?raw';

const PREFERENCES_KEY = 'novelCompass.preferences.v1';
const HOST_ID = 'novel-compass-extension-root';
const ACTIVE_CLASS = 'novel-compass-replacement-active';
const EXTENSION_ORIGIN = 'chrome-extension://fixture-extension/';

type PageModes = {
  series: 'replacement' | 'original';
  seriesFinder: 'replacement' | 'original';
};

beforeEach(() => {
  vi.resetModules();
  installChromeApi();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => fixtureResponse(String(input))),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.documentElement.classList.remove(ACTIVE_CLASS);
  document.documentElement.classList.remove('novel-compass-native-theme');
  document.documentElement.removeAttribute('data-novel-compass-extension');
  document.body.replaceChildren();
  document.head.replaceChildren();
});

describe('content bootstrap runtime', () => {
  it('mounts the series replacement, preserves the original DOM, and toggles reversibly', async () => {
    loadPage(seriesFixture, 'https://www.novelupdates.com/series/fixture-mercenary/');
    const originalMain = document.querySelector('main');

    await import('../../src/content/bootstrap');
    await waitFor(() => document.documentElement.classList.contains(ACTIVE_CLASS));

    const host = document.getElementById(HOST_ID);
    expect(host).not.toBeNull();
    expect(document.querySelectorAll(`#${HOST_ID}`)).toHaveLength(1);
    expect(document.querySelector('main')).toBe(originalMain);
    expect(host?.shadowRoot?.textContent).toContain('Fixture Mercenary');
    expect(host?.shadowRoot?.textContent).toContain('Overview');
    expect(host?.shadowRoot?.textContent).toContain('Chapters');

    const { ensureReplacementHost } = await import('../../src/content/replacement-host');
    expect(ensureReplacementHost(document).host).toBe(host);
    expect(document.querySelectorAll(`#${HOST_ID}`)).toHaveLength(1);

    const toggle = host?.shadowRoot?.querySelector<HTMLButtonElement>('#novel-compass-view-toggle');
    toggle?.click();
    expect(document.documentElement.classList.contains(ACTIVE_CLASS)).toBe(false);
    expect(toggle?.textContent).toBe('Use Novel Compass');
    expect(document.querySelector('main')).toBe(originalMain);

    toggle?.click();
    expect(document.documentElement.classList.contains(ACTIVE_CLASS)).toBe(true);
    expect(document.querySelectorAll(`#${HOST_ID}`)).toHaveLength(1);
  });

  it('mounts the Series Finder against the packaged extension dataset URL', async () => {
    loadPage(finderFixture, 'https://www.novelupdates.com/series-finder/');

    await import('../../src/content/bootstrap');
    await waitFor(() => document.documentElement.classList.contains(ACTIVE_CLASS));

    const host = document.getElementById(HOST_ID);
    expect(host?.shadowRoot?.textContent).toContain('Novel Compass Search');
    expect(host?.shadowRoot?.textContent).toContain('Loading the Novel Compass catalog');
    expect(fetch).toHaveBeenCalledWith(`${EXTENSION_ORIGIN}content/style.css`);
    await waitFor(() =>
      vi.mocked(fetch).mock.calls.some(([url]) => String(url).endsWith('/data/manifest.json')),
    );
  });

  it.each([
    {
      name: 'extension disabled',
      enabled: false,
      pageModes: { series: 'replacement', seriesFinder: 'replacement' } satisfies PageModes,
    },
    {
      name: 'series preference set to original',
      enabled: true,
      pageModes: { series: 'original', seriesFinder: 'replacement' } satisfies PageModes,
    },
  ])('leaves the page untouched when $name', async ({ enabled, pageModes }) => {
    loadPage(seriesFixture, 'https://www.novelupdates.com/series/fixture-mercenary/');
    installChromeApi(preferences(enabled, pageModes));

    await import('../../src/content/bootstrap');
    await settle();

    expect(document.getElementById(HOST_ID)).toBeNull();
    expect(document.documentElement.classList.contains(ACTIVE_CLASS)).toBe(false);
    expect(document.querySelector('.seriestitlenu')?.textContent).toContain('Fixture Mercenary');
  });

  it('fails closed on unsupported markup', async () => {
    loadPage(unsupportedFixture, 'https://www.novelupdates.com/series/unsupported-markup/');

    await import('../../src/content/bootstrap');
    await settle();

    expect(document.getElementById(HOST_ID)).toBeNull();
    expect(document.documentElement.classList.contains(ACTIVE_CLASS)).toBe(false);
  });

  it('themes a registered native route without replacing its form DOM', async () => {
    loadPage(
      `<!doctype html><html><head><title>Account</title></head><body>
        <header class="l-header">Novel Updates</header>
        <main id="account-content"><form action="/account/" method="post">
          <input name="_wpnonce" value="preserved"><button type="submit">Save</button>
        </form></main>
      </body></html>`,
      'https://www.novelupdates.com/account/',
    );
    const originalMain = document.getElementById('account-content');
    const originalForm = document.querySelector('form');

    await import('../../src/content/bootstrap');
    await waitFor(() => document.documentElement.classList.contains('novel-compass-native-theme'));

    expect(document.getElementById('account-content')).toBe(originalMain);
    expect(document.querySelector('form')).toBe(originalForm);
    expect(document.querySelector<HTMLInputElement>('input[name="_wpnonce"]')?.value).toBe(
      'preserved',
    );
    const host = document.getElementById('novel-compass-native-theme-root');
    const toggle = host?.shadowRoot?.querySelector<HTMLButtonElement>('button');
    toggle?.click();
    expect(document.documentElement.classList.contains('novel-compass-native-theme')).toBe(false);
    expect(document.getElementById('account-content')).toBe(originalMain);
    expect(document.querySelector('form')).toBe(originalForm);
  });
});

function installChromeApi(storedPreferences?: unknown): void {
  vi.stubGlobal('chrome', {
    runtime: {
      getURL: (resource: string) => `${EXTENSION_ORIGIN}${resource}`,
    },
    storage: {
      local: {
        get: vi.fn(async () =>
          storedPreferences === undefined ? {} : { [PREFERENCES_KEY]: storedPreferences },
        ),
        set: vi.fn(async () => undefined),
        remove: vi.fn(async () => undefined),
      },
    },
  });
}

function preferences(enabled: boolean, pageModes: PageModes): unknown {
  return {
    schemaVersion: 1,
    extensionEnabled: enabled,
    pageModes,
    updatedAt: '2026-07-28T12:00:00.000Z',
  };
}

function loadPage(html: string, url: string): void {
  (
    window as typeof window & {
      happyDOM: { setURL(nextUrl: string): void };
    }
  ).happyDOM.setURL(url);
  document.open();
  document.write(html);
  document.close();
}

async function fixtureResponse(url: string): Promise<Response> {
  if (url === `${EXTENSION_ORIGIN}content/style.css`) {
    return new Response(':host { display: block; }', {
      status: 200,
      headers: { 'content-type': 'text/css' },
    });
  }
  if (url === `${EXTENSION_ORIGIN}content/native-theme.css`) {
    return new Response('html.novel-compass-native-theme { color-scheme: dark; }', {
      status: 200,
      headers: { 'content-type': 'text/css' },
    });
  }

  const resource = url.slice(`${EXTENSION_ORIGIN}data/`.length);
  if (!/^[a-z0-9/_-]+\.json$/i.test(resource) || resource.includes('..')) {
    return new Response('Not found', { status: 404 });
  }
  try {
    const body = await readFile(
      path.resolve(process.cwd(), '../tests/fixtures/extension-static-data', resource),
      'utf8',
    );
    return new Response(body, {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  } catch {
    return new Response('Not found', { status: 404 });
  }
}

async function waitFor(condition: () => boolean, timeoutMs = 1_000): Promise<void> {
  const startedAt = Date.now();
  while (!condition()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error('Timed out waiting for runtime state.');
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}
