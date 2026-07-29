export const FIXTURE_NAMES = [
  'series-logged-out.html',
  'series-no-reviews.html',
  'series-no-releases.html',
  'releases-pagination.html',
  'reviews-truncated.html',
  'challenge.html',
  'login.html',
  'maintenance.html',
  'unsupported-markup.html',
] as const;

export type FixtureName = (typeof FIXTURE_NAMES)[number];

/**
 * Browser/Vitest fixture helper. Supplying file text keeps Node filesystem
 * access out of production modules and makes the helper usable in browser
 * smoke tests as well.
 */
export function parseFixtureHtml(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

export function fixtureUrl(name: FixtureName): URL {
  return new URL(`tests/fixtures/${name}`, pathToFileURL(`${process.cwd()}/`));
}
import { pathToFileURL } from 'node:url';
