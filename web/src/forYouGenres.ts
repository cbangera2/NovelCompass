/**
 * Genre / tag rows for the non-novel formats. Kept as data so the choices are easy to tune: each row
 * names a genre or a tag exactly as the catalog spells it, and the formats it has enough titles for
 * (counts checked against the static snapshot with the votes floors in ForYouPage).
 */
import type { MediaTypeChoice } from './mediaFilterState';

export type BrowseFormat = Exclude<MediaTypeChoice, 'novel'>;

export interface GenreRowDef {
  key: string;
  label: string;
  /** Exactly one of these is set. Anime and manga carry these as genres or as tags, not both. */
  genre?: string;
  tag?: string;
  formats: BrowseFormat[];
}

const BOTH: BrowseFormat[] = ['anime', 'manga'];
const ANIME: BrowseFormat[] = ['anime'];
const MANGA: BrowseFormat[] = ['manga'];

/**
 * Broadest appeal first, with the format-specific rows spread through the list so a single-format
 * page still gets some of them. NSFW genres are deliberately absent; BL / Yuri are left out too
 * until there is an opt-in.
 */
export const GENRE_ROWS: GenreRowDef[] = [
  { key: 'action', label: 'Action', genre: 'Action', formats: BOTH },
  { key: 'romance', label: 'Romance', genre: 'Romance', formats: BOTH },
  { key: 'isekai', label: 'Isekai', tag: 'Isekai', formats: BOTH },
  { key: 'yandere', label: 'Yandere', tag: 'Yandere', formats: BOTH },
  { key: 'sports', label: 'Sports', genre: 'Sports', formats: BOTH },
  { key: 'psychological', label: 'Psychological', genre: 'Psychological', formats: BOTH },
  { key: 'cute-girls', label: 'Cute Girls Doing Cute Things', tag: 'Cute Girls Doing Cute Things', formats: ANIME },
  { key: 'seinen', label: 'Seinen', tag: 'Seinen', formats: MANGA },
  { key: 'horror', label: 'Horror', genre: 'Horror', formats: BOTH },
  { key: 'slice-of-life', label: 'Slice of Life', genre: 'Slice of Life', formats: BOTH },
  { key: 'revenge', label: 'Revenge', tag: 'Revenge', formats: BOTH },
  { key: 'reincarnation', label: 'Reincarnation', tag: 'Reincarnation', formats: BOTH },
  { key: 'villainess', label: 'Villainess', tag: 'Villainess', formats: MANGA },
  { key: 'mecha', label: 'Mecha', genre: 'Mecha', formats: ANIME },
  { key: 'tragedy', label: 'Tragedy', tag: 'Tragedy', formats: BOTH },
  { key: 'time-manipulation', label: 'Time Manipulation', tag: 'Time Manipulation', formats: BOTH },
  { key: 'martial-arts', label: 'Martial Arts', tag: 'Martial Arts', formats: BOTH },
  { key: 'shoujo', label: 'Shoujo', tag: 'Shoujo', formats: MANGA },
  { key: 'sci-fi', label: 'Sci-Fi', genre: 'Sci-Fi', formats: ANIME },
  { key: 'music', label: 'Music', genre: 'Music', formats: ANIME },
  { key: 'military', label: 'Military', tag: 'Military', formats: ANIME },
  { key: 'age-gap', label: 'Age Gap', tag: 'Age Gap', formats: MANGA },
  { key: 'delinquents', label: 'Delinquents', tag: 'Delinquents', formats: MANGA },
  { key: 'royal-affairs', label: 'Royal Affairs', tag: 'Royal Affairs', formats: MANGA },
];

/** Rows below this many titles (after the votes floor) are dropped rather than shown half empty. */
export const MIN_GENRE_ROW_TITLES = 12;

/** The first `limit` rows that have enough titles in at least one of the selected non-novel formats. */
export function pickGenreRows(selected: MediaTypeChoice[], limit: number): Array<GenreRowDef & { types: BrowseFormat[] }> {
  const wanted = selected.filter((t): t is BrowseFormat => t !== 'novel');
  return GENRE_ROWS.flatMap((row) => {
    const types = row.formats.filter((f) => wanted.includes(f));
    return types.length ? [{ ...row, types }] : [];
  }).slice(0, limit);
}

export function formatNoun(types: BrowseFormat[]): string {
  return types.length > 1 ? 'anime & manga' : types[0];
}
