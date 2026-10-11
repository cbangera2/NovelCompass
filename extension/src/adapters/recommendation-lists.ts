import type {
  LinkedLabel,
  LiveRecommendationListsPage,
  ParseWarning,
  RecommendationListCard,
  RecommendationListSeries,
} from './contracts';

const TRUSTED_ORIGIN = 'https://www.novelupdates.com';
const LIST_PATH = /^\/viewlist\/\d+\/?$/;
const SERIES_PATH = /^\/series\/[a-z0-9]+(?:-[a-z0-9]+)*\/?$/;
const TAG_PATH = /^\/listtag\/[^/]+\/?$/;

export interface RecommendationListsParseResult {
  ok: boolean;
  page: LiveRecommendationListsPage;
  message?: string;
}

/** Parse public list pages to inert text and trusted URLs; source HTML never reaches React. */
export function parseRecommendationListsPage(
  document: Document,
  currentUrl: string,
): RecommendationListsParseResult {
  const current = trustedUrl(currentUrl, currentUrl);
  const pathname = current?.pathname ?? '';
  const kind =
    pathname === '/list-tags/' ? 'tags' : LIST_PATH.test(pathname) ? 'detail' : 'directory';
  const warnings: ParseWarning[] = [];
  const lists = kind === 'directory' ? parseListCards(document, currentUrl) : [];
  const series = kind === 'detail' ? parseSeries(document, currentUrl) : [];
  const tags = kind === 'tags' ? parseTagDirectory(document, currentUrl) : [];
  const title =
    cleanText(
      document.querySelector(
        '[data-recommendation-heading], h1, .pagetitle, .recommendation-list-title',
      )?.textContent,
    ) || (kind === 'tags' ? 'Recommendation List Tags' : 'Recommendation Lists');
  const description = cleanDescription(
    document.querySelector(
      '[data-list-description], .listdesc, .list-description, .recommendation-list-description',
    )?.textContent,
  );
  const creator =
    kind === 'detail'
      ? firstLinkedLabel(
          document,
          currentUrl,
          '[data-list-creator] a[href], .list-owner a[href], a[href*="/user/"]',
          /\/user(?:\/|$)/,
        )
      : undefined;
  const pagination = parsePagination(document, currentUrl);
  const hasContent = lists.length > 0 || series.length > 0 || tags.length > 0;
  if (!hasContent) {
    warnings.push({
      code: 'unsupported-markup',
      field: kind,
      message: 'No public recommendation-list content was found in the loaded page.',
    });
  }
  return {
    ok: Boolean(current && hasContent),
    page: {
      kind,
      title,
      ...(description ? { description } : {}),
      ...(creator ? { creator } : {}),
      lists,
      series,
      tags,
      warnings,
      ...pagination,
    },
    ...(!current
      ? { message: 'The page URL is not a trusted Novel Updates URL.' }
      : !hasContent
        ? { message: 'Novel Updates recommendation-list markup is not supported.' }
        : {}),
  };
}

function parseListCards(document: Document, currentUrl: string): RecommendationListCard[] {
  const seen = new Set<string>();
  return trustedAnchors(document, currentUrl, LIST_PATH).flatMap((anchor) => {
    const url = trustedUrl(anchor.getAttribute('href'), currentUrl);
    const title = cleanText(anchor.textContent);
    if (!url || !title || seen.has(url.href)) return [];
    seen.add(url.href);
    const row =
      anchor.closest<HTMLElement>(
        '[data-recommendation-list], .recommendation-list, .list-item, article, li, .search_main_box_nu',
      ) ??
      anchor.parentElement?.parentElement ??
      anchor.parentElement;
    if (!row) return [];
    const text = cleanText(row.textContent);
    const avatarUrl = trustedAssetUrl(
      row.querySelector<HTMLImageElement>('img[src]')?.getAttribute('src'),
      currentUrl,
    );
    const creator = firstLinkedLabel(
      row,
      currentUrl,
      '[data-list-creator] a[href], .list-owner a[href], a[href*="/user/"]',
      /\/user(?:\/|$)/,
    );
    return [{
      title,
      url: url.href,
      ...(creator ? { creator } : {}),
      ...(avatarUrl ? { avatarUrl } : {}),
      ...countField(text, 'seriesCount', /(\d[\d,]*)\s+Series\b/i),
      ...countField(text, 'commentCount', /(\d[\d,]*)\s+Comments?\b/i),
      ...countField(text, 'viewCount', /(\d[\d,]*)\s+Views?\b/i),
      ...countField(text, 'followCount', /(\d[\d,]*)\s+Follows?\b/i),
      updatedAt: cleanText(row.querySelector('[data-updated], time')?.textContent) || undefined,
      description: cleanDescription(
        row.querySelector(
          '[data-list-description], .listdesc, .list-description, .search_body_nu',
        )?.textContent,
      ),
      tags: linkedLabels(row, currentUrl, TAG_PATH),
    }];
  });
}

function parseSeries(document: Document, currentUrl: string): RecommendationListSeries[] {
  const seen = new Set<string>();
  return trustedAnchors(document, currentUrl, SERIES_PATH).flatMap((anchor) => {
    const url = trustedUrl(anchor.getAttribute('href'), currentUrl);
    const title = cleanText(anchor.textContent);
    if (!url || !title || seen.has(url.href)) return [];
    seen.add(url.href);
    const row =
      anchor.closest<HTMLElement>(
        '[data-list-series], .list-series, .search_main_box_nu, article, li, tr',
      ) ??
      anchor.parentElement?.parentElement ??
      anchor.parentElement;
    if (!row) return [];
    const text = cleanText(row.textContent);
    const coverUrl = trustedAssetUrl(
      row.querySelector<HTMLImageElement>('img[src]')?.getAttribute('src'),
      currentUrl,
    );
    const rating = decimal(
      row.dataset.rating ?? text.match(/\b(?:Rating|Score)\s*:?\s*(\d(?:\.\d+)?)/i)?.[1],
    );
    return [{
      title,
      url: url.href,
      ...(coverUrl ? { coverUrl } : {}),
      ...(rating !== undefined ? { rating } : {}),
      description: cleanDescription(
        row.querySelector('[data-description], .search_body_nu, .series-description')?.textContent,
      ),
      note: cleanDescription(row.querySelector('[data-list-note], .list-note')?.textContent),
      tags: linkedLabels(row, currentUrl, /^\/(?:genre|stag)\/[^/]+\/?$/),
    }];
  });
}

function parseTagDirectory(document: Document, currentUrl: string): LinkedLabel[] {
  const seen = new Set<string>();
  return trustedAnchors(document, currentUrl, TAG_PATH).flatMap((anchor) => {
    const url = trustedUrl(anchor.getAttribute('href'), currentUrl);
    const label = cleanText(anchor.textContent).replace(/\s*\(\d+\)\s*$/, '');
    if (!url || !label || seen.has(url.href)) return [];
    seen.add(url.href);
    return [{ label, url: url.href }];
  });
}

function parsePagination(document: Document, currentUrl: string) {
  const current = trustedUrl(currentUrl, currentUrl);
  const currentPage = positiveInteger(current?.searchParams.get('pg')) ?? 1;
  const links = Array.from(
    document.querySelectorAll<HTMLAnchorElement>(
      '.digg_pagination a[href], .pagination a[href], [data-pagination] a[href]',
    ),
  ).flatMap((anchor) => {
    const url = trustedUrl(anchor.getAttribute('href'), currentUrl);
    if (!url) return [];
    const label = cleanText(anchor.textContent);
    const page = positiveInteger(url.searchParams.get('pg')) ?? positiveInteger(label);
    return page ? [{ page, url: url.href, label }] : [];
  });
  const byPage = new Map(links.map(({ page, url }) => [page, url]));
  const previous = links.find(({ label }) => /(?:previous|prev|«|‹)/i.test(label));
  const next = links.find(({ label }) => /(?:next|»|›)/i.test(label));
  return {
    currentPage,
    pageLinks: [...byPage].map(([page, url]) => ({ page, url })).sort((a, b) => a.page - b.page),
    ...(previous ? { previousUrl: previous.url } : {}),
    ...(next ? { nextUrl: next.url } : {}),
  };
}

function trustedAnchors(document: Document, currentUrl: string, pattern: RegExp) {
  return Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]')).filter((anchor) => {
    const url = trustedUrl(anchor.getAttribute('href'), currentUrl);
    return Boolean(url && pattern.test(url.pathname));
  });
}

function linkedLabels(root: ParentNode, currentUrl: string, pattern: RegExp): LinkedLabel[] {
  const seen = new Set<string>();
  return Array.from(root.querySelectorAll<HTMLAnchorElement>('a[href]')).flatMap((anchor) => {
    const url = trustedUrl(anchor.getAttribute('href'), currentUrl);
    const label = cleanText(anchor.textContent);
    if (!url || !pattern.test(url.pathname) || !label || seen.has(url.href)) return [];
    seen.add(url.href);
    return [{ label, url: url.href }];
  });
}

function firstLinkedLabel(
  root: ParentNode,
  currentUrl: string,
  selector: string,
  pattern: RegExp,
): LinkedLabel | undefined {
  const anchor = Array.from(root.querySelectorAll<HTMLAnchorElement>(selector)).find((candidate) => {
    const url = trustedUrl(candidate.getAttribute('href'), currentUrl);
    return Boolean(url && pattern.test(url.pathname));
  });
  const url = trustedUrl(anchor?.getAttribute('href'), currentUrl);
  const label = cleanText(anchor?.textContent);
  return url && label ? { label, url: url.href } : undefined;
}

function trustedUrl(value: string | null | undefined, base: string): URL | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value, base);
    return url.protocol === 'https:' && url.origin === TRUSTED_ORIGIN ? url : undefined;
  } catch {
    return undefined;
  }
}

function trustedAssetUrl(value: string | null | undefined, base: string): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value, base);
    return url.protocol === 'https:' ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function countField<T extends string>(text: string, field: T, pattern: RegExp) {
  const value = positiveInteger(text.match(pattern)?.[1]?.replace(/,/g, ''));
  return value === undefined ? {} : { [field]: value };
}

function positiveInteger(value: string | null | undefined): number | undefined {
  const number = Number.parseInt(value ?? '', 10);
  return Number.isSafeInteger(number) && number > 0 ? number : undefined;
}

function decimal(value: string | null | undefined): number | undefined {
  const number = Number.parseFloat(value ?? '');
  return Number.isFinite(number) && number >= 0 ? number : undefined;
}

function cleanDescription(value: string | null | undefined): string | undefined {
  const text = cleanText(value)
    .replace(/\s*(?:\.\.\.\s*)?more>>\s*/gi, ' ')
    .replace(/\s*<<less\s*/gi, ' ')
    .trim();
  return text || undefined;
}

function cleanText(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}
