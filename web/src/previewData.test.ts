import { describe, expect, it } from 'vitest';
import {
  compactText,
  evidenceBullets,
  layerPreview,
  mergeDefined,
  previewFacts,
  previewFromBrowse,
  previewFromProfile,
  previewFromRecommendation,
  previewFromSearch,
  previewTags,
  type PreviewData,
} from './previewData';
import type { BrowseNovel, NovelSearchResult, Recommendation } from './types';

const search: NovelSearchResult = {
  id: 42, title: 'Shadow Slave', slug: 'shadow-slave', novelupdates_url: '', author: 'Guiltythree',
  rating: 4.5, rating_votes: 900, media_type: 'Web Novel',
};

describe('mergeDefined', () => {
  it('layers defined fields over the base', () => {
    expect(mergeDefined<PreviewData>({ id: 1, title: 'A', author: 'x' }, { author: 'y', year: 2020 })).toEqual({ id: 1, title: 'A', author: 'y', year: 2020 });
  });

  it('does not let an explicit undefined erase a good value', () => {
    const merged = mergeDefined<PreviewData>({ id: 1, title: 'A', synopsis: 'kept' }, { id: 1, title: 'A', synopsis: undefined });
    expect(merged.synopsis).toBe('kept');
  });

  it('keeps falsy-but-defined values and accepts an empty base', () => {
    expect(mergeDefined<PreviewData>({ id: 1, title: 'A', chapters_trans: 10 }, { chapters_trans: 0 }).chapters_trans).toBe(0);
    expect(mergeDefined<PreviewData>(undefined, { id: 2, title: 'B' })).toEqual({ id: 2, title: 'B' });
  });

  it('does not mutate its inputs', () => {
    const base: PreviewData = { id: 1, title: 'A' };
    mergeDefined(base, { title: 'B' });
    expect(base.title).toBe('A');
  });
});

describe('preview mappers', () => {
  it('maps a recommendation to match data and drops the noisy bullets', () => {
    const rec = {
      target_id: 7, title: 'T', author: 'A', language: 'English', rating: 4, rating_votes: 10, reading_list_count: 99,
      status_trans: 'Yes', chapters_trans: 120, match_score_percent: 81.6, media_type: 'Light Novel',
      channel_ranks: { tag: 12, vector: 3, bogus: 1 }, shared_tags: ['Magic'], curated_lists: [{ id: 1 }, { id: 2 }],
      evidence_bullets: ['Shared key tropes: Magic', 'Co-occurs on 3 lists', 'Loved by fans of X', 'b', 'c', 'd'],
    } as unknown as Recommendation;
    const preview = previewFromRecommendation(rec);
    expect(preview.signals).toEqual([{ label: 'Meaning', rank: 3 }, { label: 'Tags', rank: 12 }]);
    expect(preview.bullets).toEqual(['Loved by fans of X', 'b', 'c']);
    expect(preview.curatedListCount).toBe(2);
    expect(preview.sharedTags).toEqual(['Magic']);
    expect(preview).not.toHaveProperty('rating');
  });

  it('maps a search row without inventing fields', () => {
    const preview = previewFromSearch(search);
    expect(preview).toMatchObject({ id: 42, title: 'Shadow Slave', author: 'Guiltythree', media_type: 'Web Novel' });
    expect(preview.synopsis).toBeUndefined();
    expect(previewFromSearch({ ...search, author: '' }).author).toBeUndefined();
  });

  it('maps a browse row with progress and the top tags', () => {
    const item: BrowseNovel = {
      ...search, language: 'Korean', year: 2021, reading_list_count: 5000, status_trans: '', chapters_trans: 300,
      tags: Array.from({ length: 14 }, (_, i) => `tag${i}`),
    };
    const preview = previewFromBrowse(item);
    expect(preview).toMatchObject({ language: 'Korean', year: 2021, reading_list_count: 5000, chapters_trans: 300 });
    expect(preview.status_trans).toBeUndefined();
    expect(preview.tags).toHaveLength(10);
    expect(previewFromBrowse({ ...item, tags: [] }).tags).toBeUndefined();
  });

  it('maps a library entry only when it matched the catalog', () => {
    expect(previewFromProfile({ imported_title: 'Unknown' })).toBeNull();
    expect(previewFromProfile({ novel_id: 42, imported_title: 'Imported name' })).toEqual({ id: 42, title: 'Imported name' });
    expect(previewFromProfile({ novel_id: 42, imported_title: 'Imported name' }, search)).toMatchObject({ id: 42, title: 'Shadow Slave', author: 'Guiltythree' });
  });

});

describe('layerPreview', () => {
  it('accumulates stable facts but replaces the previous surface\'s context', () => {
    const discover: PreviewData = { id: 1, title: 'A', author: 'x', matchPercent: 85, signals: [{ label: 'Tags', rank: 2 }], sharedTags: ['Magic'], bullets: ['why'], curatedListCount: 2, onYourLists: ['Mine'] };
    const browse: PreviewData = { id: 1, title: 'A', year: 2020, tags: ['t'] };
    expect(layerPreview(discover, browse)).toEqual({ id: 1, title: 'A', author: 'x', year: 2020, tags: ['t'] });
  });

  it('lets the new surface\'s context win and keeps an existing synopsis', () => {
    const known: PreviewData = { id: 1, title: 'A', synopsis: 'kept', matchPercent: 85 };
    expect(layerPreview(known, { id: 1, title: 'A', matchPercent: 70, synopsis: undefined })).toMatchObject({ synopsis: 'kept', matchPercent: 70 });
  });
});

describe('evidenceBullets', () => {
  it('drops the lines that repeat the tag list and caps the rest at three', () => {
    expect(evidenceBullets(['Shared key tropes: Magic', 'Co-occurs on 3 lists', 'a', 'b', 'c', 'd'])).toEqual(['a', 'b', 'c']);
    expect(evidenceBullets(undefined)).toEqual([]);
  });
});

describe('previewTags', () => {
  it('prefers shared tags and counts them', () => {
    expect(previewTags({ id: 1, title: 'A', sharedTags: ['x', 'y'], tags: ['z'] })).toEqual({ label: 'Shared tags · 2', tags: ['x', 'y'] });
  });

  it('falls back to the top tags, or none', () => {
    expect(previewTags({ id: 1, title: 'A', sharedTags: [], tags: ['z'] })).toEqual({ label: 'Top tags', tags: ['z'] });
    expect(previewTags({ id: 1, title: 'A' }).tags).toEqual([]);
  });
});

describe('previewFacts', () => {
  it('lists only facts the surfaces do not already show, never rating', () => {
    const facts = previewFacts({ id: 42, title: 'A', reading_list_count: 12345, chapters_trans: 320, status_trans: 'No', curatedListCount: 3 });
    expect(facts.map((fact) => fact.label)).toEqual(['readers', 'chapters', 'status', 'curated lists']);
    expect(facts[0].value).toBe((12345).toLocaleString());
    expect(facts[2].value).toBe('Ongoing');
  });

  it('skips empty values and singularises one curated list', () => {
    expect(previewFacts({ id: 42, title: 'A', chapters_trans: 0 })).toEqual([]);
    expect(previewFacts({ id: 42, title: 'A', curatedListCount: 1 })[0].label).toBe('curated list');
  });
});

describe('compactText', () => {
  it('collapses whitespace and cuts on a word boundary', () => {
    expect(compactText('  one \n two   three ')).toBe('one two three');
    const cut = compactText('word '.repeat(100), 20);
    expect(cut.endsWith('…')).toBe(true);
    expect(cut.length).toBeLessThanOrEqual(21);
  });
});
