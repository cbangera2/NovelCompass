import { resolveMediaBucket } from './mediaFilterState';
import type { NovelDetail, NovelInsights } from './types';

export interface ComparisonRow {
  id: number;
  title: string;
  author?: string;
  language?: string;
  year?: number;
  cover_url?: string;
  rating: number;
  readers: number;
  sharedTags: number;
  sharedGenres: number;
  /** Position by rating within the set, this title included. */
  rank: number;
  self: boolean;
}

const NOUNS = { novel: 'novels', manga: 'manga', anime: 'anime' } as const;

/**
 * The comparison set behind the rating-and-popularity chart: this title plus its closest same-genre,
 * same-language titles, sorted by rating so you can see where it stands, with plain-language framing.
 */
export function buildComparison(insights: NovelInsights, current: NovelDetail | undefined, novelId: number) {
  const peers = insights.peers.slice(0, 10);
  if (!peers.length) return null;
  const noun = NOUNS[resolveMediaBucket(novelId, current?.media_type)];
  const rows: Array<Omit<ComparisonRow, 'rank'>> = peers.map((peer) => ({
    id: peer.id, title: peer.title, author: peer.author, language: peer.language, year: peer.year, cover_url: peer.cover_url,
    rating: peer.rating, readers: peer.reading_list_count, sharedTags: peer.shared_tag_count, sharedGenres: peer.shared_genre_count, self: false,
  }));
  if (current) {
    rows.push({
      id: current.id, title: current.title, author: current.author, language: current.language, year: current.year, cover_url: current.cover_url,
      rating: current.rating, readers: current.reading_list_count, sharedTags: 0, sharedGenres: 0, self: true,
    });
  }
  const byRating = [...rows].sort((a, b) => b.rating - a.rating || b.readers - a.readers || a.id - b.id);
  const ranked: ComparisonRow[] = byRating.map((row, index) => ({ ...row, rank: index + 1 }));
  const self = ranked.find((row) => row.self);
  const readersRank = self ? [...rows].sort((a, b) => b.readers - a.readers).findIndex((row) => row.self) + 1 : null;

  const genre = insights.cohorts.find((c) => c.dimension === 'primary_genre')?.value;
  const language = insights.cohorts.find((c) => c.dimension === 'language')?.value;
  const definition = genre && language
    ? `The ${peers.length} ${noun} that share the genre ${genre} and the language ${language} and have the most tags in common with this one, sorted by rating.`
    : insights.cohort_definition;
  const summary = self && readersRank
    ? `Among these ${ranked.length}, it is #${self.rank} for rating and #${readersRank} for reading-list count.`
    : '';
  return {
    rows: ranked,
    peerCount: peers.length,
    noun,
    definition,
    summary,
    selfRating: current?.rating ?? null,
    maxReaders: Math.max(1, ...ranked.map((row) => row.readers)),
  };
}
