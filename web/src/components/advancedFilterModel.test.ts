import { describe, expect, it } from 'vitest';
import { advancedActiveFilters, genreListsFrom, genreStatesFrom, listPatch, parseLimit, type AdvancedFilterValues } from './advancedFilterModel';
import { discoverSearchParams, parseDiscoverRoute, DISCOVER_DEFAULTS } from '../routeState';
import { parseList } from './tokenInput';

const base: AdvancedFilterValues = { includeGenres: [], excludeGenres: [], includeTags: [], excludeTags: [] };

describe('listPatch', () => {
  it('moves a genre from the opposite list when it is picked', () => {
    const values = { ...base, excludeGenres: ['Harem', 'Ecchi'] };
    expect(listPatch(values, 'includeGenres', ['harem'])).toEqual({ includeGenres: ['harem'], excludeGenres: ['Ecchi'] });
  });

  it('leaves the other list alone when nothing overlaps, and never touches tags', () => {
    expect(listPatch({ ...base, excludeGenres: ['Harem'] }, 'includeGenres', ['Action'])).toEqual({ includeGenres: ['Action'] });
    expect(listPatch({ ...base, excludeTags: ['x'] }, 'includeTags', ['x'])).toEqual({ includeTags: ['x'] });
  });
});

describe('parseLimit', () => {
  it('treats empty, invalid, infinite and negative input as no limit', () => {
    expect(['', 'abc', '-5', '0', '1e999'].map((raw) => parseLimit(raw))).toEqual([0, 0, 0, 0, 0]);
  });

  it('keeps valid values and caps them at the field maximum', () => {
    expect(parseLimit('2010')).toBe(2010);
    expect(parseLimit('4.5', 5)).toBe(4.5);
    expect(parseLimit('9', 5)).toBe(5);
  });
});

describe('Discover genre state mapping', () => {
  it('round-trips between the state map and the two lists', () => {
    const states = { Action: 'include', Harem: 'exclude' } as const;
    const lists = genreListsFrom(states);
    expect(lists).toEqual({ includeGenres: ['Action'], excludeGenres: ['Harem'] });
    expect(genreStatesFrom(lists.includeGenres, lists.excludeGenres)).toEqual(states);
  });

  it('lets include win if a genre is somehow in both lists', () => {
    expect(genreStatesFrom(['A'], ['A'])).toEqual({ A: 'include' });
  });
});

describe('advancedActiveFilters', () => {
  it('words chips the same way for every page and only lists active values', () => {
    const applied: Array<Partial<AdvancedFilterValues>> = [];
    const chips = advancedActiveFilters(
      { includeGenres: ['Fantasy', 'Action'], excludeGenres: [], includeTags: ['Time Loop'], excludeTags: ['Netorare'], minVotes: 100, minYear: 2010, maxYear: 0, maxReaders: 2000 },
      (patch) => applied.push(patch),
    );
    expect(chips.map((chip) => chip.label)).toEqual([
      'Genres: Fantasy, Action', 'Tags: Time Loop', 'Without tags: Netorare', 'Votes: 100+', 'From 2010', '≤ 2,000 readers',
    ]);
    chips[0].clear();
    chips[3].clear();
    expect(applied).toEqual([{ includeGenres: [] }, { minVotes: 0 }]);
  });
});

describe('Discover URL compatibility', () => {
  it('reads legacy free-text tag params into the same list the chips show', () => {
    const route = parseDiscoverRoute(new URLSearchParams('ti=cunning protagonist, time loop&tx=netorare&g=%2BAction,-Harem'), DISCOVER_DEFAULTS);
    expect(parseList(route.includeTagsText)).toEqual(['cunning protagonist', 'time loop']);
    expect(route.genreStates).toEqual({ Action: 'include', Harem: 'exclude' });
  });

  it('ignores malformed or negative numeric params instead of filtering on them', () => {
    const route = parseDiscoverRoute(new URLSearchParams('mc=-5&v=abc&y0=2010&y1=-1'), DISCOVER_DEFAULTS);
    expect(route).toMatchObject({ minChapters: 0, minRatingVotes: 0, minYear: 2010, maxYear: 0 });
  });

  it('keeps every existing param and adds minimum chapters', () => {
    const route = parseDiscoverRoute(new URLSearchParams('mc=100&v=50&y0=2010&mr=2000'), DISCOVER_DEFAULTS);
    expect(route).toMatchObject({ minChapters: 100, minRatingVotes: 50, minYear: 2010, maxReaders: 2000 });
    const params = discoverSearchParams({ ...route, includeTagsText: 'a,b' });
    expect(params.get('mc')).toBe('100');
    expect(params.get('ti')).toBe('a,b');
    expect(params.get('v')).toBe('50');
  });
});
