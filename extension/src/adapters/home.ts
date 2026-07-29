import type { OpaqueActionRegistry } from './action-registry';
import type { HomeReleaseRow, LinkedLabel, LiveHomePage, ParseWarning } from './contracts';

const TRUSTED_ORIGIN = 'https://www.novelupdates.com';
const SERIES_PATH = /^\/series\/[a-z0-9]+(?:-[a-z0-9]+)*\/?$/;
const GROUP_PATH = /^\/group\/[^/]+\/?$/;

export interface HomeParseResult {
  ok: boolean;
  page: LiveHomePage;
  message?: string;
}

export function parseHomePage(
  document: Document,
  currentUrl: string,
  registry: OpaqueActionRegistry,
): HomeParseResult {
  const warnings: ParseWarning[] = [];
  const actions = registry.beginGeneration('home-releases');
  const rows = Array.from(document.querySelectorAll<HTMLTableRowElement>('#myTable tbody tr')).flatMap(
    (row): HomeReleaseRow[] => {
      const cells = Array.from(row.cells);
      const seriesAnchor = trustedAnchor(cells[0], currentUrl, SERIES_PATH);
      const seriesUrl = trustedUrl(seriesAnchor?.getAttribute('href'), currentUrl);
      const title = cleanText(seriesAnchor?.textContent);
      const chapterCell = cells[1];
      const chapterLabel = cleanText(chapterCell?.textContent);
      const chapterControl = chapterCell?.querySelector<HTMLElement>(
        'a[href], button, .chp-release, [data-release-action]',
      );
      const groupAnchor = trustedAnchor(cells[2], currentUrl, GROUP_PATH);
      const groupUrl = trustedUrl(groupAnchor?.getAttribute('href'), currentUrl);
      const groupLabel = cleanText(groupAnchor?.textContent ?? cells[2]?.textContent);

      if (!seriesUrl || !title || !chapterLabel) return [];
      return [
        {
          title,
          seriesUrl: seriesUrl.href,
          chapterLabel,
          ...(chapterControl ? { chapterActionId: actions.registerElement(chapterControl) } : {}),
          group: {
            label: groupLabel || 'Unknown group',
            ...(groupUrl ? { url: groupUrl.href } : {}),
          },
        },
      ];
    },
  );

  if (!rows.length) {
    warnings.push({
      code: 'unsupported-markup',
      field: 'rows',
      message: 'No homepage release rows were found.',
    });
  }

  const pagination = parsePagination(document, currentUrl);
  return {
    ok: rows.length > 0,
    page: {
      rows,
      latestSeries: parseLatestSeries(document, currentUrl),
      ...parseDateLabel(document),
      ...pagination,
      warnings,
    },
    ...(!rows.length ? { message: 'Novel Updates homepage releases could not be parsed.' } : {}),
  };
}

function parseDateLabel(document: Document): Pick<LiveHomePage, 'dateLabel'> {
  const candidates = document.querySelectorAll<HTMLElement>(
    '.l-content.release h1, .l-content.release h2, .l-content.release h3, .l-content.release h4, time, strong',
  );
  const dateLabel = Array.from(candidates)
    .map((element) => cleanText(element.textContent))
    .find((text) =>
      /^(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),\s+[A-Z][a-z]+\s+\d{1,2},\s+\d{4}$/.test(
        text,
      ),
    );
  return dateLabel ? { dateLabel } : {};
}

function parseLatestSeries(document: Document, currentUrl: string): LinkedLabel[] {
  const heading = Array.from(document.querySelectorAll<HTMLElement>('h2, h3, h4')).find(
    (element) => cleanText(element.textContent).toLowerCase() === 'latest series',
  );
  const container = heading?.parentElement;
  if (!container) return [];
  const seen = new Set<string>();
  return Array.from(container.querySelectorAll<HTMLAnchorElement>('a[href]')).flatMap((anchor) => {
    const url = trustedUrl(anchor.getAttribute('href'), currentUrl);
    const label = cleanText(anchor.textContent);
    if (!url || !SERIES_PATH.test(url.pathname) || !label || seen.has(url.href)) return [];
    seen.add(url.href);
    return [{ label, url: url.href }];
  });
}

function parsePagination(
  document: Document,
  currentUrl: string,
): Pick<LiveHomePage, 'currentPage' | 'pageLinks' | 'previousUrl' | 'nextUrl'> {
  const current = new URL(currentUrl);
  const currentPage = Number.parseInt(current.searchParams.get('pg') ?? '', 10) || 1;
  const pageLinks = new Map<number, string>([[currentPage, current.href]]);
  let previousUrl: string | undefined;
  let nextUrl: string | undefined;

  for (const anchor of document.querySelectorAll<HTMLAnchorElement>('a[href*="pg="]')) {
    const url = trustedUrl(anchor.getAttribute('href'), currentUrl);
    if (!url || url.pathname !== '/') continue;
    const page = Number.parseInt(url.searchParams.get('pg') ?? '', 10);
    if (page > 0) pageLinks.set(page, url.href);
    const label = cleanText(anchor.textContent);
    if (/^(?:←|‹|«|previous)$/i.test(label)) previousUrl = url.href;
    if (/^(?:→|›|»|next)$/i.test(label)) nextUrl = url.href;
  }

  return {
    currentPage,
    pageLinks: [...pageLinks].sort(([a], [b]) => a - b).map(([page, url]) => ({ page, url })),
    ...(previousUrl ? { previousUrl } : {}),
    ...(nextUrl ? { nextUrl } : {}),
  };
}

function trustedAnchor(
  container: Element | undefined,
  currentUrl: string,
  path: RegExp,
): HTMLAnchorElement | undefined {
  return Array.from(container?.querySelectorAll<HTMLAnchorElement>('a[href]') ?? []).find(
    (anchor) => path.test(trustedUrl(anchor.getAttribute('href'), currentUrl)?.pathname ?? ''),
  );
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

function cleanText(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}
