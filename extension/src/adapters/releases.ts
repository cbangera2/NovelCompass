import type { LinkedLabel, LiveRelease, LiveReleasePage } from './contracts';
import { OpaqueActionRegistry, type ActionGeneration } from './action-registry';

const NOVEL_UPDATES_ORIGIN = 'https://www.novelupdates.com';
const RELEASE_ROW_SELECTOR = '#myTable tbody tr, #myTable [data-fixture-release]';
const RELEASE_ACTION_SELECTOR = 'a.chp-release, .chp-release, [data-release-action]';

export interface ParsedReleases {
  page: LiveReleasePage;
  generation: number;
}

export function parseReleasePage(
  document: Document,
  pageUrl: string | URL,
  registry: OpaqueActionRegistry,
): ParsedReleases {
  const baseUrl = trustedPageUrl(pageUrl);
  const actions = registry.beginGeneration('releases');
  if (!baseUrl) {
    return { page: emptyReleasePage(), generation: actions.generation };
  }

  const rows = Array.from(document.querySelectorAll<HTMLElement>(RELEASE_ROW_SELECTOR))
    .map((row) => parseReleaseRow(row, baseUrl, actions))
    .filter((row): row is LiveRelease => row !== undefined);

  const paginationRoot =
    document.querySelector<HTMLElement>('#myTable + .digg_pagination') ??
    document.querySelector<HTMLElement>('#myTable .digg_pagination') ??
    document.querySelector<HTMLElement>('[data-fixture-pagination]');
  const pagination = parsePagination(paginationRoot, baseUrl);

  return {
    generation: actions.generation,
    page: {
      rows,
      currentPage: pagination.currentPage,
      pageLinks: pagination.pageLinks,
      ...(pagination.previousUrl ? { previousUrl: pagination.previousUrl } : {}),
      ...(pagination.nextUrl ? { nextUrl: pagination.nextUrl } : {}),
      groupFilterAvailable: Boolean(
        document.querySelector('.my_popupfilter_open, [data-release-group-filter]'),
      ),
    },
  };
}

function parseReleaseRow(
  row: HTMLElement,
  baseUrl: URL,
  actions: ActionGeneration,
): LiveRelease | undefined {
  const cells = Array.from(row.children).filter(
    (child): child is HTMLElement =>
      child instanceof HTMLElement && (child.matches('td') || child.matches('span')),
  );
  if (cells.length < 3) {
    return undefined;
  }

  const dateLabel = cleanText(cells[0]?.textContent);
  const groupCell = cells[1];
  const chapterCell = cells[2];
  const chapterAction = chapterCell?.matches(RELEASE_ACTION_SELECTOR)
    ? chapterCell
    : chapterCell?.querySelector<HTMLElement>(RELEASE_ACTION_SELECTOR);
  const chapterLabel = cleanText(
    chapterAction?.getAttribute('title') ?? chapterAction?.textContent ?? chapterCell?.textContent,
  );
  if (!dateLabel || !groupCell || !chapterCell || !chapterLabel) {
    return undefined;
  }

  const group = parseLinkedLabel(groupCell, baseUrl);
  const actionId = registerChapterAction(chapterAction, baseUrl, actions);
  const volumeLabel = parseVolumeLabel(chapterLabel);
  const dateIso = parseDateIso(dateLabel);

  return {
    actionId: actionId ?? '',
    dateLabel,
    ...(dateIso ? { dateIso } : {}),
    group,
    chapterLabel,
    ...(volumeLabel ? { volumeLabel } : {}),
    isActionAvailable: Boolean(actionId),
  };
}

function registerChapterAction(
  element: HTMLElement | null | undefined,
  baseUrl: URL,
  actions: ActionGeneration,
): string | undefined {
  if (!element) {
    return undefined;
  }

  if (element instanceof HTMLAnchorElement) {
    const href = element.getAttribute('href');
    if (href) {
      const trustedUrl = trustedNovelUpdatesUrl(href, baseUrl);
      const actionId = trustedUrl ? actions.registerNavigation(trustedUrl) : undefined;
      if (actionId) {
        return actionId;
      }
      return undefined;
    }
  }

  return actions.registerElement(element);
}

function parseLinkedLabel(element: HTMLElement, baseUrl: URL): LinkedLabel {
  const anchor = element.querySelector<HTMLAnchorElement>('a[href]');
  const label = cleanText(anchor?.textContent ?? element.textContent);
  const url = anchor ? trustedNovelUpdatesUrl(anchor.getAttribute('href'), baseUrl) : undefined;
  return { label, ...(url ? { url } : {}) };
}

function parsePagination(
  root: HTMLElement | null,
  baseUrl: URL,
): {
  currentPage: number;
  pageLinks: Array<{ page: number; url: string }>;
  previousUrl?: string;
  nextUrl?: string;
} {
  const currentFromUrl = positiveInteger(baseUrl.searchParams.get('pg')) ?? 1;
  if (!root) {
    return { currentPage: currentFromUrl, pageLinks: [] };
  }

  const pageLinks = new Map<number, string>();
  let previousUrl: string | undefined;
  let nextUrl: string | undefined;

  for (const anchor of root.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    const url = trustedNovelUpdatesUrl(anchor.getAttribute('href'), baseUrl);
    if (!url) {
      continue;
    }
    const rel = anchor.getAttribute('rel')?.toLowerCase();
    if (rel === 'prev' || anchor.classList.contains('previous_page')) {
      previousUrl = url;
    }
    if (rel === 'next' || anchor.classList.contains('next_page')) {
      nextUrl = url;
    }
    const page =
      positiveInteger(new URL(url).searchParams.get('pg')) ??
      positiveInteger(cleanText(anchor.textContent));
    if (page) {
      pageLinks.set(page, url);
    }
  }

  const currentLabel = positiveInteger(
    cleanText(root.querySelector<HTMLElement>('.current')?.textContent),
  );
  return {
    currentPage: currentLabel ?? currentFromUrl,
    pageLinks: [...pageLinks].map(([page, url]) => ({ page, url })),
    ...(previousUrl ? { previousUrl } : {}),
    ...(nextUrl ? { nextUrl } : {}),
  };
}

function trustedPageUrl(value: string | URL): URL | undefined {
  try {
    const url = value instanceof URL ? new URL(value.href) : new URL(value);
    return url.protocol === 'https:' && url.origin === NOVEL_UPDATES_ORIGIN ? url : undefined;
  } catch {
    return undefined;
  }
}

function trustedNovelUpdatesUrl(value: string | null, baseUrl: URL): string | undefined {
  if (!value) {
    return undefined;
  }
  try {
    const url = new URL(value, baseUrl);
    return url.protocol === 'https:' && url.origin === NOVEL_UPDATES_ORIGIN ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function parseDateIso(value: string): string | undefined {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(value);
  if (!match) {
    return undefined;
  }
  const month = Number(match[1]);
  const day = Number(match[2]);
  const rawYear = Number(match[3]);
  const year = rawYear < 100 ? 2000 + rawYear : rawYear;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return undefined;
  }
  return date.toISOString().slice(0, 10);
}

function parseVolumeLabel(chapterLabel: string): string | undefined {
  return /^(v(?:ol(?:ume)?)?\.?\s*\d+(?:\.\d+)?)/i.exec(chapterLabel)?.[1];
}

function positiveInteger(value: string | null | undefined): number | undefined {
  if (!value || !/^[1-9]\d*$/.test(value.trim())) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function cleanText(value: string | null | undefined): string {
  return value?.replace(/\s+/g, ' ').trim() ?? '';
}

function emptyReleasePage(): LiveReleasePage {
  return {
    rows: [],
    currentPage: 1,
    pageLinks: [],
    groupFilterAvailable: false,
  };
}
