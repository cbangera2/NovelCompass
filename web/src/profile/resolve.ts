import { RecommendationDataSource } from '../data';
import { ParsedProfileFile, ProfileEntry } from './types';

export function applyResolvedNovelIds(
  entries: ProfileEntry[],
  resolved: Map<string, { id: number }>
): ProfileEntry[] {
  return entries.map((entry) => ({
    ...entry,
    // A missing resolution may be transient (offline API, stale static
    // snapshot, or changed title). Never destroy a previously verified key.
    novel_id: resolved.get(entry.slug.toLowerCase())?.id ?? entry.novel_id
  }));
}

export async function resolveEntries(
  files: ParsedProfileFile[],
  source: RecommendationDataSource
): Promise<ProfileEntry[]> {
  const entries = files.flatMap((file) => file.entries);
  const resolved = await source.resolveSlugs(entries.map((entry) => ({
    slug: entry.slug,
    title: entry.imported_title
  })));
  return applyResolvedNovelIds(entries, resolved);
}
