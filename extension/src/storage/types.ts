import type { LocalUserProfile } from '../../../web/src/profile/types';

export const EXTENSION_STORAGE_SCHEMA_VERSION = 1;
export const EXTENSION_BACKUP_SCHEMA_VERSION = 1;

export type ExtensionPageMode = 'replacement' | 'original';

export interface ExtensionPreferences {
  schemaVersion: 1;
  extensionEnabled: boolean;
  pageModes: {
    series: ExtensionPageMode;
    seriesFinder: ExtensionPageMode;
  };
  updatedAt: string;
}

export interface ExtensionStoredProfile {
  schemaVersion: 1;
  source: 'extension' | 'website-import';
  importedAt: string;
  profile: LocalUserProfile;
}

export interface ExtensionBackup {
  kind: 'novel-compass-extension-backup';
  schemaVersion: 1;
  exportedAt: string;
  preferences: ExtensionPreferences;
  profile: ExtensionStoredProfile | null;
}

export type StorageLoadResult<T> =
  | { status: 'ready'; value: T }
  | { status: 'missing'; value: T }
  | { status: 'corrupt'; value: T; reason: string }
  | { status: 'unsupported'; value: T; foundSchemaVersion?: number };

export interface ExtensionStorageArea {
  get(keys: string | string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}
