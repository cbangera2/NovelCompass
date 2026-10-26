import { describe, expect, it } from 'vitest';
import { activityByMonth, formatSummaries, releaseYearDistribution, scoreDistribution } from './profileStats';
import type { NovelDetail } from '../types';
import type { ProfileEntry } from './types';

const entry = (overrides: Partial<ProfileEntry> = {}): ProfileEntry => ({
  slug: 'a',
  imported_title: 'A',
  status: 'completed',
  source_file: 'f',
  ...overrides,
});

describe('formatSummaries', () => {
  it('reports the mean score on the shared 1–5 scale', () => {
    const [summary] = formatSummaries([entry({ rating: 4 }), entry({ rating: 5 }), entry({ rating: 4.5 }), entry({})]);
    expect(summary.meanScore).toBe(4.5);
  });
  it('has no mean score when nothing is rated', () => {
    expect(formatSummaries([entry()])[0].meanScore).toBeNull();
  });
});

describe('scoreDistribution', () => {
  it('uses whole-star buckets when no half stars are used', () => {
    const rows = scoreDistribution([entry({ rating: 4 }), entry({ rating: 4 }), entry({ rating: 5 })]);
    expect(rows.map((row) => row.value)).toEqual([1, 2, 3, 4, 5]);
    expect(rows.find((row) => row.value === 4)?.count).toBe(2);
  });
  it('adds half-star buckets once one is used, and clamps out-of-range scores', () => {
    const rows = scoreDistribution([entry({ rating: 3.5 }), entry({ rating: 9 }), entry({ rating: 0.2 })]);
    expect(rows).toHaveLength(9);
    expect(rows.find((row) => row.value === 3.5)?.count).toBe(1);
    expect(rows.find((row) => row.value === 5)?.count).toBe(1);
    expect(rows.find((row) => row.value === 1)?.count).toBe(1);
  });
});

describe('time axes', () => {
  it('fills empty months between the first and last activity', () => {
    const rows = activityByMonth([
      entry({ started_on: '2023-11-05', finished_on: '2024-02-01' }),
      entry({ started_on: '2023-12-20' }),
    ]);
    expect(rows.map((row) => row.month)).toEqual(['2023-11', '2023-12', '2024-01', '2024-02']);
    expect(rows[1]).toEqual({ month: '2023-12', started: 1, finished: 0 });
    expect(rows[2]).toEqual({ month: '2024-01', started: 0, finished: 0 });
  });
  it('fills empty release years and ignores missing or pre-1950 years', () => {
    const detail = (year?: number) => ({ year }) as NovelDetail;
    expect(releaseYearDistribution([detail(2020), detail(2020), detail(2023), detail(1900), detail()])).toEqual([
      { year: '2020', count: 2 },
      { year: '2021', count: 0 },
      { year: '2022', count: 0 },
      { year: '2023', count: 1 },
    ]);
    expect(releaseYearDistribution([])).toEqual([]);
  });
});
