import { describe, expect, it } from 'vitest';
import { contrastFacets } from './taste';

const facets = (rows: Record<string, number>) =>
  new Map(Object.entries(rows).map(([name, count]) => [name, { weight: count * 4, count }]));
const names = (list: Array<{ name: string }>) => list.map((f) => f.name);

describe('contrastFacets', () => {
  it('keeps a facet on the side it leans toward, never both', () => {
    // 12 liked vs 51 avoided: Action is in 75% of liked and 45% of avoided titles.
    const { liked, avoid } = contrastFacets(
      facets({ Action: 9, Romance: 6, 'Slice of Life': 1 }), 12,
      facets({ Action: 23, Romance: 4, 'Slice of Life': 20 }), 51,
      8
    );
    expect(names(liked)).toEqual(expect.arrayContaining(['Action', 'Romance']));
    expect(names(avoid)).toEqual(['Slice of Life']);
    expect(names(liked).filter((n) => names(avoid).includes(n))).toEqual([]);
  });

  it('drops facets that both sides carry about equally', () => {
    const { liked, avoid } = contrastFacets(
      facets({ 'Male Protagonist': 6, Tragedy: 5 }), 12,
      facets({ 'Male Protagonist': 26, Tragedy: 3 }), 52,
      8
    );
    expect(names(liked)).toEqual(['Tragedy']);
    expect(names(avoid)).toEqual([]);
  });

  it('falls back to the strongest facets when one side is empty', () => {
    const { liked, avoid } = contrastFacets(facets({ Action: 5, Romance: 2 }), 6, new Map(), 0, 8);
    expect(names(liked)).toEqual(['Action', 'Romance']);
    expect(avoid).toEqual([]);
  });

  it('respects the limit', () => {
    const many = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`t${i}`, 10]));
    expect(contrastFacets(facets(many), 12, new Map(), 0, 5).liked).toHaveLength(5);
  });
});
