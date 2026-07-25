import { RecommendationDataSource } from '../data';
import { ParsedProfileFile, ProfileEntry } from './types';

export async function resolveEntries(
  files: ParsedProfileFile[],
  source: RecommendationDataSource
): Promise<ProfileEntry[]> {
  const entries = files.flatMap((file) => file.entries);
  const resolved = await source.resolveSlugs(entries.map((entry) => ({
    slug: entry.slug,
    title: entry.imported_title
  })));
  return entries.map((entry) => ({ ...entry, novel_id: resolved.get(entry.slug)?.id }));
}
