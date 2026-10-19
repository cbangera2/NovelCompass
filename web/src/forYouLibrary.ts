/**
 * Seeds for the library-powered For You rows. Pure so it can be unit-checked:
 * plan-to-read never seeds; dropped / paused / low-rated titles only feed avoid tags.
 */
import type { LocalUserProfile, ProfileEntry } from './profile/types';

export const MAX_SEEDS = 20; // POST /api/recommend/for-you accepts at most 20 seeds
const MAX_NEGATIVES = 15; // detail fetches for avoid tags

export interface LibrarySeed {
  id: number;
  title: string;
  weight: number;
}

export interface LibraryPlan {
  rated: LibrarySeed[];
  finished: LibrarySeed[];
  negativeIds: number[];
}

const isNegative = (e: ProfileEntry) =>
  e.status === 'dropped' || e.status === 'paused' || (e.rating != null && e.rating <= 2.5);

/** Rating 5 -> 2.0, 4 -> 1.5, unrated completed -> 1.0; finishing a title adds a little more. */
function seedWeight(e: ProfileEntry): number {
  const base = e.rating != null ? 1 + (e.rating - 3) * 0.5 : 1;
  return Math.round((base + (e.status === 'completed' ? 0.25 : 0)) * 100) / 100;
}

const toSeed = (e: ProfileEntry): LibrarySeed => ({ id: e.novel_id!, title: e.imported_title, weight: seedWeight(e) });
const byStrength = (a: ProfileEntry, b: ProfileEntry) =>
  seedWeight(b) - seedWeight(a) || a.imported_title.localeCompare(b.imported_title);

export function planLibraryRows(profile: LocalUserProfile | null): LibraryPlan {
  const matched = (profile?.entries ?? []).filter((e) => e.novel_id != null);
  const positive = matched.filter((e) => !isNegative(e) && e.status !== 'plan_to_read');
  const ratedEntries = positive
    .filter((e) => e.rating != null && (e.rating >= 4.5 || (e.rating >= 4 && e.status === 'completed')))
    .sort(byStrength)
    .slice(0, MAX_SEEDS);
  const ratedIds = new Set(ratedEntries.map((e) => e.novel_id));
  const completed = positive.filter((e) => e.status === 'completed').sort(byStrength);
  // Prefer titles the rated row didn't use; fall back to all of them if that leaves too few.
  const fresh = completed.filter((e) => !ratedIds.has(e.novel_id));
  const finishedEntries = (fresh.length >= 3 ? fresh : completed).slice(0, MAX_SEEDS);
  const negativeIds = matched
    .filter(isNegative)
    .sort((a, b) => (a.rating ?? 2.5) - (b.rating ?? 2.5))
    .slice(0, MAX_NEGATIVES)
    .map((e) => e.novel_id!);
  return { rated: ratedEntries.map(toSeed), finished: finishedEntries.map(toSeed), negativeIds };
}
