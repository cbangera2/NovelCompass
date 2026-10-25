import { describe, expect, it } from 'vitest';
import { indexProfile, slugForNovel, slugFromTitle, withFeedback, withReadingStatus } from './cardActions';
import type { LocalUserProfile } from './types';

const options = { datasetVersion: 'v1', now: () => '2026-01-01T00:00:00.000Z', newProfileId: () => 'new-id' };
const novel = { id: 7, slug: 'some-novel', title: 'Some Novel' };

const profile = (overrides: Partial<LocalUserProfile> = {}): LocalUserProfile => ({
  profile_id: 'p',
  parser_version: 1,
  dataset_version: 'v0',
  imported_at: '2025-01-01T00:00:00.000Z',
  source_fingerprints: [],
  entries: [],
  curated_lists: [],
  feedback: [],
  ...overrides,
});

describe('slugs', () => {
  it('derives a NovelUpdates-style slug from a title', () => {
    expect(slugFromTitle("Lord of the Mysteries: Don't Panic!")).toBe('lord-of-the-mysteries-dont-panic');
    expect(slugFromTitle('Café  Âge')).toBe('cafe-age');
  });
  it('prefers a real slug and never returns an empty one', () => {
    expect(slugForNovel(novel)).toBe('some-novel');
    expect(slugForNovel({ id: 3, title: 'Some Title' })).toBe('some-title');
    expect(slugForNovel({ id: 3, title: '!!!' })).toBe('novel-3');
  });
});

describe('withReadingStatus', () => {
  it('starts a profile when there is none', () => {
    const next = withReadingStatus(null, novel, 'reading', options);
    expect(next.profile_id).toBe('new-id');
    expect(next.dataset_version).toBe('v1');
    expect(next.entries).toEqual([
      { novel_id: 7, slug: 'some-novel', imported_title: 'Some Novel', status: 'reading', source_file: 'recommendation' },
    ]);
  });

  it('keeps rating and progress when the status changes', () => {
    const start = profile({
      entries: [{ novel_id: 7, slug: 'some-novel', imported_title: 'Some Novel', status: 'reading', rating: 4.5, progress: 'c120', source_file: 'x.xml' }],
    });
    const next = withReadingStatus(start, novel, 'completed', options);
    expect(next.entries).toHaveLength(1);
    expect(next.entries[0]).toMatchObject({ status: 'completed', rating: 4.5, progress: 'c120', source_file: 'x.xml' });
  });

  it('adopts an imported entry that only matched by slug', () => {
    const start = profile({ entries: [{ slug: 'some-novel', imported_title: 'Some Novel', status: 'plan_to_read', source_file: 'list.html' }] });
    const next = withReadingStatus(start, novel, 'paused', options);
    expect(next.entries).toEqual([
      { novel_id: 7, slug: 'some-novel', imported_title: 'Some Novel', status: 'paused', source_file: 'list.html' },
    ]);
  });

  it('removes the entry for the empty "Add" choice and leaves others alone', () => {
    const other = { novel_id: 9, slug: 'other', imported_title: 'Other', status: 'reading' as const, source_file: 'x' };
    const start = withReadingStatus(profile({ entries: [other] }), novel, 'reading', options);
    const next = withReadingStatus(start, novel, '', options);
    expect(next.entries).toEqual([other]);
  });

  it('does not mutate its input', () => {
    const start = profile();
    withReadingStatus(start, novel, 'reading', options);
    expect(start.entries).toEqual([]);
  });
});

describe('withFeedback', () => {
  it('records a signal with the catalog title and slug', () => {
    const next = withFeedback(null, novel, 'love', options);
    expect(next.feedback).toEqual([
      { novel_id: 7, slug: 'some-novel', title: 'Some Novel', signal: 'love', updated_at: '2026-01-01T00:00:00.000Z' },
    ]);
  });

  it('toggles off when the same signal is chosen again', () => {
    const once = withFeedback(profile(), novel, 'not_for_me', options);
    expect(withFeedback(once, novel, 'not_for_me', options).feedback).toEqual([]);
  });

  it('replaces a different signal for the same title', () => {
    const once = withFeedback(profile(), novel, 'love', options);
    const next = withFeedback(once, novel, 'not_for_me', options);
    expect(next.feedback?.map((item) => item.signal)).toEqual(['not_for_me']);
  });

  it('handles profiles saved before feedback existed', () => {
    const legacy = profile();
    delete legacy.feedback;
    expect(withFeedback(legacy, novel, 'love', options).feedback).toHaveLength(1);
  });
});

describe('indexProfile', () => {
  it('maps entries and feedback by catalog id and skips unmatched entries', () => {
    const start = profile({
      entries: [
        { novel_id: 7, slug: 'a', imported_title: 'A', status: 'reading', source_file: 'x' },
        { slug: 'b', imported_title: 'B', status: 'completed', source_file: 'x' },
      ],
      feedback: [{ novel_id: 7, slug: 'a', title: 'A', signal: 'love', updated_at: 't' }],
    });
    const index = indexProfile(start);
    expect([...index.entries.keys()]).toEqual([7]);
    expect(index.feedback.get(7)).toBe('love');
    expect(indexProfile(start)).toBe(index);
  });

  it('is empty for no profile', () => {
    expect(indexProfile(null).entries.size).toBe(0);
  });
});
