import type { LocalUserProfile, ProfileEntry } from '../../../web/src/profile/types';
import {
  EXTENSION_BACKUP_SCHEMA_VERSION,
  EXTENSION_STORAGE_SCHEMA_VERSION,
  type ExtensionBackup,
  type ExtensionPreferences,
  type ExtensionStoredProfile,
} from './types';

export function defaultExtensionPreferences(now = new Date().toISOString()): ExtensionPreferences {
  return {
    schemaVersion: EXTENSION_STORAGE_SCHEMA_VERSION,
    extensionEnabled: true,
    pageModes: {
      series: 'replacement',
      seriesFinder: 'replacement',
    },
    updatedAt: now,
  };
}

export function parsePreferences(value: unknown): ExtensionPreferences | undefined {
  if (!isRecord(value) || value.schemaVersion !== EXTENSION_STORAGE_SCHEMA_VERSION)
    return undefined;
  if (
    typeof value.extensionEnabled !== 'boolean' ||
    !isRecord(value.pageModes) ||
    !isPageMode(value.pageModes.series) ||
    !isPageMode(value.pageModes.seriesFinder) ||
    !isIsoDateTime(value.updatedAt)
  )
    return undefined;
  return value as unknown as ExtensionPreferences;
}

export function parseStoredProfile(value: unknown): ExtensionStoredProfile | undefined {
  if (!isRecord(value) || value.schemaVersion !== EXTENSION_STORAGE_SCHEMA_VERSION)
    return undefined;
  if (
    (value.source !== 'extension' && value.source !== 'website-import') ||
    !isIsoDateTime(value.importedAt)
  )
    return undefined;
  const profile = parseWebsiteProfile(value.profile);
  return profile
    ? {
        schemaVersion: EXTENSION_STORAGE_SCHEMA_VERSION,
        source: value.source,
        importedAt: value.importedAt,
        profile,
      }
    : undefined;
}

/** Validate an explicit website JSON export without reading website IndexedDB. */
export function parseWebsiteProfile(value: unknown): LocalUserProfile | undefined {
  if (!isRecord(value)) return undefined;
  if (
    typeof value.profile_id !== 'string' ||
    !Number.isSafeInteger(value.parser_version) ||
    typeof value.dataset_version !== 'string' ||
    !isIsoDateTime(value.imported_at) ||
    !isStringArray(value.source_fingerprints) ||
    !Array.isArray(value.entries) ||
    !Array.isArray(value.curated_lists)
  )
    return undefined;
  if (!value.entries.every(isProfileEntry)) return undefined;
  return structuredClone(value) as unknown as LocalUserProfile;
}

export function parseBackup(value: unknown): ExtensionBackup | undefined {
  if (
    !isRecord(value) ||
    value.kind !== 'novel-compass-extension-backup' ||
    value.schemaVersion !== EXTENSION_BACKUP_SCHEMA_VERSION ||
    !isIsoDateTime(value.exportedAt)
  )
    return undefined;
  const preferences = parsePreferences(value.preferences);
  const profile = value.profile === null ? null : parseStoredProfile(value.profile);
  if (!preferences || profile === undefined) return undefined;
  return {
    kind: 'novel-compass-extension-backup',
    schemaVersion: EXTENSION_BACKUP_SCHEMA_VERSION,
    exportedAt: value.exportedAt,
    preferences,
    profile,
  };
}

export function schemaVersionOf(value: unknown): number | undefined {
  return isRecord(value) && Number.isSafeInteger(value.schemaVersion)
    ? (value.schemaVersion as number)
    : undefined;
}

function isProfileEntry(value: unknown): value is ProfileEntry {
  if (!isRecord(value)) return false;
  return (
    (value.novel_id === undefined || Number.isSafeInteger(value.novel_id)) &&
    typeof value.slug === 'string' &&
    typeof value.imported_title === 'string' &&
    ['reading', 'completed', 'plan_to_read', 'dropped', 'paused'].includes(String(value.status)) &&
    typeof value.source_file === 'string'
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isPageMode(value: unknown): value is 'replacement' | 'original' {
  return value === 'replacement' || value === 'original';
}

function isIsoDateTime(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}
