import type { ActiveFilter } from './CoreFilters';
import { tokenKey } from './tokenInput';

/** Numeric limits in the order Discover and Browse show them. A page shows only the keys it supplies. */
export const NUMERIC_FILTERS = [
  { key: 'maxRating', label: 'Maximum rating', max: 5, step: 0.1 },
  { key: 'minVotes', label: 'Minimum votes' },
  { key: 'minYear', label: 'Earliest year' },
  { key: 'maxYear', label: 'Latest year' },
  { key: 'minChapters', label: 'Minimum chapters' },
  { key: 'maxChapters', label: 'Maximum chapters' },
  { key: 'minReaders', label: 'Minimum readers' },
  { key: 'maxReaders', label: 'Maximum readers' },
] as const;

export type NumericFilterKey = (typeof NUMERIC_FILTERS)[number]['key'];

export interface AdvancedFilterValues {
  includeGenres: string[];
  excludeGenres: string[];
  includeTags: string[];
  excludeTags: string[];
  maxRating?: number;
  minVotes?: number;
  minYear?: number;
  maxYear?: number;
  minChapters?: number;
  maxChapters?: number;
  minReaders?: number;
  maxReaders?: number;
}

export const EMPTY_ADVANCED_FILTERS: Required<Pick<AdvancedFilterValues, 'includeGenres' | 'excludeGenres' | 'includeTags' | 'excludeTags'>> = {
  includeGenres: [], excludeGenres: [], includeTags: [], excludeTags: [],
};

type ListKey = 'includeGenres' | 'excludeGenres' | 'includeTags' | 'excludeTags';
const OPPOSITE: Record<'includeGenres' | 'excludeGenres', 'includeGenres' | 'excludeGenres'> = {
  includeGenres: 'excludeGenres',
  excludeGenres: 'includeGenres',
};

/** Number input text to a limit: empty, invalid, infinite or negative input means "no limit" (0); `max` caps the value. */
export function parseLimit(raw: string, max?: number): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return 0;
  return max === undefined ? value : Math.min(max, value);
}

/** A genre cannot be both required and excluded: picking it on one side removes it from the other. */
export function listPatch(values: AdvancedFilterValues, key: ListKey, next: string[]): Partial<AdvancedFilterValues> {
  if (key !== 'includeGenres' && key !== 'excludeGenres') return { [key]: next };
  const taken = new Set(next.map(tokenKey));
  const otherKey = OPPOSITE[key];
  const other = values[otherKey].filter((value) => !taken.has(tokenKey(value)));
  return other.length === values[otherKey].length ? { [key]: next } : { [key]: next, [otherKey]: other };
}

/** Active-filter chips for the shared advanced filters, worded identically on every page. */
export function advancedActiveFilters(
  values: AdvancedFilterValues,
  apply: (patch: Partial<AdvancedFilterValues>) => void,
): ActiveFilter[] {
  const active: ActiveFilter[] = [];
  const list = (key: ListKey, label: string) => {
    if (values[key].length) active.push({ label: `${label}: ${values[key].join(', ')}`, clear: () => apply({ [key]: [] }) });
  };
  const num = (key: NumericFilterKey, label: (value: number) => string) => {
    const value = values[key];
    if (value && value > 0) active.push({ label: label(value), clear: () => apply({ [key]: 0 }) });
  };
  list('includeGenres', 'Genres');
  list('excludeGenres', 'Without genres');
  list('includeTags', 'Tags');
  list('excludeTags', 'Without tags');
  num('maxRating', (v) => `Rating ≤ ${v}★`);
  num('minVotes', (v) => `Votes: ${v.toLocaleString()}+`);
  num('minYear', (v) => `From ${v}`);
  num('maxYear', (v) => `Through ${v}`);
  num('minChapters', (v) => `${v.toLocaleString()}+ chapters`);
  num('maxChapters', (v) => `≤ ${v.toLocaleString()} chapters`);
  num('minReaders', (v) => `${v.toLocaleString()}+ readers`);
  num('maxReaders', (v) => `≤ ${v.toLocaleString()} readers`);
  return active;
}

/** Discover keeps genres as one state map (URL `g=+Action,-Harem`); the shared UI works in two lists. */
export function genreListsFrom(states: Record<string, 'include' | 'exclude'>): { includeGenres: string[]; excludeGenres: string[] } {
  const entries = Object.entries(states);
  return {
    includeGenres: entries.filter(([, state]) => state === 'include').map(([genre]) => genre),
    excludeGenres: entries.filter(([, state]) => state === 'exclude').map(([genre]) => genre),
  };
}

export function genreStatesFrom(include: string[], exclude: string[]): Record<string, 'include' | 'exclude'> {
  const states: Record<string, 'include' | 'exclude'> = {};
  include.forEach((genre) => { states[genre] = 'include'; });
  exclude.forEach((genre) => { if (!(genre in states)) states[genre] = 'exclude'; });
  return states;
}
