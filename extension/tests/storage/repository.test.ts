import { describe, expect, it } from 'vitest';

import { ExtensionStorageRepository, EXTENSION_STORAGE_KEYS } from '../../src/storage/repository';
import type { ExtensionStorageArea } from '../../src/storage/types';

const NOW = '2026-07-29T02:00:00.000Z';

class MemoryStorage implements ExtensionStorageArea {
  readonly values = new Map<string, unknown>();

  async get(keys: string | string[]): Promise<Record<string, unknown>> {
    const result: Record<string, unknown> = {};
    for (const key of Array.isArray(keys) ? keys : [keys]) {
      if (this.values.has(key)) result[key] = structuredClone(this.values.get(key));
    }
    return result;
  }

  async set(items: Record<string, unknown>): Promise<void> {
    for (const [key, value] of Object.entries(items)) {
      this.values.set(key, structuredClone(value));
    }
  }

  async remove(keys: string | string[]): Promise<void> {
    for (const key of Array.isArray(keys) ? keys : [keys]) this.values.delete(key);
  }
}

const websiteProfile = {
  profile_id: 'fixture-profile',
  parser_version: 1,
  dataset_version: 'fixture-data',
  username: 'fixture-user',
  imported_at: NOW,
  source_fingerprints: ['sha256:fixture'],
  entries: [
    {
      novel_id: 101,
      slug: 'fixture-novel',
      imported_title: 'Fixture Novel',
      status: 'reading',
      progress: 'c12',
      source_file: 'fixture.html',
    },
  ],
  curated_lists: [],
};

describe('ExtensionStorageRepository', () => {
  it('returns defaults without writing when storage is missing or corrupt', async () => {
    const area = new MemoryStorage();
    const repository = new ExtensionStorageRepository(area, () => NOW);

    expect(await repository.loadPreferences()).toEqual({
      status: 'missing',
      value: {
        schemaVersion: 2,
        extensionEnabled: true,
        showOriginalButton: true,
        theme: 'system',
        pageModes: { series: 'replacement', seriesFinder: 'replacement' },
        updatedAt: NOW,
      },
    });
    expect(area.values.size).toBe(0);

    area.values.set(EXTENSION_STORAGE_KEYS.preferences, {
      schemaVersion: 1,
      extensionEnabled: 'yes',
    });
    expect(await repository.loadPreferences()).toMatchObject({
      status: 'corrupt',
      value: { extensionEnabled: true },
    });
    expect(area.values.get(EXTENSION_STORAGE_KEYS.preferences)).toEqual({
      schemaVersion: 1,
      extensionEnabled: 'yes',
    });
  });

  it('reports older or future schemas without silently migrating or overwriting', async () => {
    const area = new MemoryStorage();
    area.values.set(EXTENSION_STORAGE_KEYS.preferences, { schemaVersion: 0 });
    area.values.set(EXTENSION_STORAGE_KEYS.profile, { schemaVersion: 2 });
    const repository = new ExtensionStorageRepository(area, () => NOW);

    expect(await repository.loadPreferences()).toMatchObject({
      status: 'unsupported',
      foundSchemaVersion: 0,
    });
    expect(await repository.loadProfile()).toEqual({
      status: 'unsupported',
      value: null,
      foundSchemaVersion: 2,
    });
  });

  it('migrates v1 preferences without losing enablement or page choices', async () => {
    const area = new MemoryStorage();
    area.values.set(EXTENSION_STORAGE_KEYS.preferences, {
      schemaVersion: 1,
      extensionEnabled: false,
      pageModes: { series: 'original', seriesFinder: 'replacement' },
      updatedAt: '2026-07-28T01:00:00.000Z',
    });
    const repository = new ExtensionStorageRepository(area, () => NOW);

    expect(await repository.loadPreferences()).toEqual({
      status: 'ready',
      value: {
        schemaVersion: 2,
        extensionEnabled: false,
        showOriginalButton: true,
        theme: 'system',
        pageModes: { series: 'original', seriesFinder: 'replacement' },
        updatedAt: '2026-07-28T01:00:00.000Z',
      },
    });
    expect(area.values.get(EXTENSION_STORAGE_KEYS.preferences)).toMatchObject({
      schemaVersion: 2,
      extensionEnabled: false,
      theme: 'system',
    });
  });

  it('persists global enablement and independent original-view choices', async () => {
    const area = new MemoryStorage();
    const repository = new ExtensionStorageRepository(area, () => NOW);

    await repository.setEnabled(false);
    await repository.updatePreferences({ theme: 'dark' });
    await repository.updatePreferences({ showOriginalButton: false });
    await repository.setPageMode('series', 'original');
    const loaded = await repository.loadPreferences();

    expect(loaded.status).toBe('ready');
    expect(loaded.value).toMatchObject({
      extensionEnabled: false,
      showOriginalButton: false,
      theme: 'dark',
      pageModes: {
        series: 'original',
        seriesFinder: 'replacement',
      },
    });
  });

  it('imports website profile JSON explicitly without reading website storage', async () => {
    const area = new MemoryStorage();
    const repository = new ExtensionStorageRepository(area, () => NOW);

    const imported = await repository.importWebsiteProfile(JSON.stringify(websiteProfile));
    expect(imported).toMatchObject({
      schemaVersion: 1,
      source: 'website-import',
      importedAt: NOW,
      profile: { profile_id: 'fixture-profile' },
    });
    expect((await repository.loadProfile()).status).toBe('ready');
  });

  it('round-trips a versioned backup and clears a destination profile when absent', async () => {
    const sourceArea = new MemoryStorage();
    const source = new ExtensionStorageRepository(sourceArea, () => NOW);
    await source.setPageMode('seriesFinder', 'original');
    await source.importWebsiteProfile(JSON.stringify(websiteProfile));
    const json = await source.exportBackup();

    const destinationArea = new MemoryStorage();
    const destination = new ExtensionStorageRepository(destinationArea, () => NOW);
    const imported = await destination.importBackup(json);
    expect(imported.kind).toBe('novel-compass-extension-backup');
    expect((await destination.loadPreferences()).value.pageModes.seriesFinder).toBe('original');
    expect((await destination.loadProfile()).value?.profile.profile_id).toBe('fixture-profile');

    const withoutProfile = { ...JSON.parse(json), profile: null };
    await destination.importBackup(JSON.stringify(withoutProfile));
    expect(await destination.loadProfile()).toEqual({ status: 'missing', value: null });
  });

  it('rejects invalid JSON and unsupported backups before writing', async () => {
    const area = new MemoryStorage();
    const repository = new ExtensionStorageRepository(area, () => NOW);

    await expect(repository.importBackup('{broken')).rejects.toThrow('not valid JSON');
    await expect(
      repository.importBackup(
        JSON.stringify({
          kind: 'novel-compass-extension-backup',
          schemaVersion: 99,
        }),
      ),
    ).rejects.toThrow('schema 99 is unsupported');
    await expect(
      repository.importWebsiteProfile(
        JSON.stringify({
          ...websiteProfile,
          entries: [{ slug: 'unsafe' }],
        }),
      ),
    ).rejects.toThrow('failed schema validation');
    expect(area.values.size).toBe(0);
  });
});
