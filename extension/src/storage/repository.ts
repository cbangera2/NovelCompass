import type { LocalUserProfile } from '../../../web/src/profile/types';
import {
  EXTENSION_BACKUP_SCHEMA_VERSION,
  EXTENSION_PREFERENCES_SCHEMA_VERSION,
  EXTENSION_STORAGE_SCHEMA_VERSION,
  type ExtensionBackup,
  type ExtensionPageMode,
  type ExtensionPreferences,
  type ExtensionStorageArea,
  type ExtensionStoredProfile,
  type StorageLoadResult,
} from './types';
import {
  defaultExtensionPreferences,
  migratePreferences,
  parseBackup,
  parsePreferences,
  parseStoredProfile,
  parseWebsiteProfile,
  schemaVersionOf,
} from './validation';

const PREFERENCES_KEY = 'novelCompass.preferences.v1';
const PROFILE_KEY = 'novelCompass.profile.v1';

export class ExtensionStorageRepository {
  constructor(
    private readonly area: ExtensionStorageArea,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async loadPreferences(): Promise<StorageLoadResult<ExtensionPreferences>> {
    const fallback = defaultExtensionPreferences(this.now());
    const stored = (await this.area.get(PREFERENCES_KEY))[PREFERENCES_KEY];
    if (stored === undefined) return { status: 'missing', value: fallback };
    const parsed = parsePreferences(stored);
    if (parsed) return { status: 'ready', value: parsed };
    const migrated = migratePreferences(stored);
    if (migrated) {
      await this.area.set({ [PREFERENCES_KEY]: migrated });
      return { status: 'ready', value: migrated };
    }
    const version = schemaVersionOf(stored);
    return version !== undefined && version !== 1 && version !== EXTENSION_PREFERENCES_SCHEMA_VERSION
      ? { status: 'unsupported', value: fallback, foundSchemaVersion: version }
      : { status: 'corrupt', value: fallback, reason: 'Preferences failed schema validation.' };
  }

  async savePreferences(preferences: ExtensionPreferences): Promise<void> {
    const parsed = parsePreferences(preferences);
    if (!parsed) throw new Error('Refusing to save invalid extension preferences.');
    await this.area.set({ [PREFERENCES_KEY]: structuredClone(parsed) });
  }

  async updatePreferences(
    update: Partial<
      Pick<ExtensionPreferences, 'extensionEnabled' | 'showOriginalButton' | 'theme'>
    > & {
      pageModes?: Partial<ExtensionPreferences['pageModes']>;
    },
  ): Promise<ExtensionPreferences> {
    const current = (await this.loadPreferences()).value;
    const next: ExtensionPreferences = {
      ...current,
      ...(update.extensionEnabled === undefined
        ? {}
        : { extensionEnabled: update.extensionEnabled }),
      ...(update.showOriginalButton === undefined
        ? {}
        : { showOriginalButton: update.showOriginalButton }),
      ...(update.theme === undefined ? {} : { theme: update.theme }),
      pageModes: { ...current.pageModes, ...update.pageModes },
      updatedAt: this.now(),
    };
    await this.savePreferences(next);
    return next;
  }

  setEnabled(enabled: boolean): Promise<ExtensionPreferences> {
    return this.updatePreferences({ extensionEnabled: enabled });
  }

  setPageMode(
    page: keyof ExtensionPreferences['pageModes'],
    mode: ExtensionPageMode,
  ): Promise<ExtensionPreferences> {
    return this.updatePreferences({ pageModes: { [page]: mode } });
  }

  async loadProfile(): Promise<StorageLoadResult<ExtensionStoredProfile | null>> {
    const stored = (await this.area.get(PROFILE_KEY))[PROFILE_KEY];
    if (stored === undefined) return { status: 'missing', value: null };
    const parsed = parseStoredProfile(stored);
    if (parsed) return { status: 'ready', value: parsed };
    const version = schemaVersionOf(stored);
    return version !== undefined && version !== EXTENSION_STORAGE_SCHEMA_VERSION
      ? { status: 'unsupported', value: null, foundSchemaVersion: version }
      : { status: 'corrupt', value: null, reason: 'Profile failed schema validation.' };
  }

  async saveProfile(
    profile: LocalUserProfile,
    source: ExtensionStoredProfile['source'],
  ): Promise<void> {
    const parsed = parseWebsiteProfile(profile);
    if (!parsed) throw new Error('Refusing to save an invalid local profile.');
    const stored: ExtensionStoredProfile = {
      schemaVersion: EXTENSION_STORAGE_SCHEMA_VERSION,
      source,
      importedAt: this.now(),
      profile: parsed,
    };
    await this.area.set({ [PROFILE_KEY]: stored });
  }

  async clearProfile(): Promise<void> {
    await this.area.remove(PROFILE_KEY);
  }

  async exportBackup(): Promise<string> {
    const preferences = (await this.loadPreferences()).value;
    const profile = (await this.loadProfile()).value;
    const backup: ExtensionBackup = {
      kind: 'novel-compass-extension-backup',
      schemaVersion: EXTENSION_BACKUP_SCHEMA_VERSION,
      exportedAt: this.now(),
      preferences,
      profile,
    };
    return JSON.stringify(backup, null, 2);
  }

  /**
   * Import is deliberately explicit and atomic from the repository caller's
   * perspective: the whole payload validates before any storage writes occur.
   */
  async importBackup(json: string): Promise<ExtensionBackup> {
    const raw = parseJson(json);
    const foundVersion = schemaVersionOf(raw);
    if (foundVersion !== undefined && foundVersion !== EXTENSION_BACKUP_SCHEMA_VERSION) {
      throw new Error(`Backup schema ${foundVersion} is unsupported.`);
    }
    const backup = parseBackup(raw);
    if (!backup) throw new Error('Backup failed schema validation.');
    await this.area.set({
      [PREFERENCES_KEY]: backup.preferences,
      ...(backup.profile ? { [PROFILE_KEY]: backup.profile } : {}),
    });
    if (!backup.profile) await this.area.remove(PROFILE_KEY);
    return backup;
  }

  async importWebsiteProfile(json: string): Promise<ExtensionStoredProfile> {
    const profile = parseWebsiteProfile(parseJson(json));
    if (!profile) throw new Error('Website profile export failed schema validation.');
    await this.saveProfile(profile, 'website-import');
    return (await this.loadProfile()).value!;
  }
}

function parseJson(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    throw new Error('Import is not valid JSON.');
  }
}

export const EXTENSION_STORAGE_KEYS = {
  preferences: PREFERENCES_KEY,
  profile: PROFILE_KEY,
} as const;
