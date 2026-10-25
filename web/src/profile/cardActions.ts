import type { LocalNovelFeedback, LocalUserProfile, ProfileEntry, ReadingStatus } from './types';

/** The bits of a title the card actions need to write into the local profile. */
export interface NovelRef {
  id: number;
  /** Not every row carries one (For You rows do not); it is derived from the title when missing. */
  slug?: string;
  /** The catalog title, not the user's display-preference title. */
  title: string;
}

export type FeedbackSignal = LocalNovelFeedback['signal'];

interface WriteOptions {
  datasetVersion?: string;
  now?: () => string;
  newProfileId?: () => string;
}

/** NovelUpdates-style slug: lowercase words joined by hyphens. Only used when a row has no real slug. */
export function slugFromTitle(title: string): string {
  return title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function slugForNovel(novel: NovelRef): string {
  return novel.slug || slugFromTitle(novel.title) || `novel-${novel.id}`;
}

function startingProfile(profile: LocalUserProfile | null, options: WriteOptions): LocalUserProfile {
  return profile ?? {
    profile_id: (options.newProfileId ?? (() => crypto.randomUUID()))(),
    parser_version: 1,
    dataset_version: options.datasetVersion || 'unknown',
    imported_at: (options.now ?? (() => new Date().toISOString()))(),
    source_fingerprints: [],
    entries: [],
    curated_lists: [],
    feedback: [],
  };
}

/**
 * Sets (or with '' removes) a title's reading status. Changing the status keeps whatever else the
 * library knows about the entry (rating, progress, dates) so a card click never wipes an import.
 */
export function withReadingStatus(
  profile: LocalUserProfile | null,
  novel: NovelRef,
  status: ReadingStatus | '',
  options: WriteOptions = {},
): LocalUserProfile {
  const current = startingProfile(profile, options);
  const slug = slugForNovel(novel);
  const matches = (entry: ProfileEntry) => entry.novel_id === novel.id || entry.slug === slug;
  const previous = current.entries.find(matches);
  const entries = current.entries.filter((entry) => !matches(entry));
  if (status) {
    entries.push(previous
      ? { ...previous, novel_id: novel.id, status }
      : { novel_id: novel.id, slug, imported_title: novel.title, status, source_file: 'recommendation' });
  }
  return { ...current, entries };
}

/** Sets a feedback signal, or clears it when the title already has that same signal (a toggle). */
export function withFeedback(
  profile: LocalUserProfile | null,
  novel: NovelRef,
  signal: FeedbackSignal,
  options: WriteOptions = {},
): LocalUserProfile {
  const current = startingProfile(profile, options);
  const existing = current.feedback?.find((item) => item.novel_id === novel.id)?.signal;
  const feedback = (current.feedback || []).filter((item) => item.novel_id !== novel.id);
  if (existing !== signal) {
    feedback.push({
      novel_id: novel.id,
      slug: slugForNovel(novel),
      title: novel.title,
      signal,
      updated_at: (options.now ?? (() => new Date().toISOString()))(),
    });
  }
  return { ...current, feedback };
}

export interface ProfileIndex {
  entries: Map<number, ProfileEntry>;
  feedback: Map<number, FeedbackSignal>;
}

const EMPTY_INDEX: ProfileIndex = { entries: new Map(), feedback: new Map() };
const indexCache = new WeakMap<LocalUserProfile, ProfileIndex>();

/** Lookup maps by catalog id, built once per profile object so every card can ask cheaply. */
export function indexProfile(profile: LocalUserProfile | null): ProfileIndex {
  if (!profile) return EMPTY_INDEX;
  let index = indexCache.get(profile);
  if (!index) {
    index = {
      entries: new Map(profile.entries.flatMap((entry) => (entry.novel_id == null ? [] : [[entry.novel_id, entry] as const]))),
      feedback: new Map((profile.feedback || []).map((item) => [item.novel_id, item.signal])),
    };
    indexCache.set(profile, index);
  }
  return index;
}
