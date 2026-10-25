import { describe, expect, it } from 'vitest';
import {
  addTokens,
  dedupe,
  formatList,
  matchRank,
  optionLookup,
  parseList,
  parseTokens,
  rankMatches,
  removeToken,
  splitMatch,
  tokenKey,
} from './tokenInput';

const TAGS = ['Alchemy', 'Isekai', 'Reverse Isekai', 'Time Loop', 'Cunning Protagonist', 'Loop Hole', 'Dense Protagonist'];

describe('parsing', () => {
  it('splits on commas and newlines and trims', () => {
    expect(parseTokens(' time loop ,, Isekai\nHarem\r\n ')).toEqual(['time loop', 'Isekai', 'Harem']);
  });

  it('collapses inner whitespace', () => {
    expect(parseTokens('cunning   protagonist')).toEqual(['cunning protagonist']);
  });

  it('reads legacy comma strings from URLs and saved filters', () => {
    expect(parseList('cunning protagonist, time loop')).toEqual(['cunning protagonist', 'time loop']);
    expect(parseList('')).toEqual([]);
    expect(parseList(undefined)).toEqual([]);
  });

  it('de-duplicates case-insensitively, keeping the first spelling', () => {
    expect(parseList('Isekai, isekai,  ISEKAI ,Harem')).toEqual(['Isekai', 'Harem']);
    expect(dedupe(['a', 'A', 'b'])).toEqual(['a', 'b']);
  });

  it('survives a pasted list with stray, trailing and repeated commas', () => {
    expect(parseTokens(',,Isekai,, Harem,')).toEqual(['Isekai', 'Harem']);
    expect(parseTokens(' , ,\n')).toEqual([]);
  });

  it('keeps non-ASCII and quoted names intact', () => {
    expect(parseTokens('転生, 重生,"Quoted Tag"')).toEqual(['転生', '重生', '"Quoted Tag"']);
  });

  it('round-trips through the comma string the URL and data layer use', () => {
    const values = ['Time Loop', 'Isekai', '転生'];
    expect(parseList(formatList(values))).toEqual(values);
  });
});

describe('matching', () => {
  it('ranks exact, then prefix, then word prefix, then substring', () => {
    expect(matchRank('Isekai', 'isekai')).toBe(0);
    expect(matchRank('Isekai Life', 'isek')).toBe(1);
    expect(matchRank('Reverse Isekai', 'isek')).toBe(2);
    expect(matchRank('Misekai', 'isek')).toBe(3);
    expect(matchRank('Alchemy', 'isek')).toBe(-1);
  });

  it('suggests case-insensitively with prefix matches first', () => {
    expect(rankMatches(TAGS, 'ISEK', [])).toEqual(['Isekai', 'Reverse Isekai']);
    expect(rankMatches(TAGS, 'loop', [])).toEqual(['Loop Hole', 'Time Loop']);
  });

  it('keeps option order for equal ranks and returns everything for an empty query', () => {
    expect(rankMatches(TAGS, '', [])).toEqual(TAGS);
    expect(rankMatches(TAGS, 'protagonist', [])).toEqual(['Cunning Protagonist', 'Dense Protagonist']);
  });

  it('hides already selected values regardless of case', () => {
    expect(rankMatches(TAGS, 'isek', ['isekai'])).toEqual(['Reverse Isekai']);
  });

  it('honours the limit and handles no match', () => {
    expect(rankMatches(TAGS, '', [], 2)).toEqual(['Alchemy', 'Isekai']);
    expect(rankMatches(TAGS, 'zzz', [])).toEqual([]);
  });

  it('splits a label around the first match for highlighting', () => {
    expect(splitMatch('Reverse Isekai', 'isek')).toEqual(['Reverse ', 'Isek', 'ai']);
    expect(splitMatch('Reverse Isekai', '')).toEqual(['Reverse Isekai', '', '']);
    expect(splitMatch('Alchemy', 'zz')).toEqual(['Alchemy', '', '']);
  });

  it('normalises keys', () => {
    expect(tokenKey('  Time   LOOP ')).toBe('time loop');
  });
});

describe('addTokens', () => {
  const lookup = optionLookup(TAGS);

  it('uses the catalog spelling for known values', () => {
    const result = addTokens([], ['time loop', 'ISEKAI'], { lookup, allowCustom: true });
    expect(result.values).toEqual(['Time Loop', 'Isekai']);
    expect(result.added).toEqual(['Time Loop', 'Isekai']);
  });

  it('keeps unknown tags when custom values are allowed', () => {
    const result = addTokens(['Isekai'], ['Brand New Trope'], { lookup, allowCustom: true });
    expect(result.values).toEqual(['Isekai', 'Brand New Trope']);
  });

  it('rejects unknown values for closed lists such as genres', () => {
    const result = addTokens([], ['Isekai', 'Nope'], { lookup, allowCustom: false });
    expect(result.values).toEqual(['Isekai']);
    expect(result.rejected).toEqual(['Nope']);
  });

  it('never adds a duplicate, including from a pasted list', () => {
    const result = addTokens(['Isekai'], parseTokens('isekai, Alchemy, alchemy'), { lookup, allowCustom: true });
    expect(result.values).toEqual(['Isekai', 'Alchemy']);
    expect(result.added).toEqual(['Alchemy']);
  });

  it('does not mutate the input list', () => {
    const current = ['Isekai'];
    addTokens(current, ['Alchemy'], { lookup, allowCustom: true });
    expect(current).toEqual(['Isekai']);
  });

  it('removes case-insensitively', () => {
    expect(removeToken(['Isekai', 'Alchemy'], 'isekai')).toEqual(['Alchemy']);
  });
});
