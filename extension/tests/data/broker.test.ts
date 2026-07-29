import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import { ExtensionDataBroker, type DataBrokerDependencies } from '../../src/data/broker';

const origin = 'https://data.example.test';
const body = JSON.stringify({ rows: [['fixture']] });
const digest = createHash('sha256').update(body).digest('hex');

function jsonResponse(value: string, status = 200): Response {
  return new Response(value, { status, headers: { 'content-type': 'application/json' } });
}

function setup(options: { corrupt?: boolean; offlineAfterWarm?: boolean } = {}) {
  const stored: Record<string, unknown> = {};
  const cacheEntries = new Map<string, Response>();
  let offline = false;
  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith('chrome-extension://')) return jsonResponse('{}', 404);
    if (offline) throw new TypeError('offline');
    if (url.endsWith('/latest.json')) {
      return jsonResponse(
        JSON.stringify({
          dataset_version: '2026-07-29',
          manifest_url: `${origin}/v1/2026-07-29/manifest.json`,
        }),
      );
    }
    if (url.endsWith('/manifest.json')) {
      return jsonResponse(
        JSON.stringify({
          schema_version: 1,
          dataset_version: '2026-07-29',
          artifacts: {
            'details/0a.json': {
              url: 'details/0a.json',
              sha256: digest,
              compressed_bytes: body.length,
            },
          },
        }),
      );
    }
    return jsonResponse(options.corrupt ? '{"wrong":true}' : body);
  });
  const cache = {
    match: vi.fn(async (key: RequestInfo | URL) => cacheEntries.get(String(key))?.clone()),
    put: vi.fn(async (key: RequestInfo | URL, value: Response) => {
      cacheEntries.set(String(key), value.clone());
    }),
  };
  const dependencies: DataBrokerDependencies = {
    fetch: fetcher as typeof fetch,
    caches: {
      open: vi.fn(async () => cache as unknown as Cache),
      delete: vi.fn(async () => true),
      keys: vi.fn(async () => ['novel-compass-data-2026-07-29']),
    },
    storage: {
      get: vi.fn(async (key) => ({ [key]: stored[key] })),
      set: vi.fn(async (items) => Object.assign(stored, items)),
      remove: vi.fn(async (key) => {
        delete stored[key];
      }),
    },
    packagedUrl: (path) => `chrome-extension://fixture/data/${path}`,
    latestUrl: `${origin}/latest.json`,
    trustedOrigins: new Set([origin]),
    now: () => new Date('2026-07-29T00:00:00.000Z'),
  };
  return {
    broker: new ExtensionDataBroker(dependencies),
    fetcher,
    cache,
    goOffline: () => {
      offline = true;
    },
    stored,
  };
}

describe('ExtensionDataBroker', () => {
  it('prepares only the small manifest boundary before feature data is requested', async () => {
    const fixture = setup();
    await expect(fixture.broker.prepare()).resolves.toMatchObject({
      ok: true,
      status: { state: 'not-downloaded', datasetVersion: '2026-07-29' },
    });
    expect(fixture.fetcher.mock.calls.some(([url]) => String(url).endsWith('0a.json'))).toBe(false);
  });

  it('validates, caches, reports version, and serves a warm cache offline after restart', async () => {
    const fixture = setup();
    await expect(fixture.broker.fetchArtifact('details/0a.json')).resolves.toMatchObject({
      ok: true,
      datasetVersion: '2026-07-29',
      body: { rows: [['fixture']] },
      cache: 'network',
    });
    expect(fixture.cache.put).toHaveBeenCalledTimes(1);

    fixture.goOffline();
    const restarted = new ExtensionDataBroker(
      (fixture.broker as unknown as { dependencies: DataBrokerDependencies }).dependencies,
    );
    await expect(restarted.fetchArtifact('details/0a.json')).resolves.toMatchObject({
      ok: true,
      cache: 'hit',
      datasetVersion: '2026-07-29',
    });
  });

  it('rejects corrupt shards without caching them', async () => {
    const fixture = setup({ corrupt: true });
    await expect(fixture.broker.fetchArtifact('details/0a.json')).resolves.toMatchObject({
      ok: false,
      code: 'integrity-failed',
      message: expect.stringContaining('integrity'),
    });
    expect(fixture.cache.put).not.toHaveBeenCalled();
  });

  it('coalesces concurrent shard requests and removes only data-pack state', async () => {
    const fixture = setup();
    const [first, second] = await Promise.all([
      fixture.broker.fetchArtifact('details/0a.json'),
      fixture.broker.fetchArtifact('details/0a.json'),
    ]);
    expect(first).toEqual(second);
    expect(fixture.fetcher.mock.calls.filter(([url]) => String(url).endsWith('0a.json'))).toHaveLength(
      2,
    );
    await expect(fixture.broker.remove()).resolves.toEqual({ ok: true, removed: true });
    expect(fixture.stored).toEqual({});
  });

  it('fails closed on an untrusted artifact origin', async () => {
    const fixture = setup();
    fixture.fetcher.mockImplementation(async (input) => {
      const url = String(input);
      if (url.startsWith('chrome-extension://')) return jsonResponse('{}', 404);
      if (url.endsWith('/latest.json')) {
        return jsonResponse(
          JSON.stringify({
            dataset_version: '2026-07-29',
            manifest_url: `${origin}/v1/2026-07-29/manifest.json`,
          }),
        );
      }
      return jsonResponse(
        JSON.stringify({
          schema_version: 1,
          dataset_version: '2026-07-29',
          artifacts: {
            'details/0a.json': {
              url: 'https://evil.test/data.json',
              sha256: digest,
            },
          },
        }),
      );
    });
    await expect(fixture.broker.fetchArtifact('details/0a.json')).resolves.toMatchObject({
      ok: false,
      message: expect.stringContaining('trusted'),
    });
  });
});
