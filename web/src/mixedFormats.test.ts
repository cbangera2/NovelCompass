import { describe, expect, it } from 'vitest';
import { hasMixedFormats } from './novelLinks';

describe('hasMixedFormats', () => {
  it('is false for an empty set and for a single format', () => {
    expect(hasMixedFormats([])).toBe(false);
    expect(hasMixedFormats([{ id: 1, media_type: 'novel' }, { id: 2, media_type: 'novel' }])).toBe(false);
  });

  it('is true when novel, manga or anime appear together', () => {
    expect(hasMixedFormats([{ id: 1, media_type: 'novel' }, { id: 2, media_type: 'manhwa' }])).toBe(true);
    expect(hasMixedFormats([{ id: 2_000_001, media_type: 'manga' }, { id: 3_000_001, media_type: 'anime' }])).toBe(true);
  });

  it('treats light novels and web novels as one format', () => {
    expect(hasMixedFormats([{ id: 1, media_type: 'light_novel' }, { id: 2, media_type: 'web_novel' }])).toBe(false);
  });

  it('infers the format from the id range when media_type is missing', () => {
    expect(hasMixedFormats([{ id: 10 }, { id: 2_000_005 }])).toBe(true);
    expect(hasMixedFormats([{ id: 10 }, { id: 11, media_type: 'unknown-type' }])).toBe(false);
  });
});
