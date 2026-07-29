import type {
  LinkedLabel,
  LiveCatalogPage,
  LiveCatalogRow,
  ParseWarning,
} from './contracts';

const TRUSTED_ORIGIN = 'https://www.novelupdates.com';
const SERIES_PATH = /^\/series\/[a-z0-9]+(?:-[a-z0-9]+)*\/?$/;
const TAXONOMY_PATH =
  /^\/(?:genre|stag|language|ntype|nauthor|nartist|opublisher|epublisher|group)\/[^/]+\/?$/;
const CATALOG_PATH = /^\/(?:novelslisting|latest-series|page\/\d+)\/?$/;

export interface CatalogParseResult {
  ok: boolean;
  page: LiveCatalogPage;
  message?: string;
}

export function parseCatalogPage(document: Document, currentUrl: string): CatalogParseResult {
  const warnings: ParseWarning[] = [];
  const rows = parseRows(document, currentUrl);
  const pagination = parsePagination(document, currentUrl);
  const title =
    cleanText(
      document.querySelector(
        'h1, .genre-title, .search_title, .l-title, [data-catalog-heading]',
      )?.textContent,
    ) || fallbackTitle(new URL(currentUrl).pathname);
  const subtitle =
    cleanText(
      document.querySelector(
        '.genre-description, .taxonomy-description, [data-catalog-description]',
      )?.textContent,
    ) || undefined;

  if (!rows.length) {
    warnings.push({
      code: 'unsupported-markup',
      field: 'rows',
      message: 'No catalog novels were found in the loaded page.',
    });
  }

  return {
    ok: rows.length > 0,
    page: { title, ...(subtitle ? { subtitle } : {}), rows, warnings, ...pagination },
    ...(!rows.length ? { message: 'Novel Updates catalog markup is not supported.' } : {}),
  };
}

function parseRows(document: Document, currentUrl: string): LiveCatalogRow[] {
  const explicit = Array.from(
    document.querySelectorAll<HTMLElement>(
      '.search_main_box_nu, .search_main_box, .novel-item, [data-catalog-row]',
    ),
  );
  const candidates = explicit.length
    ? explicit
    : uniqueElements(
        Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href*="/series/"]'))
          .map((anchor) =>
            anchor.closest<HTMLElement>('article, li, tr, .row, .search_main_box_nu, div'),
          )
          .filter((element): element is HTMLElement => Boolean(element)),
      );

  return candidates.flatMap((element) => {
    const anchor = Array.from(element.querySelectorAll<HTMLAnchorElement>('a[href]')).find(
      (candidate) => {
        const url = trustedUrl(candidate.getAttribute('href'), currentUrl);
        return Boolean(url && SERIES_PATH.test(url.pathname));
      },
    );
    const url = trustedUrl(anchor?.getAttribute('href'), currentUrl);
    const title = cleanText(
      element.querySelector('[data-series-title], .search_title a, .novel-title a')?.textContent ??
        anchor?.textContent,
    );
    if (!url || !title) return [];

    const text = cleanText(element.textContent);
    const image = element.querySelector<HTMLImageElement>('img[src]');
    const coverUrl = trustedAssetUrl(image?.getAttribute('src'), currentUrl);
    const description =
      cleanDescription(
        element.querySelector(
          '.search_body_nu, .novel-description, .series-synopsis, [data-description]',
        )?.textContent,
      ) || undefined;
    const language =
      cleanText(element.querySelector('[data-language], .search_stats span')?.textContent).match(
        /\b(Chinese|Japanese|Korean|Thai|Vietnamese|Filipino|Indonesian|Khmer|Malaysian)\b/i,
      )?.[1] ??
      text.match(
        /\b(Chinese|Japanese|Korean|Thai|Vietnamese|Filipino|Indonesian|Khmer|Malaysian)\b/i,
      )?.[1];
    const ratingText =
      element.getAttribute('data-rating') ?? text.match(/\bRating\s*:?\s*(\d(?:\.\d+)?)/i)?.[1];
    const rating = ratingText ? Number.parseFloat(ratingText) : undefined;
    const latestChapter = parseLatestChapter(element, currentUrl);

    return [
      {
        title,
        seriesUrl: url.href,
        ...(coverUrl ? { coverUrl } : {}),
        ...(description ? { description } : {}),
        ...(language ? { language } : {}),
        ...(Number.isFinite(rating) ? { rating } : {}),
        ...(latestChapter ? { latestChapter } : {}),
        genres: parseLinkedLabels(element, currentUrl),
      },
    ];
  });
}

function parseLatestChapter(element: HTMLElement, currentUrl: string): LinkedLabel | undefined {
  const anchor = Array.from(element.querySelectorAll<HTMLAnchorElement>('a[href]')).find(
    (candidate) =>
      /(?:chapter|volume|prologue|epilogue)\b/i.test(cleanText(candidate.textContent)) &&
      !SERIES_PATH.test(trustedUrl(candidate.getAttribute('href'), currentUrl)?.pathname ?? ''),
  );
  const label = cleanText(anchor?.textContent);
  if (!label) return undefined;
  const url = trustedUrl(anchor?.getAttribute('href'), currentUrl);
  return { label, ...(url ? { url: url.href } : {}) };
}

function parseLinkedLabels(element: HTMLElement, currentUrl: string): LinkedLabel[] {
  const seen = new Set<string>();
  return Array.from(element.querySelectorAll<HTMLAnchorElement>('a[href]')).flatMap((anchor) => {
    const url = trustedUrl(anchor.getAttribute('href'), currentUrl);
    const label = cleanText(anchor.textContent);
    if (!url || !TAXONOMY_PATH.test(url.pathname) || !label || seen.has(url.href)) return [];
    seen.add(url.href);
    return [{ label, url: url.href }];
  });
}

function parsePagination(
  document: Document,
  currentUrl: string,
): Pick<LiveCatalogPage, 'currentPage' | 'pageLinks' | 'previousUrl' | 'nextUrl'> {
  const current = new URL(currentUrl);
  const currentPage =
    Number.parseInt(current.searchParams.get('pg') ?? '', 10) ||
    Number.parseInt(current.pathname.match(/^\/page\/(\d+)\/?$/)?.[1] ?? '', 10) ||
    Number.parseInt(
      cleanText(document.querySelector('.current, [aria-current="page"]')?.textContent),
      10,
    ) ||
    1;
  const links = Array.from(
    document.querySelectorAll<HTMLAnchorElement>(
      '.pagination a[href], .page_navi a[href], .wp-pagenavi a[href], [data-pagination] a[href]',
    ),
  );
  const pageLinks = new Map<number, string>();
  let previousUrl: string | undefined;
  let nextUrl: string | undefined;
  for (const link of links) {
    const url = trustedUrl(link.getAttribute('href'), currentUrl);
    if (!url || (!CATALOG_PATH.test(url.pathname) && !TAXONOMY_PATH.test(url.pathname))) continue;
    const label = cleanText(link.textContent);
    const page =
      Number.parseInt(label, 10) ||
      Number.parseInt(url.searchParams.get('pg') ?? '', 10) ||
      Number.parseInt(url.pathname.match(/^\/page\/(\d+)\/?$/)?.[1] ?? '', 10);
    if (page > 0) pageLinks.set(page, url.href);
    if (/prev|previous|‹|«/i.test(label) || link.rel === 'prev') previousUrl = url.href;
    if (/next|›|»/i.test(label) || link.rel === 'next') nextUrl = url.href;
  }
  if (!pageLinks.has(currentPage)) pageLinks.set(currentPage, current.href);
  return {
    currentPage,
    pageLinks: [...pageLinks].sort(([a], [b]) => a - b).map(([page, url]) => ({ page, url })),
    ...(previousUrl ? { previousUrl } : {}),
    ...(nextUrl ? { nextUrl } : {}),
  };
}

function trustedUrl(value: string | null | undefined, base: string): URL | undefined {
  if (!value) return undefined;
  try {
    const parsed = new URL(value, base);
    return parsed.origin === TRUSTED_ORIGIN && parsed.protocol === 'https:' ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function trustedAssetUrl(value: string | null | undefined, base: string): string | undefined {
  if (!value) return undefined;
  try {
    const parsed = new URL(value, base);
    return parsed.protocol === 'https:' ? parsed.href : undefined;
  } catch {
    return undefined;
  }
}

function uniqueElements(elements: HTMLElement[]): HTMLElement[] {
  return [...new Set(elements)];
}

function cleanText(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function cleanDescription(value: string | null | undefined): string {
  return cleanText(value)
    .replace(/\s*(?:\.\.\.\s*)?more>>\s*/gi, ' ')
    .replace(/\s*<<less\s*/gi, ' ')
    .trim();
}

function fallbackTitle(pathname: string): string {
  if (/latest-series/.test(pathname)) return 'Latest Series';
  if (/novelslisting|page\/\d+/.test(pathname)) return 'All Novels';
  const segments = pathname.split('/').filter(Boolean);
  const slug = segments[segments.length - 1] ?? 'Catalog';
  return slug.replace(/-/g, ' ').replace(/\b\w/g, (letter: string) => letter.toUpperCase());
}
