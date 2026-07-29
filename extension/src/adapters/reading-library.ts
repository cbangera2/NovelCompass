import type {
  LiveReadingLibraryPage,
  ReadingLibraryRow,
  ReadingLibraryTab,
} from './contracts';

const TRUSTED_ORIGIN = 'https://www.novelupdates.com';
const SERIES_PATH = /^\/series\/[a-z0-9]+(?:-[a-z0-9]+)*\/?$/;

export interface ReadingLibraryParseResult {
  ok: boolean;
  page: LiveReadingLibraryPage;
  message?: string;
}

export function parseReadingLibraryPage(
  document: Document,
  currentUrl: string,
): ReadingLibraryParseResult {
  const rows = parseRows(document, currentUrl);
  const tabs = parseTabs(document, currentUrl);
  const pagination = parsePagination(document, currentUrl);
  const warnings = rows.length
    ? []
    : [{
        code: 'unsupported-markup' as const,
        field: 'rows',
        message: 'No reading-list rows were found in the loaded page.',
      }];
  return {
    ok: rows.length > 0,
    page: {
      title: cleanText(
        document.querySelector('h1, .reading-list-title, [data-reading-list-title]')?.textContent,
      ) || 'My Library',
      rows,
      tabs,
      warnings,
      ...pagination,
    },
    ...(!rows.length ? { message: 'Novel Updates reading-list markup is not supported.' } : {}),
  };
}

function parseRows(document: Document, currentUrl: string): ReadingLibraryRow[] {
  const activeListLabel = currentReadingListLabel(document, currentUrl);
  const seriesAnchors = Array.from(
    document.querySelectorAll<HTMLAnchorElement>('a[href*="/series/"]'),
  ).filter((anchor) => SERIES_PATH.test(trustedUrl(anchor.getAttribute('href'), currentUrl)?.pathname ?? ''));
  const containers = [...new Set(seriesAnchors.map((anchor) =>
    anchor.closest<HTMLElement>('[data-reading-row], tbody > tr, .reading-list-item, .rl-list-row, li'),
  ).filter((value): value is HTMLElement => Boolean(value)))];

  return containers.flatMap((container) => {
    const seriesAnchor = Array.from(container.querySelectorAll<HTMLAnchorElement>('a[href]')).find(
      (anchor) => SERIES_PATH.test(trustedUrl(anchor.getAttribute('href'), currentUrl)?.pathname ?? ''),
    );
    const seriesUrl = trustedUrl(seriesAnchor?.getAttribute('href'), currentUrl);
    const title = cleanText(
      container.querySelector('[data-series-title], .series-title, .rl_title')?.textContent ??
        seriesAnchor?.textContent,
    );
    if (!seriesUrl || !title) return [];

    const image = container.querySelector<HTMLImageElement>('img[src]');
    const coverUrl = trustedAssetUrl(image?.getAttribute('src'), currentUrl);
    const text = cleanText(container.textContent);
    const cells = tableCellsByHeading(container);
    const latestAnchor = Array.from(container.querySelectorAll<HTMLAnchorElement>('a[href]')).find(
      (anchor) => {
        if (anchor === seriesAnchor) return false;
        const label = cleanText(anchor.textContent);
        return /(?:ch(?:apter)?|vol(?:ume)?|prologue|epilogue)\b/i.test(label);
      },
    );
    const latestLabel = cleanText(
      container.querySelector('[data-latest-release], .latest-release, .rl_latest')?.textContent ??
        latestAnchor?.textContent,
    );
    const latestUrl = trustedUrl(latestAnchor?.getAttribute('href'), currentUrl);
    const listLabel =
      fieldText(container, '[data-list], .list-name, .rl_list, [data-column="list"]') ??
      cellValue(cells, /^(?:list|reading list)$/i) ??
      activeListLabel;
    const statusLabel =
      fieldText(container, '[data-status], .series-status, .rl_status, [data-column="status"]');
    const progressLabel =
      fieldText(container, '[data-progress], .reading-progress, .rl_progress, [data-column="progress"]') ??
      cellValue(cells, /^(?:my )?(?:status|progress|chapter)$/i) ??
      text.match(/\b(?:Read|Progress)\s*:?\s*([^|]+?)(?=\s{2,}|Latest|Updated|$)/i)?.[1]?.trim();
    const updatedAt =
      fieldText(container, '[data-updated], .updated, .rl_updated, time') ??
      cellValue(cells, /^(?:updated|added|last updated)$/i) ??
      text.match(/\b(?:Updated|Added)\s*:?\s*([^|]+)$/i)?.[1]?.trim();
    const latestCell = matchingCell(cells, /^(?:latest|latest release)$/i);
    const cellLatestAnchor = latestCell?.querySelector<HTMLAnchorElement>('a[href]');
    const cellLatestLabel = controlOrText(latestCell);
    const cellLatestUrl = trustedUrl(cellLatestAnchor?.getAttribute('href'), currentUrl);
    const effectiveLatestLabel = latestLabel || cellLatestLabel;
    const effectiveLatestUrl = latestUrl || cellLatestUrl;

    return [{
      title,
      seriesUrl: seriesUrl.href,
      ...(coverUrl ? { coverUrl } : {}),
      ...(listLabel ? { listLabel } : {}),
      ...(statusLabel ? { statusLabel } : {}),
      ...(effectiveLatestLabel
        ? {
            latestRelease: {
              label: effectiveLatestLabel,
              ...(effectiveLatestUrl ? { url: effectiveLatestUrl.href } : {}),
            },
          }
        : {}),
      ...(progressLabel ? { progressLabel } : {}),
      ...(updatedAt ? { updatedAt } : {}),
    }];
  });
}

function tableCellsByHeading(container: HTMLElement): Array<{ heading: string; cell: HTMLElement }> {
  if (container.tagName !== 'TR') return [];
  const table = container.closest('table');
  const headings = Array.from(
    table?.querySelectorAll<HTMLElement>(
      'thead tr:last-child th, thead tr:last-child td, tr:first-child th',
    ) ?? [],
  ).map((heading) => cleanText(heading.textContent));
  return Array.from(container.children).flatMap((cell, index) => {
    const heading = headings[index];
    return heading && cell instanceof HTMLElement ? [{ heading, cell }] : [];
  });
}

function matchingCell(
  cells: Array<{ heading: string; cell: HTMLElement }>,
  heading: RegExp,
): HTMLElement | undefined {
  return cells.find((entry) => heading.test(entry.heading))?.cell;
}

function cellValue(
  cells: Array<{ heading: string; cell: HTMLElement }>,
  heading: RegExp,
): string | undefined {
  return controlOrText(matchingCell(cells, heading));
}

function controlOrText(element: HTMLElement | undefined): string | undefined {
  if (!element) return undefined;
  const select = element.querySelector<HTMLSelectElement>('select');
  const selected = cleanText(select?.selectedOptions[0]?.textContent);
  const input = element.querySelector<HTMLInputElement>('input:not([type="checkbox"]):not([type="radio"])');
  return selected || cleanText(input?.value) || cleanText(element.textContent) || undefined;
}

function parseTabs(document: Document, currentUrl: string): ReadingLibraryTab[] {
  const candidates = document.querySelectorAll<HTMLAnchorElement>(
    'a[href]',
  );
  const current = trustedUrl(currentUrl, currentUrl);
  const seen = new Set<string>();
  return Array.from(candidates).flatMap((anchor) => {
    const url = trustedUrl(anchor.getAttribute('href'), currentUrl);
    if (!url || url.pathname !== '/reading-list/') return [];
    const raw = cleanText(anchor.textContent);
    const countMatch = raw.match(/\(([\d,]+)\)\s*$/);
    const label = raw.replace(/\s*\([\d,]+\)\s*$/, '');
    const list = url.searchParams.get('list');
    if (!label || !list || seen.has(list) || !/^(?:Reading|Plan to read|Completed)$/i.test(label)) {
      return [];
    }
    seen.add(list);
    return [{
      label,
      url: url.href,
      ...(countMatch?.[1] ? { count: Number.parseInt(countMatch[1].replace(/,/g, ''), 10) } : {}),
      selected:
        anchor.matches('[aria-current="page"], .active, .is-active') ||
        anchor.parentElement?.matches('.active, .is-active') === true ||
        current?.searchParams.get('list') === list ||
        (!current?.searchParams.has('list') && list === '0'),
    }];
  });
}

function currentReadingListLabel(document: Document, currentUrl: string): string | undefined {
  return parseTabs(document, currentUrl).find((tab) => tab.selected)?.label;
}

function parsePagination(
  document: Document,
  currentUrl: string,
): Pick<LiveReadingLibraryPage, 'currentPage' | 'pageLinks' | 'previousUrl' | 'nextUrl'> {
  const current = new URL(currentUrl);
  const currentPage =
    Number.parseInt(current.searchParams.get('pg') ?? current.searchParams.get('page') ?? '', 10) ||
    Number.parseInt(cleanText(document.querySelector('.current, [aria-current="page"]')?.textContent), 10) ||
    1;
  const pageLinks = new Map<number, string>();
  let previousUrl: string | undefined;
  let nextUrl: string | undefined;
  for (const anchor of document.querySelectorAll<HTMLAnchorElement>(
    '.pagination a[href], .page_navi a[href], .wp-pagenavi a[href], [data-pagination] a[href]',
  )) {
    const url = trustedUrl(anchor.getAttribute('href'), currentUrl);
    if (!url || url.pathname !== '/reading-list/') continue;
    const label = cleanText(anchor.textContent);
    const page = Number.parseInt(label, 10) ||
      Number.parseInt(url.searchParams.get('pg') ?? url.searchParams.get('page') ?? '', 10);
    if (page > 0) pageLinks.set(page, url.href);
    if (/prev|previous|‹|«/i.test(label) || anchor.rel === 'prev') previousUrl = url.href;
    if (/next|›|»/i.test(label) || anchor.rel === 'next') nextUrl = url.href;
  }
  if (!pageLinks.has(currentPage)) pageLinks.set(currentPage, current.href);
  return {
    currentPage,
    pageLinks: [...pageLinks].sort(([a], [b]) => a - b).map(([page, url]) => ({ page, url })),
    ...(previousUrl ? { previousUrl } : {}),
    ...(nextUrl ? { nextUrl } : {}),
  };
}

function fieldText(element: HTMLElement, selector: string): string | undefined {
  return cleanText(element.querySelector(selector)?.textContent) || undefined;
}

function trustedUrl(value: string | null | undefined, base: string): URL | undefined {
  if (!value) return undefined;
  try {
    const parsed = new URL(value, base);
    return parsed.protocol === 'https:' && parsed.origin === TRUSTED_ORIGIN ? parsed : undefined;
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

function cleanText(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}
