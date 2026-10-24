import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SOURCES,
  getSelectedSources,
  matchesSourceParam,
  resolveSource,
  sourceInScope,
  sourcesQueryParam,
} from './sourceFilterState';

describe('source filter', () => {
  it('leaves Novel Phoenix off by default', () => {
    expect(DEFAULT_SOURCES).toEqual(['novelupdates', 'anilist']);
    expect(getSelectedSources()).toEqual(['novelupdates', 'anilist']);
    expect(sourcesQueryParam()).toBe('novelupdates,anilist');
  });

  it('sends no filter when every source is on', () => {
    expect(sourcesQueryParam(['novelupdates', 'anilist', 'novelphoenix'])).toBe('');
  });

  it('infers the source from the id range for rows without a source column', () => {
    expect(resolveSource(44639)).toBe('novelupdates');
    expect(resolveSource(1_002_196)).toBe('novelphoenix');
    expect(resolveSource(3_000_001)).toBe('anilist');
    expect(resolveSource(5, 'AniList')).toBe('anilist');
  });

  it('checks a title against the enabled sources', () => {
    const sources = DEFAULT_SOURCES;
    expect(sourceInScope(44639, 'novelupdates', sources)).toBe(true);
    expect(sourceInScope(3_000_001, 'anilist', sources)).toBe(true);
    expect(sourceInScope(1_002_196, 'novelphoenix', sources)).toBe(false);
    expect(sourceInScope(1_002_196, undefined, sources)).toBe(false);
    expect(sourceInScope(1_002_196, 'novelphoenix', ['novelupdates', 'anilist', 'novelphoenix'])).toBe(true);
  });

  it('matches comma-separated source params like the API does', () => {
    expect(matchesSourceParam(1_002_196, 'novelphoenix', undefined)).toBe(true);
    expect(matchesSourceParam(1_002_196, 'novelphoenix', 'all')).toBe(true);
    expect(matchesSourceParam(1_002_196, 'novelphoenix', 'novelupdates,anilist')).toBe(false);
    expect(matchesSourceParam(1_002_196, 'novelphoenix', 'novelphoenix')).toBe(true);
    expect(matchesSourceParam(44639, undefined, 'novelupdates, anilist')).toBe(true);
  });
});
