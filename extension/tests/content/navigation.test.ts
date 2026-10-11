import { describe, expect, it } from 'vitest';

import { resolveNovelUpdatesNavigation } from '../../src/content/navigation';

const baseUrl = 'https://www.novelupdates.com/series/fixture/';

describe('resolveNovelUpdatesNavigation', () => {
  it.each([
    ['/series/another-fixture/', 'https://www.novelupdates.com/series/another-fixture/'],
    ['https://www.novelupdates.com/extnu/100/', 'https://www.novelupdates.com/extnu/100/'],
  ])('resolves trusted Novel Updates navigation', (input, expected) => {
    expect(resolveNovelUpdatesNavigation(input, baseUrl)).toBe(expected);
  });

  it.each([
    'http://www.novelupdates.com/series/insecure/',
    'https://novelupdates.com/series/wrong-host/',
    'https://evil.test/series/fixture/',
    'javascript:alert(1)',
    'not a URL',
  ])('fails closed for untrusted navigation: %s', (input) => {
    expect(resolveNovelUpdatesNavigation(input, baseUrl)).toBeUndefined();
  });
});
