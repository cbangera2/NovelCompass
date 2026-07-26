/**
 * Shared stats helpers for local profiles.
 * Works for NovelUpdates HTML imports, AniList GDPR imports, and mixed libraries.
 * Optional metadata is derived when missing so older profiles stay valid.
 */
import type { NovelDetail } from '../types';
import type { LocalUserProfile, ProfileEntry, ProfileMediaKind, ReadingStatus } from './types';

export type StatsScope = 'all' | ProfileMediaKind;

export const STATUS_ORDER: ReadingStatus[] = [
  'reading',
  'completed',
  'plan_to_read',
  'paused',
  'dropped',
];

export const STATUS_LABELS: Record<ReadingStatus, string> = {
  reading: 'Reading',
  completed: 'Completed',
  plan_to_read: 'Plan to read',
  paused: 'Paused',
  dropped: 'Dropped',
};

export function inferMediaKind(entry: ProfileEntry, detail?: NovelDetail | null): ProfileMediaKind {
  if (entry.media_kind) return entry.media_kind;
  if (detail?.media_type === 'anime') return 'anime';
  if (detail && ['manga', 'manhwa', 'manhua', 'comic'].includes(detail.media_type || '')) return 'manga';
  if (detail && ['novel', 'light_novel', 'web_novel', 'ln'].includes((detail.media_type || '').toLowerCase())) {
    return 'novel';
  }
  if (/^anilist-anime-\d+/i.test(entry.slug) || (entry.novel_id != null && entry.novel_id >= 3_000_000)) {
    return 'anime';
  }
  if (/^anilist-\d+/i.test(entry.slug) || (entry.novel_id != null && entry.novel_id >= 2_000_000)) {
    return 'manga';
  }
  return 'novel';
}

export function progressUnits(entry: ProfileEntry): number {
  if (entry.progress_units != null && Number.isFinite(entry.progress_units)) {
    return Math.max(0, entry.progress_units);
  }
  if (!entry.progress) return 0;
  const match = entry.progress.match(/(\d+(?:\.\d+)?)/);
  return match ? Number(match[1]) : 0;
}

export function mean(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const avg = mean(values);
  const variance = values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

export function filterEntriesByScope(
  entries: ProfileEntry[],
  scope: StatsScope,
  detailById: Map<number, NovelDetail> = new Map()
): ProfileEntry[] {
  if (scope === 'all') return entries;
  return entries.filter((entry) => {
    const detail = entry.novel_id != null ? detailById.get(entry.novel_id) : undefined;
    return inferMediaKind(entry, detail) === scope;
  });
}

export function countByStatus(entries: ProfileEntry[]): Array<{ status: ReadingStatus; label: string; count: number }> {
  const counts: Record<ReadingStatus, number> = {
    reading: 0,
    completed: 0,
    plan_to_read: 0,
    paused: 0,
    dropped: 0,
  };
  entries.forEach((entry) => {
    counts[entry.status] = (counts[entry.status] || 0) + 1;
  });
  return STATUS_ORDER.map((status) => ({
    status,
    label: STATUS_LABELS[status],
    count: counts[status],
  }));
}

/** Personal score histogram on the shared 1–5 scale (works for NU and AniList). */
export function scoreDistribution(entries: ProfileEntry[]): Array<{ score: string; count: number; value: number }> {
  const buckets = [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5];
  const counts = new Map(buckets.map((bucket) => [bucket, 0]));
  entries.forEach((entry) => {
    if (entry.rating == null || !Number.isFinite(entry.rating)) return;
    const rounded = Math.round(entry.rating * 2) / 2;
    const key = Math.min(5, Math.max(1, rounded));
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  return buckets.map((value) => ({
    value,
    score: value % 1 === 0 ? `${value}` : `${value}`,
    count: counts.get(value) || 0,
  }));
}

export function mediaKindBreakdown(
  entries: ProfileEntry[],
  detailById: Map<number, NovelDetail>
): Array<{ kind: ProfileMediaKind; label: string; count: number }> {
  const counts: Record<ProfileMediaKind, number> = { novel: 0, manga: 0, anime: 0 };
  entries.forEach((entry) => {
    const detail = entry.novel_id != null ? detailById.get(entry.novel_id) : undefined;
    counts[inferMediaKind(entry, detail)] += 1;
  });
  const rows: Array<{ kind: ProfileMediaKind; label: string; count: number }> = [
    { kind: 'novel', label: 'Novels', count: counts.novel },
    { kind: 'manga', label: 'Manga', count: counts.manga },
    { kind: 'anime', label: 'Anime', count: counts.anime },
  ];
  return rows.filter((row) => row.count > 0);
}

/** Group start dates by month for activity area charts. */
export function activityByMonth(entries: ProfileEntry[]): Array<{ month: string; started: number; finished: number }> {
  const months = new Map<string, { started: number; finished: number }>();
  const bump = (iso: string | undefined, key: 'started' | 'finished') => {
    if (!iso || iso.length < 7) return;
    const month = iso.slice(0, 7);
    const row = months.get(month) || { started: 0, finished: 0 };
    row[key] += 1;
    months.set(month, row);
  };
  entries.forEach((entry) => {
    bump(entry.started_on, 'started');
    bump(entry.finished_on, 'finished');
  });
  return [...months.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, row]) => ({ month, ...row }));
}

export function releaseYearDistribution(
  details: NovelDetail[]
): Array<{ year: string; count: number }> {
  const counts = new Map<number, number>();
  details.forEach((detail) => {
    if (!detail.year || detail.year < 1950) return;
    counts.set(detail.year, (counts.get(detail.year) || 0) + 1);
  });
  return [...counts.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([year, count]) => ({ year: String(year), count }));
}

export function genreBreakdown(
  entries: ProfileEntry[],
  detailById: Map<number, NovelDetail>,
  limit = 12
): Array<{ genre: string; count: number; meanScore: number }> {
  const stats = new Map<string, { count: number; scores: number[] }>();
  entries.forEach((entry) => {
    if (entry.novel_id == null) return;
    const detail = detailById.get(entry.novel_id);
    if (!detail?.genres?.length) return;
    detail.genres.forEach((genre) => {
      const row = stats.get(genre) || { count: 0, scores: [] };
      row.count += 1;
      if (entry.rating != null) row.scores.push(entry.rating);
      stats.set(genre, row);
    });
  });
  return [...stats.entries()]
    .map(([genre, row]) => ({
      genre,
      count: row.count,
      meanScore: row.scores.length ? Math.round(mean(row.scores) * 10) / 10 : 0,
    }))
    .sort((a, b) => b.count - a.count || b.meanScore - a.meanScore)
    .slice(0, limit);
}

export function languageBreakdown(details: NovelDetail[]): Array<{ language: string; count: number }> {
  const counts = new Map<string, number>();
  details.forEach((detail) => {
    const language = detail.language?.trim() || 'Unknown';
    counts.set(language, (counts.get(language) || 0) + 1);
  });
  return [...counts.entries()]
    .map(([language, count]) => ({ language, count }))
    .sort((a, b) => b.count - a.count);
}

export interface OverviewKpis {
  total: number;
  rated: number;
  meanScore: number;
  stdScore: number;
  completed: number;
  completionRate: number;
  progressTotal: number;
  matched: number;
}

export function overviewKpis(entries: ProfileEntry[]): OverviewKpis {
  const scores = entries.flatMap((entry) => (entry.rating != null ? [entry.rating] : []));
  const completed = entries.filter((entry) => entry.status === 'completed').length;
  return {
    total: entries.length,
    rated: scores.length,
    meanScore: scores.length ? Math.round(mean(scores) * 100) / 100 : 0,
    stdScore: scores.length ? Math.round(stdDev(scores) * 100) / 100 : 0,
    completed,
    completionRate: entries.length ? Math.round((completed / entries.length) * 1000) / 10 : 0,
    progressTotal: entries.reduce((sum, entry) => sum + progressUnits(entry), 0),
    matched: entries.filter((entry) => entry.novel_id != null).length,
  };
}

export function profileHasDates(profile: LocalUserProfile): boolean {
  return profile.entries.some((entry) => entry.started_on || entry.finished_on);
}
