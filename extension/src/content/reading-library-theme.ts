const READING_LIBRARY_CLASS = 'novel-compass-reading-library';
const FOLLOWING_CLASS = 'novel-compass-following';
export const READING_LIBRARY_HEADER_ID = 'novel-compass-reading-library-header';

/**
 * Adds a small, route-specific frame around Novel Updates' live reading-list UI.
 *
 * The underlying table, filters, forms, hidden inputs, and event handlers remain
 * in place. This is intentionally an enhancement rather than a parser/re-render:
 * reading-list controls are authenticated and may contain short-lived action
 * tokens that must stay owned by Novel Updates.
 */
export function installReadingLibraryTheme(document: Document): void {
  installLibraryFrame(document, {
    activePath: '/reading-list/',
    pageClass: READING_LIBRARY_CLASS,
    summary:
      'Your live Novel Updates reading list. Filters, chapter links, list changes, and progress controls still use Novel Updates directly.',
    title: 'My Library',
  });
}

/**
 * Frames Novel Updates' authenticated Following page without copying or
 * replacing its follow and unfollow controls.
 */
export function installFollowingTheme(document: Document): void {
  installLibraryFrame(document, {
    activePath: '/following/',
    pageClass: FOLLOWING_CLASS,
    summary:
      'Lists and people you follow on Novel Updates. Follow controls remain connected directly to your Novel Updates account.',
    title: 'Following',
  });
}

interface LibraryFrameOptions {
  activePath: '/following/' | '/reading-list/';
  pageClass: string;
  summary: string;
  title: string;
}

function installLibraryFrame(document: Document, options: LibraryFrameOptions): void {
  if (!document.body || document.getElementById(READING_LIBRARY_HEADER_ID)) return;

  document.documentElement.classList.add(options.pageClass);

  const header = document.createElement('section');
  header.id = READING_LIBRARY_HEADER_ID;
  header.setAttribute('aria-labelledby', 'novel-compass-reading-library-title');

  const eyebrow = document.createElement('p');
  eyebrow.className = 'novel-compass-library-eyebrow';
  eyebrow.textContent = 'Novel Compass';

  const title = document.createElement('h1');
  title.id = 'novel-compass-reading-library-title';
  title.textContent = options.title;

  const summary = document.createElement('p');
  summary.className = 'novel-compass-library-summary';
  summary.textContent = options.summary;

  const navigation = document.createElement('nav');
  navigation.setAttribute('aria-label', 'Library navigation');
  const links = [
    ['Discover', '/series-finder/'],
    ['Rankings', '/series-ranking/'],
    ['Reading list', '/reading-list/'],
    ['Following', '/following/'],
    ['Profile', '/your-profile/'],
  ] as const;
  for (const [label, href] of links) {
    const link = document.createElement('a');
    link.href = href;
    link.textContent = label;
    if (href === options.activePath) link.setAttribute('aria-current', 'page');
    navigation.append(link);
  }

  header.append(eyebrow, title, summary, navigation);
  const content =
    document.querySelector<HTMLElement>('.l-main, .l-submain, main, #page-content') ??
    document.body.firstElementChild;
  if (content) content.before(header);
  else document.body.prepend(header);
}
