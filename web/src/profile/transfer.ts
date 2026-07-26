import type { LocalUserProfile, ProfileEntry, ReadingStatus } from './types';

const STATUSES = new Set<ReadingStatus>(['reading', 'completed', 'plan_to_read', 'dropped', 'paused']);
const SIGNALS = new Set(['love', 'read', 'not_for_me']);

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function string(value: unknown, label: string, optional = false): string | undefined {
  if (optional && value == null) return undefined;
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be text.`);
  return value.trim();
}

function number(value: unknown, label: string, optional = false): number | undefined {
  if (optional && value == null) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label} must be a number.`);
  return value;
}

function entry(value: unknown, index: number): ProfileEntry {
  const item = object(value, `entries[${index}]`);
  const status = string(item.status, `entries[${index}].status`) as ReadingStatus;
  const rating = number(item.rating, `entries[${index}].rating`, true);
  if (!STATUSES.has(status)) throw new Error(`entries[${index}].status is not supported.`);
  if (rating != null && (rating < 1 || rating > 5)) throw new Error(`entries[${index}].rating must be between 1 and 5.`);
  const mediaKindRaw = string(item.media_kind, `entries[${index}].media_kind`, true);
  const media_kind =
    mediaKindRaw === 'anime' || mediaKindRaw === 'manga' || mediaKindRaw === 'novel'
      ? mediaKindRaw
      : undefined;
  // Optional AniList/enriched fields — old NovelUpdates-only backups remain valid.
  return {
    novel_id: number(item.novel_id, `entries[${index}].novel_id`, true),
    slug: string(item.slug, `entries[${index}].slug`)!,
    imported_title: string(item.imported_title, `entries[${index}].imported_title`)!,
    status, rating,
    progress: string(item.progress, `entries[${index}].progress`, true),
    progress_units: number(item.progress_units, `entries[${index}].progress_units`, true),
    media_kind,
    started_on: string(item.started_on, `entries[${index}].started_on`, true),
    finished_on: string(item.finished_on, `entries[${index}].finished_on`, true),
    source_file: string(item.source_file, `entries[${index}].source_file`)!,
  };
}

export function parseProfileBackup(value: unknown): LocalUserProfile {
  const item = object(value, 'Profile backup');
  if (!Array.isArray(item.entries) || !Array.isArray(item.curated_lists) || !Array.isArray(item.source_fingerprints)) {
    throw new Error('Profile backup is missing required library arrays.');
  }
  if (item.feedback != null && !Array.isArray(item.feedback)) throw new Error('Profile feedback must be an array.');
  const parserVersion = number(item.parser_version, 'parser_version')!;
  if (!Number.isInteger(parserVersion) || parserVersion < 1) throw new Error('parser_version is not supported.');
  return {
    profile_id: string(item.profile_id, 'profile_id')!,
    parser_version: parserVersion,
    dataset_version: string(item.dataset_version, 'dataset_version')!,
    username: string(item.username, 'username', true),
    imported_at: string(item.imported_at, 'imported_at')!,
    source_fingerprints: item.source_fingerprints.map((value, index) => string(value, `source_fingerprints[${index}]`)!),
    entries: item.entries.map(entry),
    curated_lists: item.curated_lists.map((value, index) => {
      const list = object(value, `curated_lists[${index}]`);
      return {
        id: number(list.id, `curated_lists[${index}].id`)!,
        title: string(list.title, `curated_lists[${index}].title`)!,
        description: string(list.description, `curated_lists[${index}].description`, true),
        series_count: number(list.series_count, `curated_lists[${index}].series_count`, true),
        followers: number(list.followers, `curated_lists[${index}].followers`, true),
        is_private: typeof list.is_private === 'boolean' ? list.is_private : undefined,
        membership_available: false as const,
      };
    }),
    feedback: (item.feedback || []).map((value, index) => {
      const feedback = object(value, `feedback[${index}]`);
      const signal = string(feedback.signal, `feedback[${index}].signal`)!;
      if (!SIGNALS.has(signal)) throw new Error(`feedback[${index}].signal is not supported.`);
      return {
        novel_id: number(feedback.novel_id, `feedback[${index}].novel_id`)!,
        slug: string(feedback.slug, `feedback[${index}].slug`)!,
        title: string(feedback.title, `feedback[${index}].title`)!,
        signal: signal as 'love' | 'read' | 'not_for_me',
        updated_at: string(feedback.updated_at, `feedback[${index}].updated_at`)!,
      };
    }),
  };
}

export function downloadProfileBackup(profile: LocalUserProfile): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(profile, null, 2)], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `novel-compass-profile-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}
